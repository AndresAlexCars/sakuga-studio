// Se ejecuta antes de pintar la página para evitar un destello del tema por defecto.
(function () {
  try {
    var t = localStorage.getItem('sakuga.theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* sin almacenamiento */ }
})();
