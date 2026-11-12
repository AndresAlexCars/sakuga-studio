// Cliente mínimo de Cloudflare Workers AI (FLUX.1 schnell). Sin dependencias.
// El token solo existe aquí, en el servidor.
import { config } from '../config.js';
import { UpstreamError } from './fal.js';

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

export async function runCloudflare(prompt) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.cfAccountId)}/ai/run/${MODEL}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cfApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: config.cfSteps }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new UpstreamError('El modelo tardó demasiado. Inténtalo de nuevo.', 504);
    }
    throw new UpstreamError('No se pudo conectar con Cloudflare.');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || data?.success === false) {
    console.error(`[cloudflare] respondió ${res.status}:`, JSON.stringify(data?.errors ?? data).slice(0, 500));
    if (res.status === 401 || res.status === 403) {
      throw new UpstreamError('Cloudflare rechazó el token. Revisa CLOUDFLARE_API_TOKEN y que tenga permiso de Workers AI.');
    }
    if (res.status === 404) {
      throw new UpstreamError('Cloudflare no encontró tu cuenta. Revisa CLOUDFLARE_ACCOUNT_ID.');
    }
    if (res.status === 429) {
      throw new UpstreamError('Se agotó el cupo gratis de hoy o hay demasiadas solicitudes. Se reinicia a las 00:00 UTC.', 429);
    }
    if (res.status === 400 || res.status === 422) {
      throw new UpstreamError('Cloudflare no aceptó este prompt. Prueba con otra descripción.', 422);
    }
    throw new UpstreamError('Cloudflare devolvió un error.');
  }

  const base64 = data?.result?.image ?? data?.image;
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new UpstreamError('Cloudflare no devolvió ninguna imagen. Prueba con otro prompt.');
  }
  return Buffer.from(base64, 'base64');
}
