// Pollinations (FLUX) como generador alternativo. Funciona sin clave; una clave opcional sube el cupo.
// La clave, si existe, solo se lee en el servidor (POLLINATIONS_KEY en Render).
import { UpstreamError } from './fal.js';

export async function runPollinations(prompt, width, height) {
  const params = new URLSearchParams({ width: String(width), height: String(height), model: 'flux', nologo: 'true', enhance: 'false' });
  const headers = {};
  if (process.env.POLLINATIONS_KEY) headers.Authorization = `Bearer ${process.env.POLLINATIONS_KEY}`;
  let res;
  try {
    res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`, {
      headers,
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new UpstreamError('No se pudo conectar con Pollinations. Inténtalo de nuevo.');
  }
  if (res.status === 429) throw new UpstreamError('Pollinations está saturado en este momento. Espera un poco o usa el otro generador.', 429);
  if (!res.ok) {
    console.error(`[pollinations] respondió ${res.status}`);
    throw new UpstreamError('Pollinations no pudo generar la imagen. Prueba con el otro generador.', 502);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1000) throw new UpstreamError('Pollinations devolvió una respuesta vacía.', 502);
  return buffer;
}
