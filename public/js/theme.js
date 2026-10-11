// Se ejecuta antes de pintar la página para evitar un destello del tema por defecto.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('sakuga.settings.v1') || 'null') || {};
    var root = document.documentElement;
    var mode = s.mode === 'light' || s.mode === 'auto' ? s.mode : 'dark';
    if (mode === 'auto') mode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    root.setAttribute('data-theme', s.palette || localStorage.getItem('sakuga.theme') || 'sakura');
    root.setAttribute('data-mode', mode);
    if (s.oled === true && mode === 'dark') root.setAttribute('data-oled', 'true');
    if (s.reduceMotion === true) root.setAttribute('data-motion', 'reduced');
    if (s.lang === 'en') root.setAttribute('lang', 'en');
    if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) {
      var n = parseInt(s.accent.slice(1), 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      root.style.setProperty('--accent', s.accent);
      root.style.setProperty('--accent-rgb', r + ', ' + g + ', ' + b);
      root.style.setProperty('--accent-ink', (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#14110a' : '#ffffff');
    }
  } catch (e) { /* sin almacenamiento */ }
})();
