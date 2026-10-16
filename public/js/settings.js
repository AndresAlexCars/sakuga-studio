// Ajustes de la app guardados en este dispositivo (localStorage).
// Todo valor leído se valida: un dato corrupto nunca rompe la app.
const KEY = 'sakuga.settings.v1';
const DRAFT_KEY = 'sakuga.draft';

export const PALETTES = {
  sakura: { dot: '#ff8fb8' },
  jade: { dot: '#5fd6a8' },
  oro: { dot: '#e3bf78' },
  medianoche: { dot: '#7ba7ff' },
};

export const DEFAULTS = Object.freeze({
  mode: 'dark',
  palette: 'sakura',
  accent: '',
  oled: false,
  reduceMotion: false,
  lang: 'es',
  vibrate: true,
  saveDraft: true,
  showCaptions: true,
  sort: 'new',
});

const RULES = {
  mode: (v) => (['auto', 'light', 'dark'].includes(v) ? v : DEFAULTS.mode),
  palette: (v) => (typeof v === 'string' && Object.hasOwn(PALETTES, v) ? v : DEFAULTS.palette),
  accent: (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : ''),
  oled: (v) => v === true,
  reduceMotion: (v) => v === true,
  lang: (v) => (v === 'en' ? 'en' : 'es'),
  vibrate: (v) => v !== false,
  saveDraft: (v) => v !== false,
  showCaptions: (v) => v !== false,
  sort: (v) => (v === 'old' ? 'old' : 'new'),
};

export function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, rule] of Object.entries(RULES)) out[key] = rule(source[key] ?? DEFAULTS[key]);
  return out;
}

export function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  if (!raw) {
    // Migración: conserva la paleta que ya habías elegido con la versión anterior.
    try {
      const old = localStorage.getItem('sakuga.theme');
      if (old) raw = { palette: old };
    } catch { /* sin almacenamiento */ }
  }
  return normalize(raw);
}

export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* modo privado */ }
}

export function resetSettings() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('sakuga.theme');
  } catch { /* sin almacenamiento */ }
  return normalize(null);
}

export function resolveMode(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const hexToRgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export function applyAppearance(settings) {
  const root = document.documentElement;
  const mode = resolveMode(settings.mode);
  root.dataset.theme = settings.palette;
  root.dataset.mode = mode;
  root.dataset.oled = String(settings.oled && mode === 'dark');
  root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full';

  if (settings.accent) {
    const [r, g, b] = hexToRgb(settings.accent);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    root.style.setProperty('--accent-ink', luminance > 0.55 ? '#14110a' : '#ffffff');
  } else {
    for (const prop of ['--accent', '--accent-rgb', '--accent-ink']) root.style.removeProperty(prop);
  }

  // El color de la barra del sistema sigue al fondo real del tema activo.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);

  for (const swatch of document.querySelectorAll('[data-theme-choice]')) {
    swatch.setAttribute('aria-checked', String(swatch.dataset.themeChoice === settings.palette));
  }
}

/* ── Borrador del prompt ──────────────────────── */
export function loadDraft() {
  try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
}
export function saveDraft(text) {
  try { localStorage.setItem(DRAFT_KEY, text); } catch { /* modo privado */ }
}
