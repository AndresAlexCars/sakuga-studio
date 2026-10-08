import crypto from 'node:crypto';
import { QUALITIES, buildPrompt, sizeFor } from '../catalog.js';
import { UpstreamError, downloadImage, runModel } from './fal.js';
import { addItem, saveImageFile, toPublic } from './store.js';

export async function generate({ clientId, prompt, style, ratio, resolution, quality }) {
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
  const id = crypto.randomUUID();
  const file = `${id}.${image.content_type === 'image/jpeg' ? 'jpg' : 'png'}`;
  await saveImageFile(file, buffer);

  const item = {
    id,
    clientId,
    file,
    prompt,
    style,
    ratio,
    resolution,
    quality,
    width: image.width || width,
    height: image.height || height,
    createdAt: new Date().toISOString(),
  };
  await addItem(item);
  return toPublic(item);
}
