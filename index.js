import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { api } from './api.js';

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

// Rutas de la API
app.get('/api/config', (req, res) => {
  res.json({
    hasAccessCode: !!req.app.locals.accessCode,
    clientId: true
  });
});

app.post('/api/generate', async (req, res) => {
  try {
    const apiModule = await import('./api.js');
const result = await apiModule.api.generate(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Algo salió mal' });
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
// Página principal
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: '.' });
});

app.listen(config.port, () => {
  console.log(`Sakuga Studio escuchando en http://localhost:${config.port}`);
  if (!config.falKey) console.warn('Aviso: falta FAL_KEY...');
  if (!config.accessCode) console.warn('Aviso: sin ACCESS_CODE...');
});
