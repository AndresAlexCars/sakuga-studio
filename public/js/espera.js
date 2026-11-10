(function () {
  var ahora = new Date();
  var objetivo = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate(),
    12, 49, 0
  );

  var elTiempo = document.getElementById("tiempo");
  var elMensaje = document.getElementById("mensaje");
  var elEtiqueta = document.getElementById("etiqueta");

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function tick() {
    var restante = objetivo.getTime() - Date.now();

    if (restante <= 0) {
      elTiempo.textContent = "¡YA ESTAMOS AQUÍ!";
      elTiempo.className = "listo";
      elMensaje.innerHTML = "El sitio ya está disponible.";
      elEtiqueta.textContent = "Puedes entrar";
      return;
    }

    var total = Math.floor(restante / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    elTiempo.textContent = pad(h) + ":" + pad(m) + ":" + pad(s);
  }

  tick();
  setInterval(tick, 1000);
})();
