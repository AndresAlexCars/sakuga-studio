// Panel de Ajustes (hoja modal). Se construye con DOM, sin innerHTML.
import { LANGUAGES, t } from './i18n.js';
import { PALETTES } from './settings.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export function initSettingsPanel({ dialog, getSettings, update, onReset, onExport, onClearHistory, provider, appName, count = () => 0 }) {
  const body = dialog.querySelector('#settings-body');
  let refs = [];
  let accentInput = null;

  function choice(item) {
    const fieldset = el('fieldset', { class: 'field' }, el('legend', { class: 'field__label', text: item.label }));
    const wrap = el('div', { class: `choices${item.seg ? ' choices--seg' : ''}` });
    for (const option of item.options) {
      const input = el('input', { type: 'radio', name: `set-${item.key}`, value: String(option.value) });
      input.addEventListener('change', () => update({ [item.key]: option.value }));
      refs.push({ key: item.key, input, kind: 'radio' });
      const face = el('span', { class: 'choice__face' });
      if (option.dot) {
        const dot = el('i', { class: 'dot', 'aria-hidden': 'true' });
        dot.style.setProperty('--sw', option.dot);
        face.append(dot);
      }
      face.append(el('span', { text: option.label }));
      wrap.append(el('label', { class: 'choice' }, input, face));
    }
    fieldset.append(wrap);
    return fieldset;
  }

  function toggle(key, label) {
    const input = el('input', { type: 'checkbox', role: 'switch' });
    input.addEventListener('change', () => update({ [key]: input.checked }));
    refs.push({ key, input, kind: 'check' });
    return el('label', { class: 'switch' }, el('span', { text: label }), input);
  }

  function accent() {
    accentInput = el('input', { type: 'color', 'aria-label': t('settings.accent') });
    accentInput.addEventListener('input', () => update({ accent: accentInput.value }));
    const reset = el('button', { type: 'button', class: 'btn btn--sm', text: t('settings.accent.reset') });
    reset.addEventListener('click', () => update({ accent: '' }));
    return el(
      'fieldset', { class: 'field' },
      el('legend', { class: 'field__label', text: t('settings.accent') }),
      el('div', { class: 'accent-row' }, accentInput, reset),
    );
  }

  function infoRow(label, value) {
    return el('div', { class: 'info-row' }, el('span', { class: 'info-row__label', text: label }), el('span', { class: 'info-row__value', text: value }));
  }

  function section(title, ...items) {
    return el('section', { class: 'sheet__section' }, el('h4', { text: title }), ...items);
  }

  function build() {
    refs = [];
    const actions = el('div', { class: 'sheet__actions' });
    const copy = el('button', { type: 'button', class: 'btn btn--sm', text: t('settings.copy') });
    const reset = el('button', { type: 'button', class: 'btn btn--sm', text: t('settings.reset') });
    const clear = el('button', { type: 'button', class: 'btn btn--sm btn--danger', text: t('history.clear') });
    copy.addEventListener('click', onExport);
    reset.addEventListener('click', onReset);
    clear.addEventListener('click', () => {
      dialog.close();
      onClearHistory();
    });
    actions.append(copy, reset, clear);

    body.replaceChildren(
      section(
        t('settings.appearance'),
        choice({
          key: 'mode', label: t('settings.mode'), seg: true,
          options: [
            { value: 'auto', label: t('settings.mode.auto') },
            { value: 'light', label: t('settings.mode.light') },
            { value: 'dark', label: t('settings.mode.dark') },
          ],
        }),
        choice({
          key: 'palette', label: t('settings.palette'),
          options: Object.entries(PALETTES).map(([value, p]) => ({
            value, dot: p.dot, label: value.charAt(0).toUpperCase() + value.slice(1),
          })),
        }),
        accent(),
        toggle('oled', t('settings.oled')),
        toggle('reduceMotion', t('settings.motion')),
      ),
      section(
        t('settings.language'),
        choice({ key: 'lang', label: t('settings.language'), seg: true, options: LANGUAGES }),
      ),
      section(
        t('settings.behavior'),
        toggle('vibrate', t('settings.vibrate')),
        toggle('saveDraft', t('settings.draft')),
      ),
      section(t('settings.data'), actions),
      section(
      t('settings.info'),
      infoRow(t('settings.info.provider'), provider === 'cloudflare' ? 'Cloudflare Workers AI' : 'fal.ai'),
      infoRow(t('settings.info.model'), provider === 'cloudflare' ? 'FLUX.1 schnell' : 'FLUX'),
      infoRow(t('settings.info.count'), String(count())),
      infoRow(t('settings.info.quota'), provider === 'cloudflare' ? t('settings.info.quotaValue') : '—'),
      el('p', { class: 'muted info-note', text: t('settings.info.privacy') }),
      el('p', { class: 'muted info-note', text: t('settings.info.tip') }),
    ),
    el('p', { class: 'muted about', text: t('settings.about', { app: appName, provider }) }),
    );

    // Textos fijos del marco del panel
    dialog.querySelector('.sheet__head h3').textContent = t('settings.title');
    dialog.querySelector('[data-close]').textContent = t('settings.close');
    sync();
  }

  function sync() {
    const s = getSettings();
    for (const ref of refs) {
      if (ref.kind === 'radio') ref.input.checked = String(s[ref.key]) === ref.input.value;
      else ref.input.checked = Boolean(s[ref.key]);
    }
    if (accentInput && document.activeElement !== accentInput) {
      const themeAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const value = s.accent || themeAccent;
      accentInput.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ff8fb8';
    }
  }

  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  build();
  return {
    sync,
    rebuild: build,
    open() {
      build();
      dialog.showModal();
    },
  };
}
