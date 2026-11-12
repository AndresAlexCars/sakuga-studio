// Traduce el prompt de español a inglés antes de enviarlo a Cloudflare.
// FLUX entiende mejor el inglés. Si la traducción falla, se usa el texto original
// para no bloquear la generación. El token solo existe en el servidor.
import { config } from '../config.js';

const MODEL = '@cf/meta/m2m100-1.2b';
const SPANISH_WORDS = new Set(['de', 'la', 'el', 'con', 'una', 'un', 'y', 'que', 'en', 'los', 'las', 'del', 'al', 'por', 'para', 'sobre', 'bajo', 'entre', 'sin', 'muy', 'su', 'se', 'es']);
const ENGLISH_WORDS = new Set(['the', 'with', 'and', 'of', 'in', 'on', 'under', 'wearing', 'an', 'is', 'at', 'her', 'his', 'its', 'from', 'for', 'to', 'at']);

// Heurística simple: cuenta palabras típicas de cada idioma y acentos del español.
export function looksSpanish(text) {
  const words = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-zñ]+/).filter(Boolean);
  let es = 0;
  let en = 0;
  for (const w of words) {
    if (SPANISH_WORDS.has(w)) es += 1;
    if (ENGLISH_WORDS.has(w)) en += 1;
  }
  const accents = /[áéíóúñ¿¡]/i.test(text) ? 2 : 0;
  return es + accents > en;
}

export async function toEnglish(text) {
  if (!looksSpanish(text)) return { text, translated: false };

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.cfAccountId)}/ai/run/${MODEL}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.cfApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 2000), source_lang: 'es', target_lang: 'en' }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);
    const translated = data?.result?.translated_text ?? data?.translated_text;
    if (!res.ok || typeof translated !== 'string' || !translated.trim()) {
      console.error('[translate] respuesta sin traducción:', res.status);
      return { text, translated: false };
    }
    return { text: translated.trim(), translated: true };
  } catch (err) {
    console.error('[translate] fallo, se usa el texto original:', err?.message);
    return { text, translated: false };
  }
      }
