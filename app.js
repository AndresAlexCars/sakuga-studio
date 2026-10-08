import { api, ApiError, hasAccessCode, setAccessCode } from './api.js';

const $ = (selector) => document.querySelector(selector);
const PREFS_KEY = 'sakuga.prefs';

const IDEAS = [
  'Una espadachina de pelo plateado bajo un cerezo en flor, pétalos al viento y luz de atardecer',
  'Un joven mago con túnica estrellada abriendo un libro del que sale una constelación',
  'Una chica con paraguas transparente en una calle de Tokio bajo la lluvia, reflejos de neón',
  'Un zorro de nueve colas guardando la entrada de un santuario en un bosque de bambú',
  'Dos amigos en bicicleta cuesta abajo junto al mar en verano, cielo enorme con nubes',
  'Una piloto de mechas en la cabina, casco bajo el brazo, ciudad en ruinas al fondo',
  'Una pastelera con delantal rosa sacando un pastel de un horno de leña, cocina acogedora',
  'Un tren nocturno flotando sobre un lago de estrellas, pasajeros mirando por la ventana',
];

const STAGES = ['Interpretando tu prompt', 'Dibujando líneas y formas', 'Aplicando color y luz', 'Últimos detalles'];

const state = {
  config: null,
  history: [],
  current: null,
  busy: false,
  timer: null,
  prefs: { style: 'anime', ratio: '1:1', resolution: 'md', quality: 'fast' },
};

const els = {
  form: $('#form'), prompt: $('#prompt'), count: $('#count'), idea: $('#idea'),
  styles: $('#styles'), ratios: $('#ratios'), resolutions: $('#resolutions'), qualities: $('#qualities'),
  generate: $('#generate'), estimate: $('#estimate'),
  frame: $('#frame'), img: $('#result'), stageText: $('#stage-text'), elapsed: $('#elapsed'),
  errorText: $('#error-text'), retry: $('#retry'),
  info: $('#result-info'), caption: $('#caption'), meta: $('#meta'),
  actions: $('#actions'), download: $('#download'), regenerate: $('#regenerate'), remove: $('#remove'),
  grid: $('#grid'), historyEmpty: $('#history-empty'), historyCount: $('#history-count'), clear: $('#clear'),
  toast: $('#toast'), confirm: $('#confirm'),
  gate: $('#gate'), gateForm: $('#gate-form'), gateInput: $('#gate-input'), gateError: $('#gate-error'),
};

/* ── Utilidades ─────────────────────────────── */
const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollToTop = () => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
const labelOf = (list, id) => list.find((x) => x.id === id)?.label ?? id;

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function loadPrefs() {
  try {
    Object.assign(state.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
  } catch { /* se usan los valores por defecto */ }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* modo privado */ }
}
function sanitizePrefs() {
  const { styles, ratios, resolutions, qualities } = state.config;
  const pick = (list, value) => (list.some((x) => x.id === value) ? value : list[0].id);
  state.prefs.style = pick(styles, state.prefs.style);
  state.prefs.ratio = pick(ratios, state.prefs.ratio);
  state.prefs.resolution = pick(resolutions, state.prefs.resolution);
  state.prefs.quality = pick(qualities, state.prefs.quality);
}

/* ── Opciones ───────────────────────────────── */
function ratioGlyph(w, h) {
  const glyph = document.createElement('i');
  glyph.className = 'glyph';
  glyph.setAttribute('aria-hidden', 'true');
  const k = 18 / Math.max(w, h);
  glyph.style.width = `${Math.round(w * k)}px`;
  glyph.style.height = `${Math.round(h * k)}px`;
  return glyph;
}

function renderChoices(container, key, options, decorate) {
  container.replaceChildren();
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'choice';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = key;
    input.value = option.id;
    input.checked = state.prefs[key] === option.id;
    input.addEventListener('change', () => {
      state.prefs[key] = option.id;
      savePrefs();
      onPrefsChanged();
    });

    const face = document.createElement('span');
    face.className = 'choice__face';
    if (decorate) face.append(decorate(option));
    const text = document.createElement('span');
    text.textContent = option.label;
    face.append(text);
    if (option.hint) {
      const hint = document.createElement('small');
      hint.textContent = option.hint;
      face.append(hint);
    }
    label.append(input, face);
    container.append(label);
  }
}

function currentSize() {
  return state.config.sizes[state.prefs.ratio][state.prefs.resolution];
}

function setFrameRatio(width, height) {
  els.frame.style.setProperty('--ratio', String(width / height));
}

function updateEstimate() {
  const { width, height } = currentSize();
  const quality = state.config.qualities.find((q) => q.id === state.prefs.quality);
  const cost = ((width * height) / 1e6) * quality.pricePerMP;
  const price = cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2);
  els.estimate.textContent = `${width}×${height} px, costo aprox. US$${price}`;
}

function onPrefsChanged() {
  updateEstimate();
  const s = els.frame.dataset.state;
  if (s === 'empty' || s === 'error') {
    const { width, height } = currentSize();
    setFrameRatio(width, height);
  }
}

function applyPrefsToUi() {
  for (const [key, container] of [['style', els.styles], ['ratio', els.ratios], ['resolution', els.resolutions], ['quality', els.qualities]]) {
    for (const input of container.querySelectorAll('input')) input.checked = input.value === state.prefs[key];
  }
  onPrefsChanged();
}

/* ── Lienzo ─────────────────────────────────── */
function setFrameState(next) {
  els.frame.dataset.state = next;
  els.frame.setAttribute('aria-busy', String(next === 'loading'));
}

function chip(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function showResult(item) {
  state.current = item;
  setFrameRatio(item.width, item.height);
  els.img.alt = item.prompt;
  els.img.src = item.url;
  setFrameState('ready');

  els.caption.textContent = item.prompt;
  els.meta.replaceChildren(
    chip(labelOf(state.config.styles, item.style)),
    chip(item.ratio),
    chip(`${item.width}×${item.height}`),
    chip(labelOf(state.config.qualities, item.quality)),
  );
  els.download.href = item.url;
  els.download.download = `sakuga-${item.id.slice(0, 8)}.${item.url.split('.').pop()}`;
  els.info.hidden = false;
  els.actions.hidden = false;
  renderHistory();
}

function clearStage() {
  state.current = null;
  els.img.removeAttribute('src');
  els.info.hidden = true;
  els.actions.hidden = true;
  setFrameState('empty');
  const { width, height } = currentSize();
  setFrameRatio(width, height);
  renderHistory();
}

function showError(message) {
  els.errorText.textContent = message;
  els.info.hidden = true;
  els.actions.hidden = true;
  setFrameState('error');
}

function startProgress() {
  const t0 = Date.now();
  els.stageText.textContent = STAGES[0];
  els.elapsed.textContent = '0 s';
  state.timer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    els.elapsed.textContent = `${s} s`;
    els.stageText.textContent = STAGES[Math.min(Math.floor(s / 4), STAGES.length - 1)];
  }, 500);
}
function stopProgress() {
  clearInterval(state.timer);
  state.timer = null;
}

function setBusy(busy) {
  state.busy = busy;
  els.generate.disabled = busy;
  els.generate.textContent = busy ? 'Generando…' : 'Generar';
  els.regenerate.disabled = busy;
  els.remove.disabled = busy;
}

/* ── Generar ────────────────────────────────── */
async function generate() {
  if (state.busy) return;
  const prompt = els.prompt.value.trim();
  if (prompt.length < 3) {
    toast('Describe tu imagen con al menos 3 caracteres.');
    els.prompt.focus();
    return;
  }

  setBusy(true);
  const { width, height } = currentSize();
  setFrameRatio(width, height);
  els.info.hidden = true;
  els.actions.hidden = true;
  setFrameState('loading');
  startProgress();
  setView('create');
  scrollToTop();

  try {
    const item = await api.generate({ prompt, ...state.prefs });
    state.history.unshift(item);
    showResult(item);
    toast('Imagen lista');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setFrameState(state.current ? 'ready' : 'empty');
      openGate();
    } else {
      showError(err.message);
    }
  } finally {
    stopProgress();
    setBusy(false);
  }
}

function regenerate() {
  const item = state.current;
  if (item) {
    els.prompt.value = item.prompt;
    Object.assign(state.prefs, { style: item.style, ratio: item.ratio, resolution: item.resolution, quality: item.quality });
    savePrefs();
    applyPrefsToUi();
    updateCount();
  }
  generate();
}

async function removeCurrent() {
  const item = state.current;
  if (!item || state.busy) return;
  try {
    await api.remove(item.id);
    state.history = state.history.filter((h) => h.id !== item.id);
    clearStage();
    toast('Imagen eliminada');
  } catch (err) {
    toast(err.message);
  }
}

/* ── Historial ──────────────────────────────── */
function thumb(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'thumb';
  button.setAttribute('aria-label', `Abrir: ${item.prompt}`);
  if (state.current?.id === item.id) button.setAttribute('aria-current', 'true');
  button.style.aspectRatio = `${item.width} / ${item.height}`;

  const img = document.createElement('img');
  img.src = item.url;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  button.append(img);

  button.addEventListener('click', () => {
    showResult(item);
    setView('create');
    scrollToTop();
  });
  return button;
}

function renderHistory() {
  const n = state.history.length;
  els.grid.replaceChildren(...state.history.map(thumb));
  els.historyCount.textContent = n ? `${n} ${n === 1 ? 'imagen' : 'imágenes'}` : '';
  els.historyEmpty.hidden = n > 0;
  els.clear.hidden = n === 0;
}

async function loadHistory() {
  try {
    const { items } = await api.history();
    state.history = items;
    renderHistory();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) openGate();
    else toast(err.message);
  }
}

/* ── Vistas (móvil) ─────────────────────────── */
function setView(view) {
  document.body.dataset.view = view;
  for (const button of document.querySelectorAll('[data-view-target]')) {
    if (button.dataset.viewTarget === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

/* ── Código de acceso ───────────────────────── */
function openGate() {
  els.gateError.textContent = '';
  els.gateInput.value = '';
  if (!els.gate.open) els.gate.showModal();
  els.gateInput.focus();
}

els.gate.addEventListener('cancel', (event) => event.preventDefault());
els.gateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAccessCode(els.gateInput.value.trim());
  try {
    const { items } = await api.history();
    state.history = items;
    renderHistory();
    els.gate.close();
  } catch (err) {
    els.gateError.textContent = err.message;
  }
});

/* ── Eventos ────────────────────────────────── */
function updateCount() {
  els.count.textContent = `${els.prompt.value.length}/${els.prompt.maxLength}`;
}

els.prompt.addEventListener('input', updateCount);
els.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    generate();
  }
});
els.idea.addEventListener('click', () => {
  els.prompt.value = IDEAS[Math.floor(Math.random() * IDEAS.length)];
  updateCount();
  els.prompt.focus();
});
els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  generate();
});
els.retry.addEventListener('click', generate);
els.regenerate.addEventListener('click', regenerate);
els.remove.addEventListener('click', removeCurrent);

els.clear.addEventListener('click', () => {
  els.confirm.returnValue = '';
  els.confirm.showModal();
});
els.confirm.addEventListener('close', async () => {
  if (els.confirm.returnValue !== 'ok') return;
  try {
    await api.clear();
    state.history = [];
    clearStage();
    toast('Historial borrado');
  } catch (err) {
    toast(err.message);
  }
});

for (const button of document.querySelectorAll('[data-view-target]')) {
  button.addEventListener('click', () => {
    setView(button.dataset.viewTarget);
    scrollToTop();
  });
}

/* ── Arranque ───────────────────────────────── */
async function init() {
  loadPrefs();
  try {
    state.config = await api.config();
  } catch (err) {
    showError(err.message);
    return;
  }
  sanitizePrefs();
  els.prompt.maxLength = state.config.maxPromptLength;
  updateCount();

  renderChoices(els.styles, 'style', state.config.styles);
  renderChoices(els.ratios, 'ratio', state.config.ratios, (r) => ratioGlyph(r.w, r.h));
  renderChoices(els.resolutions, 'resolution', state.config.resolutions);
  renderChoices(els.qualities, 'quality', state.config.qualities);
  onPrefsChanged();
  const { width, height } = currentSize();
  setFrameRatio(width, height);
  renderHistory();

  if (state.config.requiresAccessCode && !hasAccessCode()) {
    openGate();
    return;
  }
  await loadHistory();
}

init();
