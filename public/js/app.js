// Almacenamiento seguro: en algunos navegadores integrados localStorage es null y no debe romper la app.
const safeGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const safeSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } };
import { api, ApiError, hasAccessCode, setAccessCode } from './api.js';
import { ideas, setLanguage, t, tl } from './i18n.js';
import { applyAppearance, loadDraft, loadSettings, normalize, resetSettings, saveDraft, saveSettings } from './settings.js';
import { initSettingsPanel } from './settingsPanel.js';
import { filterHistory, shortDate, loadFavIds, saveFavIds, onlyFavorites } from './history.js';
import { getLanguage } from './i18n.js';

// Diagnóstico visible: si algo falla en la página, el error aparece en una caja roja arriba.
function showJsError(message) {
  let box = document.getElementById('js-error');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'js-error';
    box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:9999;background:#3a0a14;color:#fff;padding:10px;font:12px/1.4 monospace;white-space:pre-wrap;border-radius:10px;max-height:40vh;overflow:auto;';
    document.body.append(box);
  }
  box.textContent += message + '\n';
}
window.addEventListener('error', (event) => showJsError(`ERROR: ${event.message} (${event.filename || 'archivo'}:${event.lineno || 0})`));
window.addEventListener('unhandledrejection', (event) => showJsError(`PROMESA: ${event.reason?.message || event.reason}`));
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('El servidor tarda demasiado en responder. Espera 30 segundos y recarga la página.')), ms)),
]);

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
  'Montañas nevadas al amanecer con niebla suave y cielo rosado, composición vertical limpia',
  'Ciudad futurista de noche con luces de neón y lluvia, vista amplia panorámica',
  'Retrato realista de una mujer joven con pecas y pelo ondulado, luz natural suave',
  'Valle amplio con un río serpenteante al atardecer, montañas al fondo y cielo dramático',
  'Logo minimalista de un zorro geométrico, colores naranja y negro, estilo moderno',
];

const STAGES = ['Interpretando tu prompt', 'Dibujando líneas y formas', 'Aplicando color y luz', 'Últimos detalles'];

let settings = loadSettings();
let panel = null;
const favs = loadFavIds();
let favOnly = false;

const THUMB_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9A2 2 0 0 0 19.7 9H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>';
const SAVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 20h16"/></svg>';

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
  generate: $('#generate'), estimate: $('#estimate'), imageProviders: $('#image-providers'),
  frame: $('#frame'), img: $('#result'), stageText: $('#stage-text'), elapsed: $('#elapsed'),
  errorText: $('#error-text'), retry: $('#retry'),
 info: $('#result-info'), caption: $('#caption'), meta: $('#meta'),
  actions: $('#actions'), download: $('#download'), regenerate: $('#regenerate'), remove: $('#remove'),
  search: $('#history-search'), favFilter: $('#history-fav-filter'), grid: $('#grid'), historyEmpty: $('#history-empty'), historyCount: $('#history-count'), clear: $('#clear'),
  toast: $('#toast'), confirm: $('#confirm'), settingsDialog: $('#settings'),
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
    Object.assign(state.prefs, JSON.parse(safeGet(PREFS_KEY) || '{}'));
  } catch { /* se usan los valores por defecto */ }
}
function savePrefs() {
  try { safeSet(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* modo privado */ }
}
function sanitizePrefs() {
  const { styles, ratios, resolutions, qualities } = state.config;
  const pick = (list, value) => (list.some((x) => x.id === value) ? value : list[0].id);
  state.prefs.style = pick(styles, state.prefs.style);
  state.prefs.ratio = pick(ratios, state.prefs.ratio);
  state.prefs.resolution = pick(resolutions, state.prefs.resolution);
  state.prefs.quality = pick(qualities, state.prefs.quality);
  state.prefs.imageProvider = state.prefs.imageProvider === 'pollinations' ? 'pollinations' : 'default';
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

      // Auto-selección de ratio para fondos de pantalla
      if (key === 'style') {
        if (option.id === 'wallpaper_mobile') {
          state.prefs.ratio = '9:16';
        } else if (option.id === 'wallpaper_pc') {
          state.prefs.ratio = '16:9';
        }
      }

      savePrefs();
      applyPrefsToUi();
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
  if (state.config.provider === 'cloudflare' && state.prefs.imageProvider !== 'pollinations') return { width: 1024, height: 1024 };
  return state.config.sizes[state.prefs.ratio][state.prefs.resolution];
}

function setFrameRatio(width, height) {
  els.frame.style.setProperty('--ratio', String(width / height));
}

function updateEstimate() {
  if (state.prefs.imageProvider === 'pollinations') {
    els.estimate.textContent = t('estimate.pollinations');
    return;
  }
  if (state.config.provider === 'cloudflare') {
    els.estimate.textContent = t('estimate.free');
    return;
  }
  const { width, height } = currentSize();
  const quality = state.config.qualities.find((q) => q.id === state.prefs.quality);
  const cost = ((width * height) / 1e6) * quality.pricePerMP;
  const price = cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2);
  els.estimate.textContent = t('estimate.paid', { w: width, h: height, price });
}

function onPrefsChanged() {
  document.body.dataset.image = state.prefs.imageProvider;
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
    chip(tl('style', item.style, labelOf(state.config.styles, item.style))),
    chip(item.ratio),
    chip(`${item.width}×${item.height}`),
    chip(tl('quality', item.quality, labelOf(state.config.qualities, item.quality))),
  );
  els.download.href = item.url;
  const openTab = $('#open-tab');
  if (openTab) openTab.href = item.url;
  els.download.download = `jordvex-${item.id.slice(0, 8)}.${item.url.split('.').pop()}`;
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
  els.stageText.textContent = t('stage.0');
  els.elapsed.textContent = '0 s';
  state.timer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    els.elapsed.textContent = `${s} s`;
    els.stageText.textContent = t(`stage.${Math.min(Math.floor(s / 4), STAGES.length - 1)}`);
  }, 500);
}
function stopProgress() {
  clearInterval(state.timer);
  state.timer = null;
}

function setBusy(busy) {
  state.busy = busy;
  els.generate.disabled = busy;
  els.generate.textContent = busy ? t('generating') : t('generate');
  els.regenerate.disabled = busy;
  els.remove.disabled = busy;
}
/* ── Generar ────────────────────────────────── */
async function generate() {
  if (state.busy) return;
  const prompt = els.prompt.value.trim();
  if (prompt.length < 3) {
    toast(t('toast.shortPrompt'));
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
    toast(t('toast.ready'));
    if (settings.vibrate && navigator.vibrate) navigator.vibrate(60);
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
    toast(t('toast.removed'));
  } catch (err) {
    toast(err.message);
  }
}

/* ── Historial ──────────────────────────────── */
function thumbButton(item) {
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

  // Pie con estilo y fecha: así cada miniatura se identifica sin abrirla.
  const caption = document.createElement('span');
  caption.className = 'thumb__meta';
  const styleName = tl('style', item.style, labelOf(state.config.styles, item.style));
  caption.textContent = [styleName, shortDate(item.createdAt, getLanguage() === 'en' ? 'en' : 'es')].filter(Boolean).join(' · ');
  if (settings.showCaptions) button.append(caption);

  button.addEventListener('click', () => {
    showResult(item);
    setView('create');
    scrollToTop();
  });
  return button;
}

function thumbTools(item) {
  const tools = document.createElement('div');
  tools.className = 'thumb__tools';

  const isFav = favs.has(item.id);
  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'thumb__btn';
  star.setAttribute('aria-pressed', String(isFav));
  star.setAttribute('aria-label', t(isFav ? 'history.unfav' : 'history.fav'));
  star.innerHTML = THUMB_ICON;
  star.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFav(item.id);
  });

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'thumb__btn';
  share.setAttribute('aria-label', t('history.share'));
  share.innerHTML = SHARE_ICON;
  share.addEventListener('click', (event) => {
    event.stopPropagation();
    shareItem(item);
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'thumb__btn';
  save.setAttribute('aria-label', t('history.save'));
  save.innerHTML = SAVE_ICON;
  save.addEventListener('click', (event) => {
    event.stopPropagation();
    saveItem(item);
  });

  tools.append(star, share, save);
  return tools;
}

function thumb(item) {
  const wrap = document.createElement('div');
  wrap.className = 'thumb-wrap';
  wrap.append(thumbButton(item), thumbTools(item));
  return wrap;
}

function toggleFav(id) {
  if (favs.has(id)) favs.delete(id);
  else favs.add(id);
  saveFavIds(favs);
  renderHistory();
}

function saveItem(item) {
  const link = document.createElement('a');
  link.href = item.url;
  link.download = `jordvex-${item.id.slice(0, 8)}.${item.url.split('.').pop()}`;
  document.body.append(link);
  link.click();
  link.remove();
}

async function shareItem(item) {
  const name = `jordvex-${item.id.slice(0, 8)}.${item.url.split('.').pop()}`;
  try {
    const blob = await (await fetch(item.url)).blob();
    const file = new File([blob], name, { type: blob.type || 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: state.config.appName, text: item.prompt });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(new URL(item.url, location.origin).href);
    toast(t('history.linkCopied'));
  } catch {
    toast(t('history.shareFail'));
  }
}

function renderHistory() {
  const n = state.history.length;
  const visible = onlyFavorites(filterHistory(state.history, els.search?.value ?? ''), favs, favOnly);
  const ordered = settings.sort === 'old' ? [...visible].reverse() : visible;
  els.grid.replaceChildren(...ordered.map(thumb));
  if (els.search) els.search.hidden = n === 0;
  const empty = n > 0 && visible.length === 0;
  if (els.favFilter) els.favFilter.hidden = n === 0;
  els.historyEmpty.textContent = !empty ? t('history.empty') : favOnly ? t('history.noFavs') : t('history.noResults');
  els.historyCount.textContent = n ? t(n === 1 ? 'history.count.one' : 'history.count.many', { n }) : '';
  els.historyEmpty.hidden = visible.length > 0;
  els.clear.hidden = n === 0;
  syncLikeCurrent();
}

function syncLikeCurrent() {
  const btn = $('#like-current');
  if (!btn) return;
  const on = Boolean(state.current && favs.has(state.current.id));
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('is-liked', on);
  btn.disabled = !state.current;
}

function downloadSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'jordvex-ajustes.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importSettings(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('formato');
    settings = normalize(data);
    saveSettings(settings);
    applyAppearance(settings);
    applyLanguage();
    renderHistory();
    panel?.sync();
    toast(t('settings.loaded'));
  } catch {
    toast(t('settings.badFile'));
  }
}

const chatEls = { dialog: $('#chat'), log: $('#chat-log'), form: $('#chat-form'), input: $('#chat-input'), send: $('#chat-send'), provider: $('#chat-provider') };
const chatMessages = [];

function addBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat__msg chat__msg--${role}`;
  bubble.textContent = text;
  chatEls.log.append(bubble);
  chatEls.log.scrollTop = chatEls.log.scrollHeight;
  return bubble;
}

$('#nav-chat')?.addEventListener('click', () => {
  if (!chatEls.dialog.open) chatEls.dialog.showModal();
  chatEls.input.focus();
});
chatEls.dialog?.querySelector('[data-close-chat]')?.addEventListener('click', () => chatEls.dialog.close());
chatEls.dialog?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
chatEls.form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = chatEls.input.value.trim();
  if (!text || chatEls.send.disabled) return;
  chatEls.input.value = '';
  addBubble('user', text);
  chatMessages.push({ role: 'user', content: text });
  const pending = addBubble('bot', t('chat.thinking'));
  pending.classList.add('is-typing');
  chatEls.send.disabled = true;
  try {
    const { reply } = await api.chat(chatMessages.slice(-12), chatEls.provider?.value || 'cloudflare');
    pending.textContent = reply;
    pending.classList.remove('is-typing');
    chatMessages.push({ role: 'assistant', content: reply });
  } catch (err) {
    pending.remove();
    chatMessages.pop();
    toast(err.message);
  } finally {
    chatEls.send.disabled = false;
    chatEls.input.focus();
  }
});

$('#like-current')?.addEventListener('click', () => {
  if (state.current) toggleFav(state.current.id);
});

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
  if (view === 'wallpapers') loadWallpapers();
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
  els.count.textContent = `${els.prompt.value.length} / ${els.prompt.maxLength}`;
}


els.prompt.addEventListener('input', () => {
  updateCount();
  if (settings.saveDraft) saveDraft(els.prompt.value);
});
els.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    generate();
  }
});
els.idea.addEventListener('click', () => {
  const list = ideas();
  els.prompt.value = list[Math.floor(Math.random() * list.length)];
  updateCount();
  els.prompt.focus();
});
els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  generate();
});
els.retry.addEventListener('click', generate);
els.search?.addEventListener('input', renderHistory);
$('#nav-fav')?.addEventListener('click', () => {
  favOnly = true;
  els.favFilter?.setAttribute('aria-pressed', 'true');
  setView('history');
  renderHistory();
  scrollToTop();
});
$('#prompt-paste')?.addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return;
    els.prompt.value = text.slice(0, els.prompt.maxLength);
    updateCount();
    if (settings.saveDraft) saveDraft(els.prompt.value);
  } catch {
    toast(t('prompt.pasteFail'));
  }
});
$('#prompt-clear')?.addEventListener('click', () => {
  els.prompt.value = '';
  updateCount();
  if (settings.saveDraft) saveDraft('');
  els.prompt.focus();
});
$('#copy-prompt')?.addEventListener('click', async () => {
  if (!state.current) return;
  try {
    await navigator.clipboard.writeText(state.current.prompt);
    toast(t('toast.promptCopied'));
  } catch {
    toast(t('settings.copyFail'));
  }
});
$('#use-prompt')?.addEventListener('click', () => {
  if (!state.current) return;
  els.prompt.value = state.current.prompt;
  updateCount();
  setView('create');
  scrollToTop();
  toast(t('toast.promptUsed'));
});
$('#view-full')?.addEventListener('click', () => {
  if (!state.current) return;
  $('#viewer-img').src = state.current.url;
  $('#viewer-img').alt = state.current.prompt;
  $('#viewer').showModal();
});
$('#viewer')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget || event.target.closest('[data-close-viewer]')) event.currentTarget.close();
});
const brandEl = document.querySelector('.brand');
brandEl?.addEventListener('click', () => {
  const star = $('#brand-star');
  if (star) {
    star.classList.remove('girar');
    void star.getBoundingClientRect();
    star.classList.add('girar');
    star.addEventListener('animationend', () => star.classList.remove('girar'), { once: true });
  }
  if (prefersReducedMotion() || document.documentElement.dataset.motion === 'reduced') return;
  const rect = brandEl.getBoundingClientRect();
  const count = 16;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'destello';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.35;
    const dist = 60 + Math.random() * 70;
    piece.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    piece.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    piece.style.setProperty('--d', `${0.6 + Math.random() * 0.4}s`);
    piece.style.left = `${rect.left + 26}px`;
    piece.style.top = `${rect.top + rect.height / 2}px`;
    document.body.append(piece);
    piece.addEventListener('animationend', () => piece.remove(), { once: true });
  }
});
document.querySelector('[data-view-target="history"]')?.addEventListener('click', () => {
  favOnly = false;
  renderHistory();
});
els.favFilter?.addEventListener('click', () => {
  favOnly = !favOnly;
  els.favFilter.setAttribute('aria-pressed', String(favOnly));
  renderHistory();
});
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
    toast(t('toast.cleared'));
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

/* ── Ajustes ────────────────────────────────── */
function localized(list, group) {
  return list.map((option) => ({
    ...option,
    label: tl(group, option.id, option.label),
    hint: option.hint ? tl(`${group}.hint`, option.id, option.hint) : option.hint,
  }));
}

function renderAllChoices() {
  renderChoices(els.imageProviders, 'imageProvider', [
    { id: 'default', label: state.config.provider === 'cloudflare' ? 'Cloudflare · FLUX' : 'fal.ai · FLUX' },
    { id: 'pollinations', label: 'Pollinations · FLUX' },
  ]);
  renderChoices(els.styles, 'style', localized(state.config.styles, 'style'));
  renderChoices(els.ratios, 'ratio', state.config.ratios, (r) => ratioGlyph(r.w, r.h));
  renderChoices(els.resolutions, 'resolution', localized(state.config.resolutions, 'res'));
  renderChoices(els.qualities, 'quality', localized(state.config.qualities, 'quality'));
}

function applyLanguage() {
  setLanguage(settings.lang);
  if (!state.config) return;
  document.title = `${state.config.appName}: ${t('title')}`;
  renderAllChoices();
  updateEstimate();
  els.generate.textContent = state.busy ? t('generating') : t('generate');
  renderHistory();
  panel?.rebuild();
}

function updateSettings(partial) {
  settings = { ...settings, ...partial };
  saveSettings(settings);
  applyAppearance(settings);
  if ('lang' in partial) applyLanguage();
  if ('sort' in partial || 'showCaptions' in partial) renderHistory();
  panel?.sync();
}

async function exportSettings() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
    toast(t('settings.copied'));
  } catch {
    toast(t('settings.copyFail'));
  }
}

function restoreDefaults() {
  if (!window.confirm(t('settings.resetAsk'))) return;
  settings = resetSettings();
  applyAppearance(settings);
  applyLanguage();
  toast(t('settings.resetDone'));
}

for (const swatch of document.querySelectorAll('[data-theme-choice]')) {
  swatch.addEventListener('click', () => updateSettings({ palette: swatch.dataset.themeChoice }));
}
for (const opener of document.querySelectorAll('[data-open-settings]')) {
  opener.addEventListener('click', () => panel?.open());
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (settings.mode === 'auto') applyAppearance(settings);
});
applyAppearance(settings);

/* ── Arranque ───────────────────────────────── */
async function init() {
  loadPrefs();
  setLanguage(settings.lang);
  try {
    state.config = await withTimeout(api.config(), 20000);
  } catch (err) {
    showError(err.message);
    return;
  }
  document.body.dataset.provider = state.config.provider;
  $('#brand-name').textContent = state.config.appName;
  document.title = `${state.config.appName}: ${t('title')}`;
  sanitizePrefs();
  els.prompt.maxLength = state.config.maxPromptLength;
  if (settings.saveDraft && !els.prompt.value) els.prompt.value = loadDraft();
  updateCount();

  renderAllChoices();
  panel = initSettingsPanel({
    dialog: els.settingsDialog,
    getSettings: () => settings,
    update: updateSettings,
    onReset: restoreDefaults,
    onExport: exportSettings,
    onClearHistory: () => els.clear.click(),
    provider: state.config.provider,
    appName: state.config.appName,
    count: () => state.history.length,
    onDownload: downloadSettings,
    onImport: importSettings,
  });
  onPrefsChanged();
  const { width, height } = currentSize();
  setFrameRatio(width, height);
  renderHistory();

  if (state.config.requiresAccessCode && !hasAccessCode()) {
    openGate();
    return;
  }
  const owner = Boolean(safeGet('sakuga.adminCode')) || safeGet('sakuga.owner') === '1' || new URLSearchParams(location.search).has('admin');
  if (!owner) {
    document.body.dataset.role = 'visitor';
    setView('wallpapers');
    return;
  }
  await loadHistory();
}

init();

// Ayuda con icono: el texto aparece como subtítulo y la ayuda se cierra sola a los 6 s.
document.addEventListener?.('toggle', (event) => {
  const info = event.target;
  if (!(info instanceof HTMLDetailsElement) || !info.classList.contains('info') || !info.open) return;
  clearTimeout(info._autoClose);
  info._autoClose = setTimeout(() => { info.open = false; }, 6000);
}, true);

// Novedades: se muestran cada vez que se entra al sitio (si no hay código de acceso pendiente).
(() => {
  const dialog = document.getElementById?.('welcome');
  if (!dialog) return;
  dialog.querySelectorAll('[data-close-welcome]').forEach((btn) => btn.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  setTimeout(() => {
    const gate = document.getElementById?.('gate');
    if (!gate?.open && !dialog.open) dialog.showModal();
  }, 900);
})();

/* ── Fondos para descargar (solo el administrador puede publicar) ── */
const wall = {
  grid: $('#wall-grid'), empty: $('#wall-empty'), code: $('#admin-code'), kind: $('#wall-kind'),
  title: $('#wall-title'), file: $('#wall-file'), upload: $('#wall-upload'),
};
const WALL_CODE_KEY = 'sakuga.adminCode';
// El panel solo aparece en tu dispositivo: entra una vez con ?admin=1 y escribe tu código.
// Después queda guardado aquí; para los demás, el panel no existe en la página.
let savedAdminCode = '';
try { savedAdminCode = safeGet(WALL_CODE_KEY) || ''; } catch { /* sin almacenamiento */ }
if (new URLSearchParams(location.search).has('admin')) {
  try { safeSet('sakuga.owner', '1'); } catch { /* sin almacenamiento */ }
}
const isOwnerDevice = Boolean(savedAdminCode) || safeGet('sakuga.owner') === '1';
if (wall.code) wall.code.value = savedAdminCode;
if (!isOwnerDevice) {
  document.getElementById('wall-admin')?.remove();
} else {
  document.getElementById('wall-admin')?.setAttribute('open', '');
}
wall.code?.addEventListener('input', () => {
  try { safeSet(WALL_CODE_KEY, wall.code.value.trim()); } catch { /* modo privado */ }
});

function wallCard(item) {
  const card = document.createElement('article');
  card.className = `wall-card wall-card--${item.kind}`;
  const media = document.createElement('div');
  media.className = 'wall-card__media';
  const img = document.createElement('img');
  img.src = item.url;
  img.alt = item.title;
  img.loading = 'lazy';
  img.decoding = 'async';
  const quality = document.createElement('span');
  quality.className = 'wall-card__quality';
  quality.textContent = 'ANALIZANDO';
  quality.setAttribute('aria-live', 'polite');
  const detectImageQuality = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) { quality.textContent = 'CALIDAD N/D'; quality.dataset.level = 'unknown'; return; }
    const longest = Math.max(w, h);
    let label = 'CALIDAD ESTÁNDAR', level = 'standard';
    if (longest >= 3840) { label = '4K · ULTRA PREMIUM'; level = 'ultra'; }
    else if (longest >= 2560) { label = '2K · PREMIUM'; level = 'premium'; }
    else if (longest >= 1920) { label = 'FULL HD'; level = 'high'; }
    else if (longest >= 1280) { label = 'HD'; level = 'medium'; }
    else { label = 'CALIDAD BÁSICA'; level = 'basic'; }
    quality.textContent = label;
    quality.dataset.level = level;
    quality.title = label;
  };
  img.addEventListener('load', detectImageQuality, { once: true });
  img.addEventListener('error', () => { quality.textContent = 'CALIDAD N/D'; quality.dataset.level = 'unknown'; }, { once: true });
  if (img.complete && img.naturalWidth) detectImageQuality();
  media.append(img, quality);
  const info = document.createElement('div');
  info.className = 'wall-card__info';
  const title = document.createElement('strong');
  title.textContent = item.title;
  const tag = document.createElement('span');
  tag.className = 'wall-card__tag';
  tag.textContent = item.kind === 'pc' ? 'PC · horizontal' : 'Móvil · vertical';
  const download = document.createElement('a');
  download.className = 'btn btn--primary-soft wall-card__dl';
  download.href = item.url;
  download.download = item.downloadName;
  download.textContent = 'Descargar';
  download.addEventListener('click', () => api.viewWallpaper(item.id).catch(() => {}));
  const WALL_REACTIONS = ['👍', '❤️', '😍', '😮', '😂', '😢'];
  const counts = item.reactions || {};
  const total = WALL_REACTIONS.reduce((n, e) => n + (counts[e] || 0), 0);
  const bar = document.createElement('div');
  bar.className = 'wall-react';
  const react = async (emoji) => {
    try {
      await api.reactWallpaper(item.id, emoji);
      await loadWallpapers();
    } catch (err) {
      toast(err.message);
    }
  };
  // Botón principal: toca para dar tu reacción; toca otra vez para quitarla
  const mainBtn = document.createElement('button');
  mainBtn.type = 'button';
  mainBtn.className = 'wall-react__main' + (item.mine ? ' is-on' : '');
  mainBtn.setAttribute('aria-label', item.mine ? 'Quitar mi reacción' : 'Reaccionar');
  mainBtn.textContent = `${item.mine || '♡'} ${total}`;
  mainBtn.addEventListener('click', () => react(item.mine || '👍'));
  // Botón +: abre la bandeja con todas las reacciones
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'wall-react__more';
  moreBtn.textContent = '+';
  moreBtn.setAttribute('aria-label', 'Más reacciones');
  moreBtn.setAttribute('aria-expanded', 'false');
  const picker = document.createElement('div');
  picker.className = 'wall-react__picker';
  picker.hidden = true;
  for (const emoji of WALL_REACTIONS) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'wall-react__opt' + (item.mine === emoji ? ' is-on' : '');
    opt.setAttribute('aria-label', `Reaccionar ${emoji}`);
    opt.innerHTML = `<span>${emoji}</span><small>${counts[emoji] || 0}</small>`;
    opt.addEventListener('click', () => react(emoji));
    picker.append(opt);
  }
  moreBtn.addEventListener('click', () => {
    picker.hidden = !picker.hidden;
    moreBtn.setAttribute('aria-expanded', String(!picker.hidden));
  });
  bar.append(mainBtn, moreBtn, picker);
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'btn btn--primary-soft wall-card__dl';
  preview.textContent = 'Vista previa';
  preview.addEventListener('click', () => openPreview(item));
  const views = document.createElement('span');
  views.className = 'wall-card__tag';
  views.textContent = `👁 ${item.views ?? 0} vistas`;
  info.append(title, tag, quality, views, bar, preview, download);
  if (isOwnerDevice) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--danger wall-card__del';
    del.textContent = 'Eliminar';
    del.addEventListener('click', async () => {
      const code = wall.code?.value.trim();
      if (!code) return toast('Escribe el código de administrador.');
      if (!window.confirm(`¿Eliminar "${item.title}"? No se puede deshacer.`)) return;
      del.disabled = true;
      try {
        await api.deleteWallpaper(item.id, code);
        toast('Fondo eliminado.');
        await loadWallpapers();
      } catch (err) {
        toast(err.message);
        del.disabled = false;
      }
    });
    info.append(del);
  }
  card.append(media, info);
  return card;
}

let wallAll = [];
let wallKind = 'todos';
let wallVisible = 36;
let wallFiltered = [];
let wallMoreObserver = null;
const normalizeText = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function renderWallpapers() {
  if (!wall.grid) return;
  const query = normalizeText(document.getElementById('wall-search')?.value.trim() || '');
  wallFiltered = wallAll.filter((item) =>
    (wallKind === 'todos' || item.kind === wallKind) &&
    (!query || normalizeText(item.title).includes(query)));
  wallVisible = 36;
  wall.grid.replaceChildren(...wallFiltered.slice(0, wallVisible).map(wallCard));
  // Carga progresiva: agrega tarjetas al acercarse al final, sin recargar la página.
  if (wallMoreObserver) wallMoreObserver.disconnect();
  let sentinel = document.getElementById('wall-load-more');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'wall-load-more';
    sentinel.className = 'wall-load-more';
    sentinel.setAttribute('aria-hidden', 'true');
    wall.grid.after(sentinel);
  }
  sentinel.hidden = wallVisible >= wallFiltered.length;
  wallMoreObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    const next = wallFiltered.slice(wallVisible, wallVisible + 36);
    if (!next.length) { sentinel.hidden = true; return; }
    wall.grid.append(...next.map(wallCard));
    wallVisible += next.length;
    sentinel.hidden = wallVisible >= wallFiltered.length;
  }, { rootMargin: '700px 0px' });
  if (!sentinel.hidden) wallMoreObserver.observe(sentinel);
  const count = document.getElementById('wall-count');
  if (count) count.textContent = `${wallAll.length.toLocaleString('es')} ${wallAll.length === 1 ? 'fondo disponible' : 'fondos disponibles'}`;
  if (wall.empty) {
    wall.empty.hidden = wallAll.length > 0;
    wall.empty.textContent = wallAll.length ? 'Ningún fondo coincide con tu búsqueda.' : 'Todavía no hay fondos publicados.';
  }
}

async function loadWallpapers() {
  if (!wall.grid) return;
  try {
    const { items } = await api.wallpapers();
    wallAll = items;
    renderWallpapers();
  } catch (err) {
    toast(err.message);
  }
}

document.getElementById('wall-search')?.addEventListener('input', renderWallpapers);
document.querySelectorAll('.wall-filters [data-kind]').forEach((btn) => {
  btn.addEventListener('click', () => {
    wallKind = btn.dataset.kind;
    document.querySelectorAll('.wall-filters [data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    renderWallpapers();
  });
});

if (wall.file) wall.file.multiple = true;

// Sube la lista de archivos con los nombres ya editados
async function publishWallpapers(files, titles, code) {
  wall.upload.disabled = true;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < files.length; i++) {
    toast(`Subiendo ${i + 1} de ${files.length}…`);
    try {
      await api.uploadWallpaper(files[i], wall.kind.value, titles[i] || files[i].name.replace(/\.[^.]+$/, ''), code);
      ok += 1;
    } catch (err) {
      fail += 1;
      if (err instanceof ApiError && err.status === 401) {
        toast(err.message);
        break;
      }
    }
  }
  wall.file.value = '';
  wall.title.value = '';
  wall.upload.disabled = false;
  toast(fail ? `Publicados ${ok}. Fallaron ${fail}.` : `Publicados ${ok} fondo${ok === 1 ? '' : 's'}.`);
  await loadWallpapers();
}

// Ventana para cambiar los nombres de cada fondo antes de publicarlos
function openTitleEditor(files, defaults, onConfirm) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.style.cssText = 'width:min(94vw,520px);max-height:88vh;padding:0;';
  const head = document.createElement('div');
  head.className = 'sheet__head';
  const h = document.createElement('h3');
  h.textContent = `Nombres de ${files.length} fondo${files.length === 1 ? '' : 's'}`;
  head.append(h);
  const body = document.createElement('div');
  body.className = 'sheet__body';
  body.style.cssText = 'overflow-y:auto;max-height:60vh;';
  const inputs = files.map((file, i) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:12px;';
    const small = document.createElement('small');
    small.className = 'muted';
    small.textContent = file.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 60;
    input.value = defaults[i];
    input.style.cssText = 'min-height:44px;padding:0 12px;border-radius:12px;background:var(--bg);border:1px solid var(--line);color:var(--text);font:inherit;';
    row.append(small, input);
    body.append(row);
    return input;
  });
  const actions = document.createElement('div');
  actions.className = 'dialog__actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'Cancelar';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn btn--primary';
  go.textContent = 'Publicar todos';
  cancel.addEventListener('click', () => dlg.close());
  go.addEventListener('click', () => {
    const titles = inputs.map((inp) => inp.value.trim());
    dlg.close();
    onConfirm(titles);
  });
  dlg.addEventListener('close', () => dlg.remove());
  actions.append(cancel, go);
  dlg.append(head, body, actions);
  document.body.append(dlg);
  dlg.showModal();
}

wall.upload?.addEventListener('click', () => {
  const files = [...(wall.file?.files || [])];
  const code = wall.code.value.trim();
  if (!files.length) return toast('Elige una o varias imágenes.');
  if (!code) return toast('Escribe el código de administrador.');
  const big = files.find((f) => f.size > 25 * 1024 * 1024);
  if (big) return toast(`"${big.name}" pasa de 25 MB.`);
  const typedTitle = wall.title.value.trim();
  const defaults = files.map((f) => (files.length === 1 && typedTitle ? typedTitle : f.name.replace(/\.[^.]+$/, '').slice(0, 60)));
  openTitleEditor(files, defaults, (titles) => publishWallpapers(files, titles, code));
});

/* ── Videos: pestaña junto a Fondos, con calidad original ── */
const vid = {
  grid: $('#video-grid'), empty: $('#video-empty'), file: $('#video-file'), title: $('#video-title'), upload: $('#video-upload'),
};
function qualityLabel(w, h) {
  const m = Math.max(w, h);
  if (m >= 3840) return '4K';
  if (m >= 2560) return '2K';
  if (m >= 1920) return '1080p';
  if (m >= 1280) return '720p';
  return m ? `${w}×${h}` : 'Calidad no detectada';
}
/* ── Reproductor con estilo propio (no el del teléfono) ── */
function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function buildPlayer(video) {
  const wrap = document.createElement('div');
  wrap.className = 'vp';
  const big = document.createElement('button');
  big.type = 'button';
  big.className = 'vp__big';
  big.setAttribute('aria-label', 'Reproducir');
  big.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  const bar = document.createElement('div');
  bar.className = 'vp__bar';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'vp__btn';
  play.setAttribute('aria-label', 'Reproducir o pausar');
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1000';
  seek.value = '0';
  seek.className = 'vp__seek';
  seek.setAttribute('aria-label', 'Avance del video');
  const time = document.createElement('span');
  time.className = 'vp__time';
  time.textContent = '0:00';
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'vp__btn';
  mute.setAttribute('aria-label', 'Silenciar o activar sonido');
  const full = document.createElement('button');
  full.type = 'button';
  full.className = 'vp__btn';
  full.setAttribute('aria-label', 'Pantalla completa');
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
    vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zM16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  play.innerHTML = ICON.play;
  mute.innerHTML = ICON.vol;
  full.innerHTML = ICON.full;
  const toggle = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
  big.addEventListener('click', toggle);
  play.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  video.addEventListener('play', () => { wrap.classList.add('is-playing'); play.innerHTML = ICON.pause; });
  video.addEventListener('pause', () => { wrap.classList.remove('is-playing'); play.innerHTML = ICON.play; });
  video.addEventListener('ended', () => { wrap.classList.remove('is-playing'); play.innerHTML = ICON.play; });
  video.addEventListener('loadedmetadata', () => { time.textContent = `0:00 / ${fmtTime(video.duration)}`; });
  video.addEventListener('timeupdate', () => {
    if (video.duration) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    time.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
  });
  seek.addEventListener('input', () => {
    if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration;
  });
  mute.addEventListener('click', () => {
    video.muted = !video.muted;
    mute.innerHTML = video.muted ? ICON.mute : ICON.vol;
  });
  full.addEventListener('click', () => {
    const el = video;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitEnterFullscreen) el.webkitEnterFullscreen();
  });
  bar.append(play, seek, time, mute, full);
  wrap.append(video, big, bar);
  return wrap;
}

function youtubeCard(item) {
  const card = document.createElement('article');
  card.className = 'wall-card video-card';
  const frame = document.createElement('div');
  const vertical = item.orientation === 'vertical';
  card.classList.toggle('video-card--tall', vertical);
  card.classList.toggle('video-card--wide', !vertical);
  frame.style.cssText = vertical
    ? 'position:relative;width:min(100%,360px);aspect-ratio:9/16;margin:0 auto;background:#000;border-radius:22px 22px 0 0;overflow:hidden;'
    : 'position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:22px 22px 0 0;overflow:hidden;';
  // Miniatura ligera: el reproductor de YouTube solo se carga al pulsar Reproducir.
  let viewsEl = null;
  let counted = false;
  const countView = () => {
    if (counted) return;
    counted = true;
    api.videoView(item.id).then((r) => {
      if (viewsEl && r && r.views != null) viewsEl.textContent = `${r.views} reproducciones`;
    }).catch(() => {});
  };
  const thumb = document.createElement('img');
  if (!item.streamableId) thumb.src = `https://i.ytimg.com/vi/${encodeURIComponent(item.youtubeId)}/hqdefault.jpg`;
  thumb.alt = item.title;
  thumb.loading = 'lazy';
  thumb.decoding = 'async';
  thumb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.setAttribute('aria-label', 'Reproducir video');
  playBtn.textContent = '▶';
  playBtn.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:68px;height:48px;border:0;border-radius:14px;background:#ff0033;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 10px 30px -8px rgba(0,0,0,.6);';
  playBtn.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = item.streamableId
      ? `https://streamable.com/e/${encodeURIComponent(item.streamableId)}?autoplay=1`
      : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.youtubeId)}?autoplay=1`;
    iframe.title = item.title;
    iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;';
    frame.replaceChildren(iframe);
    countView();
  });
  if (item.streamableId) frame.style.background = 'linear-gradient(135deg,#1b2238,#0b0f1c)';
  frame.append(...(item.streamableId ? [] : [thumb]), playBtn);
  const info = document.createElement('div');
  info.className = 'wall-card__info';
  const title = document.createElement('strong');
  title.textContent = item.title;
  const chips = document.createElement('div');
  chips.className = 'quality-chips';
  const chip = document.createElement('span');
  chip.className = 'quality-chip';
  chip.textContent = item.streamableId ? 'Streamable · reproducción sin descarga' : 'YouTube · reproducción sin descarga';
  viewsEl = document.createElement('span');
  viewsEl.className = 'quality-chip';
  viewsEl.textContent = `${item.views || 0} reproducciones`;
  chips.append(chip, viewsEl);
  info.append(title, chips);
  if (isOwnerDevice) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--danger wall-card__del';
    del.textContent = 'Eliminar';
    del.addEventListener('click', async () => {
      const code = wall.code?.value.trim();
      if (!code) return toast('Escribe el código de administrador.');
      if (!window.confirm(`¿Quitar el video "${item.title}" de la lista?`)) return;
      try {
        await api.deleteVideo(item.id, code);
        toast('Video eliminado.');
        await loadVideos();
      } catch (err) {
        toast(err.message);
      }
    });
    info.append(del);
  }
  card.append(frame, info);
  return card;
}

function ensureYoutubeForm() {
  if (!isOwnerDevice || !vid.grid || document.getElementById('yt-form')) return;
  const box = document.createElement('div');
  box.id = 'yt-form';
  box.className = 'wall-admin__body';
  box.style.cssText = 'margin-bottom:14px;padding:12px;border:1px dashed var(--line);border-radius:16px;';
  const url = document.createElement('input');
  url.type = 'text';
  url.placeholder = 'Enlace de YouTube o Streamable (o pega el código embed)';
  const title = document.createElement('input');
  title.type = 'text';
  title.maxLength = 60;
  title.placeholder = 'Título del video';
  const orient = document.createElement('select');
  orient.setAttribute('aria-label', 'Orientación del video');
  for (const [value, label] of [['horizontal', 'Horizontal (PC)'], ['vertical', 'Vertical (móvil)']]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    orient.append(opt);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--primary';
  add.textContent = 'Añadir video de YouTube';
  add.addEventListener('click', async () => {
    const code = wall.code?.value.trim();
    if (!code) return toast('Escribe el código de administrador.');
    if (!url.value.trim()) return toast('Pega el enlace de YouTube.');
    add.disabled = true;
    try {
      await api.videoYoutube(url.value.trim(), title.value.trim(), code, orient.value);
      toast('Video de YouTube añadido.');
      url.value = '';
      title.value = '';
      await loadVideos();
    } catch (err) {
      toast(err.message);
    } finally {
      add.disabled = false;
    }
  });
  box.append(url, title, orient, add);
  vid.grid.parentElement.insertBefore(box, vid.grid);
}

function videoCard(item) {
  const card = document.createElement('article');
  if (item.youtubeId || item.streamableId) return youtubeCard(item);
  card.className = 'wall-card video-card';
  if (item.width && item.height) card.classList.add(item.width > item.height ? 'video-card--wide' : 'video-card--tall');
  const player = document.createElement('video');
  player.src = item.url;
  player.preload = 'metadata';
  player.loop = true;
  player.playsInline = true;
  if (item.width && item.height) player.style.aspectRatio = `${item.width} / ${item.height}`;
  const info = document.createElement('div');
  info.className = 'wall-card__info';
  const title = document.createElement('strong');
  title.textContent = item.title;
  const chips = document.createElement('div');
  chips.className = 'quality-chips';
  const mb = (item.size / (1024 * 1024)).toFixed(1);
  const fillChips = (w, h, dur) => {
    const list = [
      qualityLabel(w, h),
      w && h ? `${w}×${h}` : null,
      dur ? `${dur} s` : null,
      `${mb} MB`,
      item.mime.replace('video/', '').toUpperCase(),
      item.codec,
      `${item.views || 0} reproducciones`,
      'Original sin recomprimir',
    ].filter(Boolean);
    chips.replaceChildren(...list.map((text) => {
      const chip = document.createElement('span');
      chip.className = 'quality-chip';
      chip.textContent = text;
      return chip;
    }));
  };
  fillChips(item.width, item.height, item.duration);
  // Medidas reales: el navegador las lee del propio video, así orientación y calidad salen bien.
  let reported = false;
  player.addEventListener('loadedmetadata', () => {
    const w = player.videoWidth;
    const h = player.videoHeight;
    if (!w || !h) return;
    const dur = Number.isFinite(player.duration) ? Math.round(player.duration * 10) / 10 : 0;
    card.classList.toggle('video-card--wide', w > h);
    card.classList.toggle('video-card--tall', w <= h);
    player.style.aspectRatio = `${w} / ${h}`;
    fillChips(w, h, dur);
    if ((!item.width || !item.height) && !reported) {
      reported = true;
      api.videoMeta(item.id, { width: w, height: h, duration: dur }).catch(() => {});
    }
  });
  const download = document.createElement('a');
  download.className = 'btn btn--primary-soft wall-card__dl';
  download.href = item.url;
  download.download = item.downloadName;
  download.textContent = 'Descargar video';
  info.append(title, chips, download);
  if (isOwnerDevice) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--danger wall-card__del';
    del.textContent = 'Eliminar';
    del.addEventListener('click', async () => {
      const code = wall.code?.value.trim();
      if (!code) return toast('Escribe el código de administrador.');
      if (!window.confirm(`¿Eliminar el video "${item.title}"? No se puede deshacer.`)) return;
      try {
        await api.deleteVideo(item.id, code);
        toast('Video eliminado.');
        await loadVideos();
      } catch (err) {
        toast(err.message);
      }
    });
    info.append(del);
  }
  let videoCounted = false;
  player.addEventListener('play', () => {
    if (videoCounted) return;
    videoCounted = true;
    api.videoView(item.id).then((r) => { if (r && r.views != null) item.views = r.views; }).catch(() => {});
  });
  card.append(buildPlayer(player), info);
  return card;
}
async function loadVideos() {
  if (!vid.grid) return;
  ensureYoutubeForm();
  try {
    const { items } = await api.videos();
    vid.grid.replaceChildren(...items.map(videoCard));
    if (vid.empty) vid.empty.hidden = items.length > 0;
  } catch (err) {
    toast(err.message);
  }
}
document.querySelectorAll('.wall-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.wall-tab').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
    document.getElementById('pane-fondos').hidden = name !== 'fondos';
    document.getElementById('pane-videos').hidden = name !== 'videos';
    if (name === 'videos') loadVideos();
  });
});
vid.upload?.addEventListener('click', async () => {
  const file = vid.file?.files?.[0];
  const code = wall.code?.value.trim();
  if (!file) return toast('Elige un video.');
  if (!code) return toast('Escribe el código de administrador.');
  if (file.size > 300 * 1024 * 1024) return toast('El video pasa de 300 MB.');
  vid.upload.disabled = true;
  try {
    // Se leen las dimensiones y la duración del propio archivo, sin recomprimirlo.
    // Si el navegador no puede leer las medidas, el video se publica igual (calidad original, sin cambios).
    const meta = await new Promise((resolve) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      const url = URL.createObjectURL(file);
      const done = (data) => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(data);
      };
      const timer = setTimeout(() => done({ width: 0, height: 0, duration: 0 }), 30000);
      probe.onloadedmetadata = () => done({ width: probe.videoWidth || 0, height: probe.videoHeight || 0, duration: Number.isFinite(probe.duration) ? probe.duration : 0 });
      probe.onerror = () => done({ width: 0, height: 0, duration: 0 });
      probe.src = url;
    });
    const title = vid.title.value.trim() || file.name.replace(/\.[^.]+$/, '');
    toast('Subiendo el video... no cierres la página.');
    await api.videoStream(file, { width: meta.width, height: meta.height, duration: meta.duration }, title, code);
    toast('Video publicado.');
    vid.file.value = '';
    vid.title.value = '';
    await loadVideos();
  } catch (err) {
    toast(err.message);
  } finally {
    vid.upload.disabled = false;
  }
});

/* ── Acceso del administrador: mantén pulsado el logo JORDVEX 2 segundos ── */
(() => {
  const brand = document.querySelector('.brand');
  if (!brand) return;
  let timer = null;
  const cancel = () => clearTimeout(timer);
  brand.addEventListener('pointerdown', () => {
    cancel();
    timer = setTimeout(async () => {
      const code = window.prompt('Código de administrador:');
      if (!code || !code.trim()) return;
      try {
        const res = await fetch('/api/admin/check', {
          headers: {
            'X-Admin-Code': code.trim(),
            'X-Client-Id': safeGet('sakuga.clientId') || '',
            'X-Access-Code': safeGet('sakuga.accessCode') || '',
          },
        });
        if (!res.ok) throw new Error('incorrecto');
        safeSet('sakuga.adminCode', code.trim());
        safeSet('sakuga.owner', '1');
        location.reload();
      } catch {
        toast('Código incorrecto.');
      }
    }, 2000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => brand.addEventListener(ev, cancel));
})();

/* ── Vista previa: cómo se verá el fondo en el teléfono o en la PC ── */
function openPreview(item) {
  api.viewWallpaper(item.id).catch(() => {});
  const dialog = document.getElementById('preview');
  const frame = document.getElementById('phone-frame');
  const screen = document.getElementById('phone-screen');
  if (!dialog || !frame || !screen) return;
  const vertical = item.kind !== 'pc';
  frame.className = vertical ? 'phone' : 'monitor';
  screen.style.backgroundImage = `url("${item.url}")`;
  const now = new Date();
  document.getElementById('phone-date').textContent = now.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  document.getElementById('phone-time').textContent = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  dialog.showModal();
}
document.querySelectorAll('[data-close-preview]').forEach((btn) => {
  btn.addEventListener('click', () => document.getElementById('preview')?.close());
});
document.getElementById('preview')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

/* ── Música de fondo: la publica el administrador; cada visitante la activa con el botón ── */
let bgTrack = null;
let bgWanted = safeGet('sakuga.music') === 'on';
const musicBtn = document.getElementById('music-toggle');
function paintMusic() {
  if (!musicBtn) return;
  const playing = Boolean(bgTrack && !bgTrack.paused);
  musicBtn.setAttribute('aria-pressed', String(playing));
  musicBtn.classList.toggle('is-on', playing);
}
function setMusicTrack(url) {
  if (bgTrack) bgTrack.pause();
  bgTrack = url ? new Audio(url) : null;
  if (bgTrack) {
    bgTrack.loop = true;
    bgTrack.volume = 0.35;
    bgTrack.preload = 'auto';
    bgTrack.addEventListener('play', paintMusic);
    bgTrack.addEventListener('pause', paintMusic);
  }
  if (musicBtn) musicBtn.hidden = !url;
  if (bgWanted && bgTrack) bgTrack.play().catch(() => {});
  paintMusic();
}
api.music().then((data) => setMusicTrack(data.url)).catch(() => {});
musicBtn?.addEventListener('click', () => {
  if (!bgTrack) return;
  if (bgTrack.paused) {
    bgWanted = true;
    bgTrack.play().catch(() => toast('Toca de nuevo para activar la música.'));
  } else {
    bgWanted = false;
    bgTrack.pause();
  }
  try { safeSet('sakuga.music', bgWanted ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
  paintMusic();
});
// Los navegadores bloquean el sonido hasta el primer toque: si la música estaba activa, arranca con ese toque.
document.addEventListener('pointerdown', () => {
  if (bgWanted && bgTrack && bgTrack.paused) bgTrack.play().catch(() => {});
}, { once: true, capture: true });

document.getElementById('music-upload')?.addEventListener('click', async () => {
  const file = document.getElementById('music-file')?.files?.[0];
  const code = document.getElementById('admin-code')?.value.trim();
  if (!file) return toast('Elige una canción.');
  if (!code) return toast('Escribe el código de administrador.');
  if (file.size > 30 * 1024 * 1024) return toast('La canción pasa de 30 MB.');
  try {
    await api.uploadMusic(file, code);
    const data = await api.music();
    setMusicTrack(data.url);
    document.getElementById('music-file').value = '';
    toast('Música de fondo publicada.');
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById('stats-download')?.addEventListener('click', async () => {
  const code = document.getElementById('admin-code')?.value.trim();
  if (!code) return toast('Escribe el código de administrador.');
  try {
    const blob = await api.statsCsv(code);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'jordvex-estadisticas.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    toast(err.message);
  }
});


/* ── Lupa y # como iconos dentro de la barra inferior ── */
(() => {
  const topSearch = document.getElementById('wall-search');
  const nav = document.querySelector('.nav');
  if (!topSearch || !nav) return;

  const bar = document.createElement('div');
  bar.className = 'nav-search';
  const row = document.createElement('div');
  row.className = 'nav-search__row';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Buscar: NTE, Zenless Zone Zero…';
  input.setAttribute('aria-label', 'Buscar fondos');
  input.autocomplete = 'off';
  input.enterKeyHint = 'search';
  row.append(input);
  const panel = document.createElement('div');
  panel.className = 'nav-suggest';
  bar.append(panel, row);
  document.body.append(bar);

  const setSearch = (text) => {
    input.value = text;
    topSearch.value = text;
    renderWallpapers();
  };
  const filterClick = (kind) => document.querySelector(`.wall-filters [data-kind="${kind}"]`)?.click();
  const atajos = [
    ['NTE', () => setSearch('NTE')],
    ['Zenless Zone Zero', () => setSearch('Zenless Zone Zero')],
    ['Móvil', () => filterClick('movil')],
    ['PC', () => filterClick('pc')],
    ['Todos', () => { setSearch(''); filterClick('todos'); }],
  ];
  atajos.forEach(([label, action]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      action();
      bar.classList.remove('is-open');
      hashBtn.setAttribute('aria-pressed', 'false');
    });
    panel.append(b);
  });

  const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const ICON_HASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 3 7 21M17 3l-2 18M4 9h17M3 15h17"/></svg>';
  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'nav-tool';
  searchBtn.setAttribute('aria-label', 'Buscar fondos');
  searchBtn.setAttribute('aria-pressed', 'false');
  searchBtn.innerHTML = ICON_SEARCH + '<span>Buscar</span>';
  const hashBtn = document.createElement('button');
  hashBtn.type = 'button';
  hashBtn.className = 'nav-tool';
  hashBtn.setAttribute('aria-label', 'Atajos de búsqueda');
  hashBtn.setAttribute('aria-pressed', 'false');
  hashBtn.innerHTML = ICON_HASH + '<span>Atajos</span>';
  nav.append(searchBtn, hashBtn);

  searchBtn.addEventListener('click', () => {
    const on = !bar.classList.contains('is-search');
    bar.classList.toggle('is-search', on);
    bar.classList.remove('is-open');
    searchBtn.setAttribute('aria-pressed', String(on));
    hashBtn.setAttribute('aria-pressed', 'false');
  });
  hashBtn.addEventListener('click', () => {
    const on = !bar.classList.contains('is-open');
    bar.classList.toggle('is-open', on);
    bar.classList.remove('is-search');
    hashBtn.setAttribute('aria-pressed', String(on));
    searchBtn.setAttribute('aria-pressed', 'false');
  });

  // Al tocar fuera de la barra, se cierran el campo y los atajos
  document.addEventListener('pointerdown', (event) => {
    if (bar.contains(event.target) || event.target === searchBtn || event.target === hashBtn) return;
    if (!bar.classList.contains('is-search') && !bar.classList.contains('is-open')) return;
    bar.classList.remove('is-search', 'is-open');
    searchBtn.setAttribute('aria-pressed', 'false');
    hashBtn.setAttribute('aria-pressed', 'false');
    input.blur();
  });
  input.addEventListener('input', () => setSearch(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  topSearch.addEventListener('input', () => {
    if (input.value !== topSearch.value) input.value = topSearch.value;
  });
})();

/* ── Cápsula que se desliza hasta la opción activa de la barra inferior ── */
(() => {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const ind = document.createElement('span');
  ind.className = 'nav-indicator';
  nav.prepend(ind);
  const visibleButtons = () => [...nav.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
  const place = () => {
    const btns = visibleButtons();
    const active = btns.find((b) => b.getAttribute('aria-pressed') === 'true')
      || btns.find((b) => b.getAttribute('aria-current') === 'page');
    if (!active) {
      ind.style.opacity = '0';
      return;
    }
    ind.style.opacity = '1';
    ind.style.width = `${active.offsetWidth}px`;
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
  };
  new MutationObserver(place).observe(nav, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-current', 'aria-pressed', 'class'],
  });
  window.addEventListener('resize', place);
  requestAnimationFrame(place);
})();

/* ── Monitor pequeño arriba de Fondos: muestra tu último video subido (sin molestar) ── */
(() => {
  const pane = document.getElementById('pane-fondos');
  if (!pane || safeGet('jordvex.showcase') === 'off') return;
  const build = async () => {
    try {
      const { items } = await api.videos();
      const item = items.find((v) => v.url && !v.youtubeId && !v.streamableId);
      if (!item || document.querySelector('.showcase')) return;
      const box = document.createElement('div');
      box.className = 'showcase';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'showcase__close';
      close.setAttribute('aria-label', 'Ocultar');
      close.textContent = '×';
      close.addEventListener('click', () => {
        safeSet('jordvex.showcase', 'off');
        box.remove();
      });
      const monitor = document.createElement('div');
      monitor.className = 'showcase__monitor';
      const video = document.createElement('video');
      video.src = item.url;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'metadata';
      monitor.append(video);
      const cap = document.createElement('p');
      cap.className = 'showcase__cap';
      cap.textContent = item.title;
      box.append(close, monitor, cap);
      pane.prepend(box);
      video.play().catch(() => {});
    } catch {
      /* sin video que mostrar: no pasa nada */
    }
  };
  build();
})();

/* ═══ Descargador de Instagram (Solo añade el botón y la ventana) ═══ */
(() => {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  const igBtn = document.createElement('button');
  igBtn.type = 'button';
  igBtn.className = 'nav-ig-center';
  igBtn.setAttribute('aria-label', 'Descargar de Instagram');
  // Logo de Instagram y posición exacta entre Buscar y Atajos.
  igBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';

  const shortcutsBtn = nav.querySelector('.nav-tool[aria-label="Atajos de búsqueda"]');
  if (shortcutsBtn) nav.insertBefore(igBtn, shortcutsBtn);
  else nav.append(igBtn);

  const dialog = document.createElement('dialog');
  dialog.className = 'ig-dialog';
  dialog.innerHTML = `
    <div class="ig-dialog__head">
      <h3>Descargar de Instagram</h3>
      <button type="button" class="btn btn--text" id="ig-close">✕</button>
    </div>
    <p class="muted" style="margin-bottom: 12px;">Pega el enlace de un Reel o video público de Instagram.</p>
    <div class="ig-dialog__input-row">
      <input type="url" id="ig-url" placeholder="https://instagram.com..." autocomplete="off">
      <button type="button" class="btn btn--sm" id="ig-paste">Pegar</button>
    </div>
    <button type="button" class="btn btn--primary" id="ig-fetch">Buscar video</button>
    <div class="ig-dialog__result" id="ig-result" hidden></div>
  `;
  document.body.append(dialog);

  const urlInput = dialog.querySelector('#ig-url');
  const resultBox = dialog.querySelector('#ig-result');
  const fetchBtn = dialog.querySelector('#ig-fetch');

  igBtn.addEventListener('click', () => {
    resultBox.hidden = true;
    resultBox.innerHTML = '';
    dialog.showModal();
    urlInput.focus();
  });

  dialog.querySelector('#ig-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  dialog.querySelector('#ig-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) urlInput.value = text.trim();
    } catch { toast('Pega el enlace manualmente.'); }
  });

  fetchBtn.addEventListener('click', async () => {
    const link = urlInput.value.trim();
    if (!link.includes('instagram.com')) return toast('Pega un enlace válido de Instagram.');
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Buscando video...';
    resultBox.hidden = true;

    try {
      const res = await fetch('/api/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link })
      });
      const data = await res.json();
      if (!res.ok || !data.videoUrl) throw new Error(data.error || 'No se pudo obtener el video.');

      resultBox.innerHTML = `
        <video src="${data.videoUrl}" controls playsinline></video>
        <a href="${data.videoUrl}" download="jordvex-instagram.mp4" target="_blank" rel="noopener" class="btn btn--primary-soft" style="width:100%;">Descargar MP4</a>
      `;
      resultBox.hidden = false;
    } catch (err) {
      toast(err.message);
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Buscar video';
    }
  });
})();
