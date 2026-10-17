// Asistente de texto con dos proveedores gratis: Cloudflare Workers AI y Groq.
// Las claves viven solo en el servidor (variables de entorno de Render).
import { config } from '../config.js';
import { UpstreamError } from './fal.js';

const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const GROQ_MODEL = 'llama-3.1-8b-instant';
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

async function askCloudflare(messages) {
  if (!config.cfAccountId || !config.cfApiToken) {
    throw new UpstreamError('El asistente de Cloudflare no está configurado.', 503);
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.cfAccountId)}/ai/run/${CF_MODEL}`;
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

async function askGroq(messages) {
  if (!config.groqKey) throw new UpstreamError('Groq no está configurado (falta GROQ_API_KEY).', 503);
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'system', content: SYSTEM }, ...messages], max_tokens: 512 }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new UpstreamError('No se pudo conectar con Groq. Inténtalo de nuevo.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`[chat] Groq respondió ${res.status}`);
    if (res.status === 429) throw new UpstreamError('Groq llegó a su límite por ahora. Espera un minuto o usa Cloudflare.', 429);
    throw new UpstreamError('Groq no respondió. Prueba con Cloudflare.', 502);
  }
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) throw new UpstreamError('Groq devolvió una respuesta vacía.');
  return reply.trim();
}

export async function chat(messages, provider = 'cloudflare') {
  return provider === 'groq' ? askGroq(messages) : askCloudflare(messages);
}
