// Fuente única de verdad: estilos/modos, proporciones, resoluciones y modelos.
// El frontend recibe esto desde /api/config, así nunca se desincroniza.
import { config } from './config.js';

export const STYLES = {
  // ── Ilustraciones y Anime ──────────────────────────────
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

  // ── Nuevos modos (Etapa 1) ─────────────────────────────
  wallpaper_mobile: {
    label: 'Fondo de móvil',
    prompt:
      'stunning phone wallpaper, vertical composition, high detail, beautiful lighting, no text, no watermark, optimized for mobile lock screen, clean elegant design, high resolution',
  },
  wallpaper_pc: {
    label: 'Fondo de PC',
    prompt:
      'stunning desktop wallpaper, wide cinematic composition, ultra detailed, beautiful atmospheric lighting, no text, no watermark, high resolution, professional quality',
  },
  realistic: {
    label: 'Realista',
    prompt:
      'photorealistic image, ultra detailed, natural lighting, high dynamic range, sharp focus, realistic textures and materials, professional photography, 8k quality',
  },
  character: {
    label: 'Personaje / Avatar',
    prompt:
      'character portrait, highly detailed face, expressive eyes, clean background or soft bokeh, professional character design, sharp focus on the subject, high quality',
  },
  landscape: {
    label: 'Paisaje cinematográfico',
    prompt:
      'epic cinematic landscape, dramatic lighting, atmospheric perspective, rich colors, highly detailed environment, sense of scale and depth, professional matte painting quality',
  },
  logo: {
    label: 'Logo / Diseño',
    prompt:
      'professional logo design, clean vector style, minimalist, bold shapes, high contrast, suitable for branding, centered composition, white or transparent background feel, sharp edges',
  },
};

export const RATIOS = {
  '1:1': { w: 1, h: 1 },
  '16:9': { w: 16, h: 9 },
  '9:16': { w: 9, h: 16 },
  '4:3': { w: 4, h: 3 },
  '3:4': { w: 3, h: 4 },
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
  const style = STYLES[styleId];
  if (!style) return userPrompt;
  return `${userPrompt}. Style: ${style.prompt}`;
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

