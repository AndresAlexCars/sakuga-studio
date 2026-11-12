document.addEventListener("DOMContentLoaded", () => {
    const searchBtn = document.querySelector("#search-video-btn") || document.querySelector("button");
    const urlInput = document.querySelector("input[type='text']");
    const videoPlayer = document.querySelector("video");

    if (searchBtn && urlInput) {
        searchBtn.addEventListener("click", async () => {
            const url = urlInput.value.trim();
            if (!url) {
                alert("Por favor ingresa un enlace de Instagram");
                return;
            }

            try {
                searchBtn.textContent = "Buscando...";
                const res = await fetch("/api/instagram/native-download?url=" + encodeURIComponent(url));
                const data = await res.json();

                if (data.videoUrl) {
                    if (videoPlayer) {
                        videoPlayer.src = "/api/instagram/download-proxy?url=" + encodeURIComponent(data.videoUrl);
                        videoPlayer.load();
                        videoPlayer.play().catch(e => console.log("Autoplay bloqueado:", e));
                    }
                    alert("¡Video encontrado con éxito!");
                } else {
                    alert(data.error || "No se pudo obtener el video.");
                }
            } catch (err) {
                console.error(err);
                alert("Error de conexión con el servidor.");
            } finally {
                searchBtn.textContent = "Buscar video";
            }
        });
    }
});