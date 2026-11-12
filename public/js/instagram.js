import { api } from './api.js';

if (!document.querySelector('.nav-ig-center')) {
  function showMsg(message) {
    const el = document.getElementById('toast');
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3200);
  }

  const nav = document.querySelector('.nav');
  if (nav) {
    const igBtn = document.createElement('button');
    igBtn.type = 'button';
    igBtn.className = 'nav-ig-center';
    igBtn.setAttribute('aria-label', 'Descargar de Instagram');
    igBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

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
          <video src="${data.videoUrl}" controls playsinline></video>
          <a href="${downloadHref}" download="jordvex-instagram.mp4" class="btn btn--primary-soft" style="width:100%;">Descargar MP4</a>
        `;
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
