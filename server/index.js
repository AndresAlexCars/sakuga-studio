import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getObject, presignUrl, r2Enabled } from './services/r2.js';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';
import { readWallpaperFile } from './services/wallpapers.js';
import { readVideoFile } from './services/videos.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
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
  const buf = await readWallpaperFile(req.params.file);
  if (!buf) return res.status(404).end();
  const ext = req.params.file.split('.').pop();
  res.type(ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.send(buf);
});

// Videos publicados: se entregan tal cual se subieron.
app.get('/videos/:file', async (req, res) => {
  if (!/^[0-9a-f-]{36}\.(mp4|webm|mov)$/.test(req.params.file)) return res.status(404).end();
  if (r2Enabled()) {
    res.set('Cache-Control', 'private, max-age=600');
    return res.redirect(302, presignUrl('GET', `videos/${req.params.file}`, 3600));
  }
  const buf = await readVideoFile(req.params.file);
  if (!buf) return res.status(404).end();
  const ext = req.params.file.split('.').pop();
  res.type(ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.send(buf);
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

app.use('/api', apiRouter);
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
