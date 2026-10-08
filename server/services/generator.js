import crypto from 'node:crypto';
import { QUALITIES, buildPrompt, sizeFor } from '../catalog.js';
import { config } from '../config.js';
import { imageKind, imageSize } from '../utils/imageSize.js';
import { runCloudflare } from './cloudflare.js';
import { UpstreamError, downloadImage, runModel } from './fal.js';
import { addItem, saveImageFile, toPublic } from './store.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

async function viaFal({ prompt, style, ratio, resolution, quality }) {
  const q = QUALITIES[quality];
  const { width, height } = sizeFor(ratio, resolution);

  const input = q.build({
    prompt: buildPrompt(style, prompt),
    image_size: { width, height },
    num_images: 1,
    output_format: 'png',
    enable_safety_checker: true,
  });

  const result = await runModel(q.model, input);

  if (result.has_nsfw_concepts?.[0]) {
    throw new UpstreamError('El filtro de seguridad bloqueó esta imagen. Prueba con otra descripción.', 422);
  }
  const image = result.images?.[0];
  if (!image?.url) throw new UpstreamError('El proveedor no devolvió ninguna imagen.');

  // Se descarga y se guarda en el servidor: las URLs del proveedor caducan.
  const buffer = await downloadImage(image.url);
  return {
    buffer,
    ext: image.content_type === 'image/jpeg' ? 'jpg' : 'png',
    width: image.width || width,
    height: image.height || height,
    ratio,
    resolution,
    quality,
  };
}

// Cloudflare no permite elegir tamaño: se lee el real de la imagen devuelta.
async function viaCloudflare({ prompt, style }) {
  const buffer = await runCloudflare(buildPrompt(style, prompt));
  const kind = imageKind(buffer);
  if (!kind) throw new UpstreamError('Cloudflare devolvió un archivo que no es una imagen.');
  const { width, height } = imageSize(buffer) ?? { width: 1024, height: 1024 };
  const d = gcd(width, height);
  return { buffer, ext: kind, width, height, ratio: `${width / d}:${height / d}`, resolution: 'md', quality: 'fast' };
}

export async function generate({ clientId, prompt, style, ratio, resolution, quality }) {
  const out =
    config.provider === 'cloudflare'
      ? await viaCloudflare({ prompt, style })
      : await viaFal({ prompt, style, ratio, resolution, quality });

  const id = crypto.randomUUID();
  const file = `${id}.${out.ext}`;
  await saveImageFile(file, out.buffer);

  const item = {
    id,
    clientId,
    file,
    prompt,
    style,
    ratio: out.ratio,
    resolution: out.resolution,
    quality: out.quality,
    width: out.width,
    height: out.height,
    createdAt: new Date().toISOString(),
  };
  await addItem(item);
  return toPublic(item);
}
