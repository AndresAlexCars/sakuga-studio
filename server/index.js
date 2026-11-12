import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { getObject, getObjectStream, r2Enabled } from './services/r2.js';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';
import { readWallpaperFile } from './services/wallpapers.js';
import { readVideoFile, videoPath } from './services/videos.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

// URL pública del bucket R2.
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://streamable.com'],
        imgSrc: ["'self'", 'data:', 'https://i.ytimg.com', ...(process.env.R2_PUBLIC_URL ? [process.env.R2_PUBLIC_URL.replace(/\/$/, '')] : [])],
        mediaSrc: ["'self'", ...(process.env.R2_PUBLIC_URL ? [process.env.R2_PUBLIC_URL.replace(/\/$/, '')] : [])],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],

        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        // Permite probar desde el teléfono por http en tu red local.
        upgradeInsecureRequests: null,
      },
    },
  }),
);
app.use(compression());
app.use(express.json({ limit: '10kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Los nombres de archivo son UUID aleatorios (no adivinables).
// Si la imagen no está en disco (p. ej. tras reiniciar), se trae de R2 y se guarda como caché.
app.get('/media/:file', async (req, res, next) => {
  const name = req.params.file;
  if (!r2Enabled() || !/^[0-9a-f-]{36}\.(png|jpg)$/.test(name)) return next();
  const local = path.join(config.imagesDir, name);
  try {
    await fs.access(local);
    return next();
  } catch { /* no está en disco: se busca en R2 */ }
  try {
    const buf = await getObject(name);
    if (!buf) return res.status(404).end();
    await fs.mkdir(config.imagesDir, { recursive: true });
    await fs.writeFile(local, buf);
    res.type(name.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    return res.send(buf);
  } catch (err) {
    console.error('[media] R2:', err.message);
    return res.status(502).end();
  }
});

app.use(
  '/media',
  express.static(config.imagesDir, {
    index: false,
    dotfiles: 'deny',
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }),
);

// Fondos publicados: archivos con nombre UUID, descargables por cualquiera que tenga el enlace.
app.get('/wallpapers/:file', async (req, res) => {
  if (R2_PUBLIC && r2Enabled() && /^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(req.params.file)) {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.redirect(302, `${R2_PUBLIC}/wallpapers/${req.params.file}`);
  }
  const buf = await readWallpaperFile(req.params.file);
  if (!buf) return res.status(404).end();
  const ext = req.params.file.split('.').pop();
  res.type(ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.send(buf);
});

// Videos publicados: se entregan en streaming con soporte de rangos (el reproductor pide partes).
app.get('/videos/:file', async (req, res) => {
  const file = req.params.file;
  if (!/^[0-9a-f-]{36}\.(mp4|webm|mov)$/.test(file)) return res.status(404).end();
  // Con R2 público, el video sale directo de Cloudflare (no gasta el ancho de banda de Render).
  if (R2_PUBLIC && r2Enabled()) {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.redirect(302, `${R2_PUBLIC}/videos/${file}`);
  }
  const ext = file.split('.').pop();
  res.type(ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4');
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');

  const local = await videoPath(file);
  if (local) {
    const { size } = await fs.stat(local);
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    let start = 0;
    let end = size - 1;
    if (m) {
      if (m[1]) start = Number(m[1]);
      if (m[2]) end = Number(m[2]);
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length', String(end - start + 1));
    return createReadStream(local, { start, end }).pipe(res);
  }

  // Tras un reinicio el video está solo en R2: se reenvía en streaming, sin cargarlo en memoria.
  if (!r2Enabled()) return res.status(404).end();
  try {
    const up = await getObjectStream(`videos/${file}`, req.headers.range || '');
    if (up.status === 404) return res.status(404).end();
    if (!up.ok && up.status !== 206) return res.status(502).end();
    for (const h of ['content-length', 'content-range']) {
      const v = up.headers.get(h);
      if (v) res.set(h, v);
    }
    res.status(up.status);
    Readable.fromWeb(up.body).pipe(res);
  } catch (err) {
    console.error('[video-r2]', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

// Sonido de clic publicado por el administrador.
app.get('/sound/:file', async (req, res) => {
  if (!/^click\.(mp3|wav|ogg|m4a)$/.test(req.params.file)) return res.status(404).end();
  try {
    const buf = await fs.readFile(path.join(config.dataDir, 'sound', req.params.file));
    const ext = req.params.file.split('.').pop();
    res.type({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' }[ext]);
    res.set('Cache-Control', 'no-cache');
    res.send(buf);
  } catch {
    res.status(404).end();
  }
});

// Música de fondo publicada por el administrador.
app.get('/music/:file', async (req, res) => {
  if (!/^music\.(mp3|wav|ogg|m4a)$/.test(req.params.file)) return res.status(404).end();
  try {
    const buf = await fs.readFile(path.join(config.dataDir, 'music', req.params.file));
    const ext = req.params.file.split('.').pop();
    res.type({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' }[ext]);
    res.set('Cache-Control', 'no-cache');
    res.send(buf);
  } catch {
    res.status(404).end();
  }
});

app.use('/api', apiRouter); app.post('/api/instagram', async (req, res) => {
  try {
    const { url: igUrl } = req.body;
    const match = String(igUrl || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    
    if (!match) {
      return res.status(400).json({ error: 'Enlace de Instagram no válido.' });
    }
    
    const shortcode = match[1];
    const embedUrl = `https://instagram.com/${shortcode}/embed/captioned/`;
    
    const fetch = (await import('node-fetch')).default;
    const igRes = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });
    
    if (!igRes.ok) {
      return res.status(502).json({ error: 'No se pudo conectar con Instagram.' });
    }
    
    const html = await igRes.text();
    const videoMatch = html.match(/"video_url":"([^"]+)"/) || html.match(/src="(https:\/\/[^"]+\.mp4[^"]*)"/);
    
    if (!videoMatch) {
      return res.status(404).json({
        error: 'No se encontró video. El perfil debe ser público.'
      });
    }
    
    const videoUrl = videoMatch[1]
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/');
    
    return res.json({ videoUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error procesando el enlace de Instagram.' });
  }
});

app.use(express.static(config.publicDir, { extensions: ['html'] }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Solicitud no válida.' });
  }
  console.error('[server]', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(config.port, () => {
  console.log(`JORDVEX escuchando en http://localhost:${config.port}`);
  console.log(`Proveedor de imágenes: ${config.provider}`);
  if (!config.providerReady) console.warn('Aviso: faltan las claves del proveedor en .env. La app abrirá, pero no podrá generar imágenes.');
  if (!config.accessCode) console.warn('Aviso: sin ACCESS_CODE, cualquiera con tu URL podrá gastar tu saldo.');
});
