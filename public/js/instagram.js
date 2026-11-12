import { api } from './api.js';

if (!document.querySelector('.nav-ig-center')) {
  function showMsg(message) {
    const el = document.getElementById('toast');
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3200);
  }

  
  const premiumStyle = document.createElement("style");
  premiumStyle.textContent = `
    .nav { overflow: visible !important; }
    .nav-ig-center {
      position: relative !important;
      top: -16px !important;
      width: 56px !important;
      height: 56px !important;
      min-height: 56px !important;
      margin: 0 auto !important;
      border-radius: 19px !important;
      border: 1px solid rgba(255, 255, 255, 0.3) !important;
      background: linear-gradient(145deg, var(--accent, #7aa8ff), color-mix(in srgb, var(--accent, #3b82f6) 60%, #090d1a)) !important;
      color: var(--accent-ink, #07101f) !important;
      display: grid !important;
      place-items: center !important;
      cursor: pointer !important;
      box-shadow: 0 12px 28px -6px color-mix(in srgb, var(--accent, #3b82f6) 70%, transparent), 0 0 0 4px var(--bg, #0d0c15), inset 0 1px 1px rgba(255, 255, 255, 0.5) !important;
      z-index: 10 !important;
      overflow: hidden !important;
    }
    .nav-ig-center svg { width: 25px !important; height: 25px !important; }
    .ig-dialog { border-color: color-mix(in srgb, var(--accent, #7aa8ff) 45%, transparent) !important; }
  `;
  document.head.append(premiumStyle);

  const nav = document.querySelector('.nav');
  if (nav) {
    const igBtn = document.createElement('button');
    igBtn.type = 'button';
    igBtn.className = 'nav-ig-center';
    igBtn.setAttribute('aria-label', 'Descargar de Instagram');
    igBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v7"/><path d="m8.5 12.5 3.5 3.5 3.5-3.5"/></svg>`;

    const placeCenter = () => {
      const target = nav.querySelector('.nav-tool');
      if (target) nav.insertBefore(igBtn, target);
      else nav.append(igBtn);
    };
    placeCenter();
    setTimeout(placeCenter, 250);

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
      } catch {
        showMsg('Pega el enlace manualmente.');
      }
    });

    fetchBtn.addEventListener('click', async () => {
      const link = urlInput.value.trim();
      if (!link.includes('instagram.com')) return showMsg('Pega un enlace válido de Instagram.');
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Buscando video...';
      resultBox.hidden = true;

      try {
        const data = await api.instagram(link);
        if (!data.videoUrl) throw new Error('No se pudo obtener el video.');

        const downloadHref = '/api/instagram/download?url=' + encodeURIComponent(data.videoUrl);
        resultBox.innerHTML = `
          <div class="ig-orientation-badge" id="ig-badge" style="font-size:12px; color:var(--muted); margin-bottom:8px;">Detectando formato...</div>
          <video id="ig-preview-video" src="${data.videoUrl}" controls playsinline></video>
          <a href="${downloadHref}" download="jordvex-instagram.mp4" class="btn btn--primary-soft" style="width:100%;">Descargar MP4</a>
        `;

        const vid = resultBox.querySelector('#ig-preview-video');
        const badge = resultBox.querySelector('#ig-badge');

        vid.addEventListener('loadedmetadata', () => {
          const w = vid.videoWidth;
          const h = vid.videoHeight;
          if (!w || !h) return;

          vid.style.aspectRatio = `${w} / ${h}`;
          if (h > w) {
            // Video vertical (Reel / Story)
            vid.style.width = 'auto';
            vid.style.maxWidth = '100%';
            vid.style.maxHeight = '400px';
            badge.textContent = `Vertical (${w}×${h})`;
          } else {
            // Video horizontal o cuadrado
            vid.style.width = '100%';
            vid.style.maxHeight = '260px';
            badge.textContent = w === h ? `Cuadrado (${w}×${h})` : `Horizontal (${w}×${h})`;
          }
        });

        resultBox.hidden = false;
      } catch (err) {
        showMsg(err.message);
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Buscar video';
      }
    });
  }
}
