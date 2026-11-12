// Cliente mínimo de fal.ai (sin dependencias). La clave solo existe aquí, en el servidor.
import { config } from '../config.js';

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

export async function runModel(modelId, input) {
  let res;
  try {
    res = await fetch(`https://fal.run/${modelId}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${config.falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new UpstreamError('El modelo tardó demasiado. Inténtalo de nuevo.', 504);
    }
    throw new UpstreamError('No se pudo conectar con el servicio de imágenes.');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[fal] ${modelId} respondió ${res.status}: ${detail.slice(0, 500)}`);
    if (res.status === 401 || res.status === 403) {
      throw new UpstreamError('El proveedor rechazó la clave o no hay saldo en la cuenta de fal.ai.');
    }
    if (res.status === 429) throw new UpstreamError('El proveedor está saturado. Espera unos segundos.', 429);
    if (res.status === 422) throw new UpstreamError('El proveedor no aceptó esta solicitud. Prueba con otro prompt.', 422);
    throw new UpstreamError('El proveedor de imágenes devolvió un error.');
  }
  return res.json();
}

export async function downloadImage(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new UpstreamError('El proveedor devolvió una dirección de imagen no válida.');
  }
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new UpstreamError('No se pudo descargar la imagen generada.');
  }
  if (!res.ok) throw new UpstreamError('No se pudo descargar la imagen generada.');
  return Buffer.from(await res.arrayBuffer());
}
