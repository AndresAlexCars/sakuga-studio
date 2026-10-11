// Fuente única de verdad: estilos, proporciones, resoluciones y modelos.
// El frontend recibe esto desde /api/config, así nunca se desincroniza.
import { config } from './config.js';

export const STYLES = {
  anime: {
    label: 'Anime',
    prompt:
      'masterpiece anime illustration, high quality key visual, clean confident line art, vibrant cel shading with soft gradients, large expressive detailed eyes, intricate hair strands, polished digital coloring, richly detailed background, balanced composition, sharp focus',
  },
  manga: {
    label: 'Manga',
    prompt:
      'black and white manga illustration, professional mangaka inking, crisp varied-weight linework, screentone shading, cross-hatching, dramatic contrast between deep blacks and clean whites, dynamic panel composition, detailed backgrounds, no color',
  },
  cinematic: {
    label: 'Anime cinematográfico',
    prompt:
      'cinematic anime film still, high-budget animated movie, dramatic lighting, volumetric light rays, atmospheric depth, shallow depth of field, richly painted background art, subtle film grain, widescreen composition, emotional mood',
  },
  fantasy: {
    label: 'Fantasía',
    prompt:
      'epic fantasy anime illustration, magical atmosphere, glowing particles and runes, ornate detailed costume and armor, lush painterly environment, dramatic sky, rich saturated colors, sense of grand scale, highly detailed',
  },
  cyberpunk: {
    label: 'Cyberpunk',
    prompt:
      'cyberpunk anime illustration, neon-lit rainy city at night, holographic signs, wet reflective streets, magenta and cyan rim lighting, futuristic fashion, intricate mechanical details, moody atmosphere, high contrast, highly detailed',
  },
  chibi: {
    label: 'Chibi',
    prompt:
      'adorable chibi anime illustration, super-deformed proportions, big head and tiny body, huge sparkling eyes, soft pastel colors, thick clean outlines, kawaii, cheerful simple background, cute accessories, sticker-like finish',
  },
};

export const RATIOS = {
  '1:1': { w: 1, h: 1 },
  '16:9': { w: 16, h: 9 },
  '9:16': { w: 9, h: 16 },
  '4:3': { w: 4, h: 3 },
};

export const RESOLUTIONS = {
  sm: { label: 'Estándar', longEdge: 768 },
  md: { label: 'Alta', longEdge: 1024 },
  lg: { label: 'Máxima', longEdge: 1344 },
};

// pricePerMP = USD por megapíxel (aprox.). Se usa solo para mostrar una estimación.
export const QUALITIES = {
  fast: {
    label: 'Rápido',
    hint: 'Unos segundos',
    model: config.models.fast,
    pricePerMP: 0.003,
    build: (base) => ({ ...base, num_inference_steps: 4 }),
  },
  pro: {
    label: 'Calidad',
    hint: 'Más detalle',
    model: config.models.pro,
    pricePerMP: 0.04,
    build: (base) => ({ ...base, safety_tolerance: '2' }),
  },
};

const snap = (value) => Math.max(256, Math.round(value / 32) * 32);

export function sizeFor(ratioId, resolutionId) {
  const { w, h } = RATIOS[ratioId];
  const long = RESOLUTIONS[resolutionId].longEdge;
  return w >= h
    ? { width: snap(long), height: snap((long * h) / w) }
    : { width: snap((long * w) / h), height: snap(long) };
}

export const SIZES = Object.fromEntries(
  Object.keys(RATIOS).map((r) => [
    r,
    Object.fromEntries(Object.keys(RESOLUTIONS).map((s) => [s, sizeFor(r, s)])),
  ]),
);

export function buildPrompt(styleId, userPrompt) {
  return `${userPrompt}. Style: ${STYLES[styleId].prompt}`;
}

export function publicCatalog() {
  return {
    provider: config.provider,
    appName: config.appName,
    requiresAccessCode: Boolean(config.accessCode),
    maxPromptLength: config.maxPromptLength,
    styles: Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label })),
    ratios: Object.entries(RATIOS).map(([id, r]) => ({ id, label: id, w: r.w, h: r.h })),
    resolutions: Object.entries(RESOLUTIONS).map(([id, r]) => ({ id, label: r.label, hint: `${r.longEdge}px` })),
    qualities: Object.entries(QUALITIES).map(([id, q]) => ({
      id,
      label: q.label,
      hint: q.hint,
      pricePerMP: q.pricePerMP,
    })),
    sizes: SIZES,
  };
}
