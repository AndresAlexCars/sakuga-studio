import express from 'express';
import axios from 'axios';

const router = express.Router();

router.post('/download', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || !url.includes('instagram.com')) {
            return res.status(400).json({ error: 'Por favor ingresa un enlace de Instagram válido' });
        }

        // Petición limpia para extraer el video directamente de la página pública
        const cleanUrl = url.split('?')[0];
        const response = await axios.get(cleanUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        const match = response.data.match(/<meta property="og:video" content="([^"]+)"/);
        if (match && match[1]) {
            const videoUrl = match[1].replace(/&amp;/g, '&');
            return res.json({ videoUrl });
        } else {
            return res.status(404).json({ error: 'No se pudo extraer el video. Asegúrate de que sea público.' });
        }
    } catch (err) {
        console.error('Error al extraer video:', err.message);
        return res.status(500).json({ error: 'Error al procesar la solicitud del video.' });
    }
});

export default router;
