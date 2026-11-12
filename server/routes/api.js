import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { QUALITIES, RATIOS, RESOLUTIONS, STYLES, publicCatalog } from '../catalog.js';
import { requireAccess, requireClient } from '../middleware/auth.js';
import { UpstreamError } from '../services/fal.js';
import { chat, takeChatSlot } from '../services/chat.js';
import { generate } from '../services/generator.js';
import { checkPrompt } from '../services/moderation.js';
import { clearItems, deleteItem, listItems } from '../services/store.js';
import { presignUrl, putStream, r2Enabled } from '../services/r2.js';
import { addWallpaper, detectImage, listWallpapers, reactWallpaper, recordView, removeWallpaper, statsCsv } from '../services/wallpapers.js';
import { addVideo, addYoutube, detectVideo, extractYoutubeId, listVideos, registerVideo, removeVideo, setVideoMetaIfMissing, addVideoView, extractStreamableId } from '../services/videos.js';

export const apiRouter = Router();

// Solo el administrador (código ADMIN_CODE, comparado de forma segura) puede subir o borrar fondos.
function checkAdmin(req) {
  if (!config.adminCode) return 'off';
  const given = crypto.createHash('sha256').update(req.get('x-admin-code') || '').digest();
  const real = crypto.createHash('sha256').update(config.adminCode).digest();
  return crypto.timingSafeEqual(given, real);
}


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

apiRouter.get('/instagram/download', async (req, res) => {
  try {
    const fileUrl = String(req.query.url || '');
    if (!fileUrl.startsWith('https://')) {
      return res.status(400).send('Enlace no válido.');
    }
    const upstream = await fetch(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!upstream.ok) return res.status(502).send('No se pudo descargar el video.');

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="jordvex-instagram.mp4"');
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (err) {
    console.error('[instagram-dl]', err);
    return res.status(500).send('Error al descargar el archivo.');
  }
});

apiRouter.post('/instagram', async (req, res) => {
  try {
    const { url: igUrl } = req.body || {};
    const cleanUrl = String(igUrl || '').trim().split('?').at(0);
    if (!cleanUrl.includes('instagram.com')) {
      return res.status(400).json({ error: 'Enlace de Instagram no válido.' });
    }

    const rapidKey = (process.env.RAPIDAPI_KEY || config.rapidApiKey || '').trim();
    const apiHost = 'instagram-reels-downloader-api.p.rapidapi.com';

    // Probar /downloadReel primero y /download como respaldo
    const endpoints = ['/downloadReel', '/download'];
    let videoUrl = null;
    let lastError = 'No se pudo extraer el video.';

    for (const path of endpoints) {
      const apiRes = await fetch(`https://${apiHost}${path}?url=${encodeURIComponent(cleanUrl)}`, {
        method: 'GET',
        headers: {
          'x-rapidapi-key': rapidKey,
          'x-rapidapi-host': apiHost
        }
      });

      const data = await apiRes.json().catch(() => ({}));
      videoUrl =
        data?.data?.medias?.at(0)?.url ||
        data?.medias?.at(0)?.url ||
        data?.video_url ||
        data?.url ||
        data?.media ||
        data?.result?.at(0)?.url;

      if (apiRes.ok && videoUrl) break;
      if (data?.message) lastError = data.message;
    }

    if (!videoUrl) {
      return res.status(404).json({ error: lastError });
    }

    return res.json({ videoUrl });
  } catch (err) {
    console.error('[instagram]', err);
    return res.status(500).json({ error: 'Error al conectar con RapidAPI.' });
  }
});

apiRouter.use(requireClient, requireAccess);

apiRouter.post('/generate', generateLimiter, async (req, res) => {
  const owner = checkAdmin(req);
  if (owner === 'off') return res.status(503).json({ error: 'Configura ADMIN_CODE en el servidor para habilitar la generación.' });
  if (!owner) return res.status(403).json({ error: 'La generación de imágenes está disponible solo para el administrador.' });
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

  if (body.imageProvider !== 'pollinations' && !config.providerReady) {
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
      imageProvider: body.imageProvider === 'pollinations' ? 'pollinations' : 'default',
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

const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados mensajes seguidos. Espera unos minutos.' },
});

apiRouter.post('/chat', chatLimiter, async (req, res) => {
  const list = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  const messages = list
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Escribe un mensaje.' });
  }
  if (!takeChatSlot()) return res.status(429).json({ error: 'Se alcanzó el límite diario del asistente. Vuelve mañana.' });
  const provider = req.body?.provider === 'groq' ? 'groq' : 'cloudflare';
  try {
    res.json({ reply: await chat(messages, provider) });
  } catch (err) {
    if (err instanceof UpstreamError) return res.status(err.status).json({ error: err.message });
    console.error('[chat]', err);
    res.status(500).json({ error: 'Error interno del asistente.' });
  }
});

apiRouter.get('/wallpapers', async (req, res) => {
  res.json({ items: await listWallpapers(req.clientId) });
});

apiRouter.post('/wallpapers/:id/react', async (req, res) => {
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji : '';
  try {
    const item = await reactWallpaper(req.params.id, req.clientId, emoji);
    if (!item) return res.status(404).json({ error: 'No se encontró ese fondo.' });
    res.json(item);
  } catch {
    res.status(400).json({ error: 'Esa reacción no está disponible.' });
  }
});

apiRouter.post('/wallpapers', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '25mb' }), async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'El panel de fondos no está configurado (falta ADMIN_CODE).' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No llegó ninguna imagen.' });
  if (!detectImage(req.body)) return res.status(400).json({ error: 'Solo se permiten imágenes PNG, JPG o WEBP.' });
  const kind = req.get('x-kind') === 'pc' ? 'pc' : 'movil';
  let title = '';
  try { title = decodeURIComponent(req.get('x-title') || '').trim(); } catch { title = ''; }
  if (!title) title = kind === 'pc' ? 'Fondo para PC' : 'Fondo para móvil';
  try {
    const item = await addWallpaper({ buffer: req.body, title, kind });
    res.status(201).json({ ok: true, id: item.id });
  } catch (err) {
    console.error('[wallpapers]', err);
    res.status(500).json({ error: 'No se pudo guardar el fondo.' });
  }
});

apiRouter.delete('/wallpapers/:id', async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'El panel de fondos no está configurado (falta ADMIN_CODE).' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  const removed = await removeWallpaper(req.params.id);
  if (!removed) return res.status(404).json({ error: 'No se encontró ese fondo.' });
  res.json({ ok: true });
});

apiRouter.get('/videos', async (_req, res) => {
  res.json({ items: await listVideos() });
});

apiRouter.post('/videos', express.raw({ type: ['video/mp4', 'video/webm', 'video/quicktime'], limit: '300mb' }), async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'El panel no está configurado (falta ADMIN_CODE).' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No llegó ningún video.' });
  if (!detectVideo(req.body)) return res.status(400).json({ error: 'Formato no válido. Usa MP4, WEBM o MOV.' });
  let title = '';
  try { title = decodeURIComponent(req.get('x-title') || '').trim(); } catch { title = ''; }
  if (!title) title = 'Video';
  const width = Math.max(0, Math.round(Number(req.get('x-width')) || 0));
  const height = Math.max(0, Math.round(Number(req.get('x-height')) || 0));
  const duration = Math.max(0, Math.round((Number(req.get('x-duration')) || 0) * 10) / 10);
  try {
    const item = await addVideo({ buffer: req.body, title, width, height, duration });
    res.status(201).json({ ok: true, id: item.id });
  } catch (err) {
    console.error('[videos]', err);
    res.status(500).json({ error: 'No se pudo guardar el video.' });
  }
});

apiRouter.delete('/videos/:id', async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'El panel no está configurado (falta ADMIN_CODE).' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  const removed = await removeVideo(req.params.id);
  if (!removed) return res.status(404).json({ error: 'No se encontró ese video.' });
  res.json({ ok: true });
});

// Comprueba el código de administrador sin revelar nada más. Limitado para evitar intentos masivos.
const adminCheckLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' },
});
apiRouter.get('/admin/check', adminCheckLimiter, (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'Falta ADMIN_CODE en el servidor.' });
  res.status(ok ? 200 : 401).json({ ok: ok === true });
});

// Sonido de clic: lo sube el administrador y lo escuchan todos los visitantes.
const SOUND_TYPES = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'm4a' };
const soundDir = path.join(config.dataDir, 'sound');
async function findClickSound() {
  try {
    const files = await fs.readdir(soundDir);
    return files.find((f) => /^click\.(mp3|wav|ogg|m4a)$/.test(f)) || null;
  } catch {
    return null;
  }
}
apiRouter.get('/sound', async (_req, res) => {
  const file = await findClickSound();
  res.json({ url: file ? `/sound/${file}` : null });
});
apiRouter.post('/sound', express.raw({ type: Object.keys(SOUND_TYPES), limit: '5mb' }), async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'Falta ADMIN_CODE en el servidor.' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No llegó ningún sonido.' });
  const ext = SOUND_TYPES[(req.get('content-type') || '').split(';')[0]];
  if (!ext) return res.status(400).json({ error: 'Usa MP3, WAV, OGG o M4A.' });
  await fs.mkdir(soundDir, { recursive: true });
  const old = await findClickSound();
  if (old) await fs.unlink(path.join(soundDir, old)).catch(() => {});
  await fs.writeFile(path.join(soundDir, `click.${ext}`), req.body);
  res.status(201).json({ ok: true });
});

// Música de fondo: la sube el administrador y la escuchan todos los visitantes que la activen.
const MUSIC_TYPES = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'm4a' };
const musicDir = path.join(config.dataDir, 'music');
async function findMusic() {
  try {
    const files = await fs.readdir(musicDir);
    return files.find((f) => /^music\.(mp3|wav|ogg|m4a)$/.test(f)) || null;
  } catch {
    return null;
  }
}
apiRouter.get('/music', async (_req, res) => {
  const file = await findMusic();
  res.json({ url: file ? `/music/${file}` : null });
});
apiRouter.post('/music', express.raw({ type: Object.keys(MUSIC_TYPES), limit: '30mb' }), async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'Falta ADMIN_CODE en el servidor.' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No llegó ninguna canción.' });
  const ext = MUSIC_TYPES[(req.get('content-type') || '').split(';')[0]];
  if (!ext) return res.status(400).json({ error: 'Usa MP3, WAV, OGG o M4A.' });
  await fs.mkdir(musicDir, { recursive: true });
  const old = await findMusic();
  if (old) await fs.unlink(path.join(musicDir, old)).catch(() => {});
  await fs.writeFile(path.join(musicDir, `music.${ext}`), req.body);
  res.status(201).json({ ok: true });
});

apiRouter.post('/wallpapers/:id/view', async (req, res) => {
  const views = await recordView(req.params.id);
  if (views === null) return res.status(404).json({ error: 'No se encontró ese fondo.' });
  res.json({ views });
});

apiRouter.get('/admin/stats.csv', async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'Falta ADMIN_CODE en el servidor.' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  res.type('text/csv');
  res.set('Content-Disposition', 'attachment; filename="jordvex-estadisticas.csv"');
  res.send('\uFEFF' + (await statsCsv()));
});

// Subida directa a R2: el servidor solo da permiso y registra el video; los bytes van directo a R2.
const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const VIDEO_MAX = 300 * 1024 * 1024;
apiRouter.post('/videos/presign', async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'Falta ADMIN_CODE en el servidor.' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  if (!r2Enabled()) return res.status(503).json({ error: 'R2 no está configurado en el servidor.' });
  const ext = VIDEO_EXT[req.body?.contentType];
  const size = Number(req.body?.size);
  if (!ext) return res.status(400).json({ error: 'Formato no válido. Usa MP4, WEBM o MOV.' });
  if (!(size > 0 && size <= VIDEO_MAX)) return res.status(400).json({ error: 'El video pasa de 300 MB.' });
  const id = crypto.randomUUID();
  res.json({ id, ext, uploadUrl: presignUrl('PUT', `videos/${id}.${ext}`, 1800) });
});

apiRouter.post('/videos/complete', async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'Falta ADMIN_CODE en el servidor.' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  try {
    const item = await registerVideo(req.body || {});
    res.status(201).json({ ok: true, id: item.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Subida en streaming: el video pasa por el servidor hacia R2 sin guardarse en memoria.
apiRouter.post('/videos/stream', async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'Falta ADMIN_CODE en el servidor.' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  if (!r2Enabled()) return res.status(503).json({ error: 'R2 no está configurado en el servidor.' });
  const mime = (req.get('content-type') || '').split(';')[0];
  const ext = VIDEO_EXT[mime];
  const size = Number(req.get('x-size'));
  if (!ext) return res.status(400).json({ error: 'Formato no válido. Usa MP4, WEBM o MOV.' });
  if (!(size > 0 && size <= VIDEO_MAX)) return res.status(400).json({ error: 'El video pasa de 300 MB.' });
  const id = crypto.randomUUID();
  try {
    await putStream(`videos/${id}.${ext}`, req, size, mime);
    let title = '';
    try { title = decodeURIComponent(req.get('x-title') || '').trim(); } catch { title = ''; }
    let meta = {};
    try { meta = JSON.parse(decodeURIComponent(req.get('x-meta') || '{}')); } catch { meta = {}; }
    const item = await registerVideo({ id, ext, title, ...meta, size, mime });
    res.status(201).json({ ok: true, id: item.id });
  } catch (err) {
    console.error('[video-stream]', err.message);
    res.status(502).json({ error: `No se pudo guardar el video: ${err.message}` });
  }
});

// Guarda las medidas reales de un video que llegó sin ellas (solo si aún no las tiene).
apiRouter.post('/videos/:id/meta', async (req, res) => {
  const saved = await setVideoMetaIfMissing(req.params.id, req.body ?? {});
  if (!saved) return res.status(404).json({ error: 'No se encontró ese video o ya tiene medidas.' });
  res.json({ ok: true });
});

// Añade un video de YouTube no listado (solo administrador).
apiRouter.post('/videos/youtube', async (req, res) => {
  const ok = checkAdmin(req);
  if (ok === 'off') return res.status(503).json({ error: 'Falta ADMIN_CODE en el servidor.' });
  if (!ok) return res.status(401).json({ error: 'Código de administrador incorrecto.' });
  const streamableId = extractStreamableId(req.body?.url);
  const youtubeId = streamableId ? '' : extractYoutubeId(req.body?.url);
  if (!youtubeId && !streamableId) return res.status(400).json({ error: 'Ese enlace no parece de YouTube ni de Streamable.' });
  const title = String(req.body?.title || '').trim().slice(0, 60) || 'Video de YouTube';
  const orientation = req.body?.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const item = await addYoutube({ title, youtubeId, streamableId, orientation });
  res.status(201).json({ ok: true, id: item.id });
});

// Suma una reproducción al video (público: solo cuenta).
apiRouter.post('/videos/:id/view', async (req, res) => {
  const views = await addVideoView(req.params.id);
  if (views == null) return res.status(404).json({ error: 'No se encontró ese video.' });
  res.json({ ok: true, views });
});

apiRouter.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

import axios from 'axios';

// Endpoint proxy para hacer streaming del video de Instagram con soporte de Rango
apiRouter.get('/instagram/download-proxy', async (req, res) => {
    try {
        const videoUrl = req.query.url;
        if (!videoUrl) return res.status(400).json({ error: 'URL requerida' });

        const response = await axios({
            method: 'get',
            url: videoUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Range': req.headers.range || 'bytes=0-'
            }
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        if (response.headers['accept-ranges']) res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
        
        res.status(response.status);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).json({ error: 'Error al transmitir el video' });
    }
});
