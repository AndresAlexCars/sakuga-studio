// Asistente de texto con Cloudflare Workers AI (Llama 3.1 8B instruct).
// Usa el mismo token de la cuenta. El token nunca sale del servidor.
import { config } from '../config.js';
import { UpstreamError } from './fal.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DAILY_LIMIT = Number.parseInt(process.env.CHAT_DAILY_LIMIT ?? '', 10) || 200;
const SYSTEM = 'Eres el asistente de JORDVEX, una app para crear ilustraciones con IA. Responde en el mismo idioma del usuario, de forma breve y clara. Ayuda a escribir descripciones (prompts) para imágenes y a usar la app. No inventes funciones que la app no tiene.';

let day = '';
let count = 0;

export function takeChatSlot() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    count = 0;
  }
  if (count >= DAILY_LIMIT) return false;
  count += 1;
  return true;
}

export async function chat(messages) {
  if (config.provider !== 'cloudflare' || !config.cfAccountId || !config.cfApiToken) {
    throw new UpstreamError('El asistente solo está disponible con Cloudflare configurado.', 503);
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.cfAccountId)}/ai/run/${MODEL}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.cfApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: SYSTEM }, ...messages], max_tokens: 512 }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new UpstreamError('No se pudo conectar con el asistente. Inténtalo de nuevo.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    console.error(`[chat] Cloudflare respondió ${res.status}`);
    throw new UpstreamError('El asistente no respondió. Puede que se haya agotado el cupo de hoy.', res.status === 429 ? 429 : 502);
  }
  const reply = data?.result?.response;
  if (typeof reply !== 'string' || !reply.trim()) throw new UpstreamError('El asistente devolvió una respuesta vacía.');
  return reply.trim();
}
