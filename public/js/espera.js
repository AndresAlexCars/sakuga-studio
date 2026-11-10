(function () {
  // Objetivo: HOY a las 00:00 de la noche siguiente (medianoche)
  var ahora = new Date();
  var objetivo = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate() + 1, // mañana a las 00:00 = medianoche de esta noche
    0, 0, 0
  );

  // Referencia para la barra: desde ahora hasta medianoche
  var inicioRef = ahora.getTime();
  var totalMs = objetivo.getTime() - inicioRef;

  var elTiempo = document.getElementById("tiempo");
  var elMensaje = document.getElementById("mensaje");
  var elEtiqueta = document.getElementById("etiqueta");
  var elBack = document.getElementById("back");
  var elBadge = document.getElementById("badge");
  var elTitulo = document.getElementById("titulo");
  var elExtra = document.getElementById("extra");
  var elBarra = document.getElementById("barra");
  var elLista = document.getElementById("lista");

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function tick() {
    var restante = objetivo.getTime() - Date.now();

    if (restante <= 0) {
      elTiempo.textContent = "¡YA ESTAMOS AQUÍ!";
      elTiempo.className = "listo-tiempo";
      elMensaje.innerHTML = "El error ya fue corregido.<br>El sitio está disponible de nuevo.";
      elEtiqueta.textContent = "Listo";
      elBadge.textContent = "Disponible";
      elBadge.className = "badge listo";
      elTitulo.textContent = "Todo en orden";
      elExtra.textContent = "Puedes entrar y seguir usando JORDVEX con normalidad.";
      elBarra.style.width = "100%";
      if (elLista) elLista.style.display = "none";
      elBack.hidden = false;
      return;
    }

    var total = Math.floor(restante / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    elTiempo.textContent = pad(h) + ":" + pad(m) + ":" + pad(s);

    var hecho = Date.now() - inicioRef;
    var pct = Math.max(0, Math.min(100, (hecho / totalMs) * 100));
    elBarra.style.width = pct.toFixed(1) + "%";

    elBack.hidden = true;
  }

  // Intentar reproducir el vídeo de fondo (algunos móviles lo bloquean sin gesto)
  var vid = document.getElementById("bg-video");
  if (vid) {
    vid.play().catch(function () {});
  }

  tick();
  setInterval(tick, 1000);
})();
