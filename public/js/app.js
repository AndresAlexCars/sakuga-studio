import { api, ApiError, hasAccessCode, setAccessCode } from './api.js';
import { ideas, setLanguage, t, tl } from './i18n.js';
import { applyAppearance, loadDraft, loadSettings, normalize, resetSettings, saveDraft, saveSettings } from './settings.js';
import { initSettingsPanel } from './settingsPanel.js';
import { filterHistory, shortDate, loadFavIds, saveFavIds, onlyFavorites } from './history.js';
import { getLanguage } from './i18n.js';

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
  if (state.config.provider === 'cloudflare') return { width: 1024, height: 1024 };
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
    state.config = await api.config();
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
  await loadHistory();
}

init();
