import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { QUALITIES, RATIOS, RESOLUTIONS, STYLES, publicCatalog } from '../catalog.js';
import { requireAccess, requireClient } from '../middleware/auth.js';
import { UpstreamError } from '../services/fal.js';
import { generate } from '../services/generator.js';
import { checkPrompt } from '../services/moderation.js';
import { clearItems, deleteItem, listItems } from '../services/store.js';

export const apiRouter = Router();

// Tope global diario: protege tu gasto aunque alguien consiga acceso.
let slotDay = '';
let slotCount = 0;
function takeSlot() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== slotDay) {
    slotDay = today;
    slotCount = 0;
  }
  if (slotCount >= config.dailyLimit) return false;
  slotCount += 1;
  return true;
}
const releaseSlot = () => {
  slotCount = Math.max(0, slotCount - 1);
};

const generateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.rateLimitPer10Min,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Has generado muchas imágenes seguidas. Espera unos minutos.' },
});

// Pública: solo describe opciones y si hace falta código. Nunca incluye secretos.
apiRouter.get('/config', (_req, res) => res.json(publicCatalog()));

apiRouter.use(requireClient, requireAccess);

apiRouter.post('/generate', generateLimiter, async (req, res) => {
  const body = req.body ?? {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.replace(/\s+/g, ' ').trim() : '';

  if (prompt.length < 3) return res.status(400).json({ error: 'Describe tu imagen con al menos 3 caracteres.' });
  if (prompt.length > config.maxPromptLength) {
    return res.status(400).json({ error: `El prompt admite hasta ${config.maxPromptLength} caracteres.` });
  }
  if (
    !Object.hasOwn(STYLES, body.style) ||
    !Object.hasOwn(RATIOS, body.ratio) ||
    !Object.hasOwn(RESOLUTIONS, body.resolution) ||
    !Object.hasOwn(QUALITIES, body.quality)
  ) {
    return res.status(400).json({ error: 'Alguna de las opciones elegidas no es válida.' });
  }

  const blocked = checkPrompt(prompt);
  if (blocked) return res.status(422).json({ error: blocked });

  if (!config.providerReady) {
    const missing =
      config.provider === 'cloudflare' ? 'CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN' : 'FAL_KEY';
    return res.status(503).json({ error: `El servidor aún no tiene configurado el proveedor (${missing}).` });
  }
  if (!takeSlot()) {
    return res.status(429).json({ error: 'Se alcanzó el límite diario de imágenes. Vuelve mañana.' });
  }

  try {
    const item = await generate({
      clientId: req.clientId,
      prompt,
      style: body.style,
      ratio: body.ratio,
      resolution: body.resolution,
      quality: body.quality,
    });
    res.status(201).json(item);
  } catch (err) {
    releaseSlot();
    if (err instanceof UpstreamError) return res.status(err.status).json({ error: err.message });
    console.error('[generate]', err);
    res.status(500).json({ error: 'Error interno al generar la imagen.' });
  }
});

apiRouter.get('/history', async (req, res) => {
  res.json({ items: await listItems(req.clientId) });
});

apiRouter.delete('/history/:id', async (req, res) => {
  const ok = await deleteItem(req.clientId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'No se encontró esa imagen.' });
  res.json({ ok: true });
});

apiRouter.delete('/history', async (req, res) => {
  res.json({ ok: true, removed: await clearItems(req.clientId) });
});

apiRouter.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
