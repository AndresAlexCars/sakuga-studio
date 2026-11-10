(function () {
  // Objetivo: hoy a las 13:00 (1:00 de la tarde)
  var ahora = new Date();
  var objetivo = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate(),
    13, 0, 0
  );

  // Si ya pasó de las 13:00, el total de referencia es 1 hora (para la barra)
  var inicioRef = new Date(objetivo.getTime() - 60 * 60 * 1000);

  var elTiempo = document.getElementById("tiempo");
  var elMensaje = document.getElementById("mensaje");
  var elEtiqueta = document.getElementById("etiqueta");
  var elBack = document.getElementById("back");
  var elBadge = document.getElementById("badge");
  var elTitulo = document.getElementById("titulo");
  var elExtra = document.getElementById("extra");
  var elBarra = document.getElementById("barra");

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
      elBack.hidden = false;
      return;
    }

    var total = Math.floor(restante / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    elTiempo.textContent = pad(h) + ":" + pad(m) + ":" + pad(s);

    // Barra de progreso hacia las 13:00
    var totalMs = objetivo.getTime() - inicioRef.getTime();
    var hecho = Date.now() - inicioRef.getTime();
    var pct = Math.max(0, Math.min(100, (hecho / totalMs) * 100));
    elBarra.style.width = pct.toFixed(1) + "%";

    elBack.hidden = true;
  }

  tick();
  setInterval(tick, 1000);
})();
