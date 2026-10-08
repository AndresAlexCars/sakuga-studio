// Fuente única de verdad: estilos, proporciones, resoluciones y modelos.
// El frontend recibe esto desde /api/config, así nunca se desincroniza.
import { config } from './config.js';

export const STYLES = {
  anime: {
    label: 'Anime',
    prompt:
      'high-quality modern anime illustration, clean line art, vibrant cel shading, expressive detailed eyes, polished digital coloring, detailed background',
  },
  manga: {
    label: 'Manga',
    prompt:
      'black and white manga illustration, confident ink linework, screentone shading, cross-hatching, dynamic composition, high contrast, no color',
  },
  cinematic: {
    label: 'Anime cinematográfico',
    prompt:
      'cinematic anime film still, dramatic lighting, volumetric light rays, shallow depth of field, richly painted background, widescreen composition, high-budget animated movie look',
  },
  fantasy: {
    label: 'Fantasía',
    prompt:
      'fantasy anime illustration, magical atmosphere, ornate costume details, glowing particles, lush painterly environment, epic sense of scale',
  },
  cyberpunk: {
    label: 'Cyberpunk',
    prompt:
      'cyberpunk anime illustration, neon-lit rainy city at night, holographic signs, magenta and cyan lighting, futuristic fashion, detailed mechanical elements',
  },
  chibi: {
    label: 'Chibi',
    prompt:
      'cute chibi anime illustration, super-deformed proportions, big head and small body, soft pastel colors, thick clean outlines, kawaii, cheerful simple background',
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
  return `${STYLES[styleId].prompt}. Subject: ${userPrompt}`;
}

export function publicCatalog() {
  return {
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
