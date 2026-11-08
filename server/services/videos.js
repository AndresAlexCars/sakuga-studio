// Videos publicados por el administrador. Se guardan tal cual (sin recomprimir) en disco y, si hay R2, también en R2.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { deleteObject, getObject, headObject, putObject, r2Enabled } from './r2.js';

const dir = path.join(config.dataDir, 'videos');
const indexFile = path.join(dir, 'index.json');
const FILE_RE = /^[0-9a-f-]{36}\.(mp4|webm|mov)$/;
let index = null;
let chain = Promise.resolve();

export function detectVideo(buf) {
  if (buf.length > 12 && buf.readUInt32BE(0) === 0x1a45dfa3) return { ext: 'webm', type: 'video/webm' };
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    return buf.toString('ascii', 8, 12) === 'qt  ' ? { ext: 'mov', type: 'video/quicktime' } : { ext: 'mp4', type: 'video/mp4' };
  }
  return null;
}


// Lee las medidas y la duración directamente de la cabecera del MP4/MOV (sin recomprimir nada).
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);
function readBoxes(buf, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) break;
    out.push({ type, start: p + header, end: p + size });
    p += size;
  }
  return out;
}
export function parseMp4(buf) {
  const info = { width: 0, height: 0, duration: 0, codec: '' };
  const walk = (start, end) => {
    for (const box of readBoxes(buf, start, end)) {
      try {
        if (box.type === 'mvhd') {
          const v = buf[box.start];
          const timescale = v === 1 ? buf.readUInt32BE(box.start + 20) : buf.readUInt32BE(box.start + 12);
          const dur = v === 1 ? Number(buf.readBigUInt64BE(box.start + 24)) : buf.readUInt32BE(box.start + 16);
          if (timescale && !info.duration) info.duration = Math.round((dur / timescale) * 10) / 10;
        } else if (box.type === 'tkhd' && !info.width) {
          const v = buf[box.start];
          const off = v === 1 ? 84 : 76;
          const w = buf.readUInt32BE(box.start + off) / 65536;
          const h = buf.readUInt32BE(box.start + off + 4) / 65536;
          if (w > 0 && h > 0) { info.width = Math.round(w); info.height = Math.round(h); }
        } else if (box.type === 'stsd' && !info.codec) {
          const text = buf.toString('ascii', box.start, box.end);
          if (text.includes('avc1') || text.includes('avc3')) info.codec = 'H.264';
          else if (text.includes('hvc1') || text.includes('hev1')) info.codec = 'HEVC (H.265)';
          else if (text.includes('av01')) info.codec = 'AV1';
        } else if (CONTAINERS.has(box.type)) {
          walk(box.start, box.end);
        }
      } catch { /* caja dañada: se ignora */ }
    }
  };
  walk(0, buf.length);
  return info;
}

async function load() {
  if (index) return index;
  await fs.mkdir(dir, { recursive: true });
  try {
    index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  } catch {
    index = null;
    if (r2Enabled()) {
      try {
        const buf = await getObject('videos/index.json');
        if (buf) index = JSON.parse(buf.toString('utf8'));
      } catch (err) {
        console.error('[videos] no se pudo leer el índice de R2:', err.message);
      }
    }
  }
  if (!index || !Array.isArray(index.items)) index = { items: [] };
  return index;
}

function persist() {
  chain = chain
    .then(async () => {
      const json = JSON.stringify(index);
      await fs.writeFile(`${indexFile}.tmp`, json);
      await fs.rename(`${indexFile}.tmp`, indexFile);
      if (r2Enabled()) await putObject('videos/index.json', Buffer.from(json), 'application/json');
    })
    .catch((err) => console.error('[videos] no se pudo guardar:', err.message));
  return chain;
}

export function formatVideo(item) {
  return {
    id: item.id,
    title: item.title,
    youtubeId: item.youtubeId || '',
    width: item.width,
    height: item.height,
    duration: item.duration,
    size: item.size,
    mime: item.mime,
    codec: item.codec || '',
    createdAt: item.createdAt,
    url: `/videos/${item.file}`,
    downloadName: `jordvex-video-${item.id.slice(0, 8)}.${item.file.split('.').pop()}`,
  };
}

export async function listVideos() {
  // Solo lee el índice: nunca abre los archivos de video (evita quedarse sin memoria con videos grandes).
  const data = await load();
  return data.items.map(formatVideo);
}

// Ruta local del video si está en disco; null si no está.
export async function videoPath(file) {
  if (!FILE_RE.test(file)) return null;
  const full = path.join(dir, file);
  try {
    await fs.access(full);
    return full;
  } catch {
    return null;
  }
}

export async function addVideo({ buffer, title, width, height, duration }) {
  const info = detectVideo(buffer);
  if (!info) throw new Error('formato no válido');
  const data = await load();
  const id = crypto.randomUUID();
  const file = `${id}.${info.ext}`;
  await fs.writeFile(path.join(dir, file), buffer);
  if (r2Enabled()) {
    await putObject(`videos/${file}`, buffer, info.type).catch((err) => console.error('[videos] R2:', err.message));
  }
  const parsed = info.ext === 'webm' ? { width: 0, height: 0, duration: 0, codec: '' } : parseMp4(buffer);
  const item = {
    id, file,
    title: title.slice(0, 60),
    width: width || parsed.width,
    height: height || parsed.height,
    duration: duration || parsed.duration,
    codec: parsed.codec,
    size: buffer.length, mime: info.type, createdAt: new Date().toISOString(),
  };
  data.items.unshift(item);
  await persist();
  return item;
}

export async function removeVideo(id) {
  const data = await load();
  const i = data.items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const [item] = data.items.splice(i, 1);
  if (item.file) {
    await fs.unlink(path.join(dir, item.file)).catch(() => {});
    if (r2Enabled()) await deleteObject(`videos/${item.file}`).catch(() => {});
  }
  await persist();
  return true;
}

export async function readVideoFile(file) {
  if (!FILE_RE.test(file)) return null;
  try {
    return await fs.readFile(path.join(dir, file));
  } catch {
    if (!r2Enabled()) return null;
    const buf = await getObject(`videos/${file}`).catch(() => null);
    if (buf) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, file), buf);
    }
    return buf;
  }
}

// Registra un video que el navegador ya subió directo a R2.
export async function registerVideo({ id, ext, title, width, height, duration, codec, size, mime }) {
  const MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
  if (!/^[0-9a-f-]{36}$/.test(String(id)) || !MIME[ext]) throw new Error('Datos del video no válidos.');
  const exists = await headObject(`videos/${id}.${ext}`);
  if (!exists) throw new Error('El video no llegó completo a R2. Inténtalo de nuevo.');
  const data = await load();
  const item = {
    id,
    file: `${id}.${ext}`,
    title: String(title || 'Video').slice(0, 60),
    width: Math.max(0, Math.round(Number(width) || 0)),
    height: Math.max(0, Math.round(Number(height) || 0)),
    duration: Math.max(0, Number(duration) || 0),
    codec: String(codec || '').slice(0, 20),
    size: Math.max(0, Number(size) || 0),
    mime: MIME[ext],
    createdAt: new Date().toISOString(),
  };
  data.items.unshift(item);
  await persist();
  return item;
}

// Guarda medidas reales de un video que se publicó sin ellas. Solo actúa una vez por video.
export async function setVideoMetaIfMissing(id, meta) {
  const data = await load();
  const item = data.items.find((x) => x.id === id);
  if (!item || (item.width && item.height)) return false;
  const width = Math.round(Number(meta.width) || 0);
  const height = Math.round(Number(meta.height) || 0);
  if (width < 16 || height < 16 || width > 8192 || height > 8192) return false;
  item.width = width;
  item.height = height;
  item.duration = Math.max(0, Math.round((Number(meta.duration) || 0) * 10) / 10);
  await persist();
  return true;
}

// Acepta enlaces de YouTube (watch, youtu.be, shorts, embed) o el código de 11 caracteres.
export function extractYoutubeId(text) {
  const raw = String(text || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const m = raw.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

// Video de YouTube no listado: se reproduce con el reproductor de YouTube, sin guardar archivos.
export async function addYoutube({ title, youtubeId }) {
  const data = await load();
  const item = {
    id: crypto.randomUUID(),
    title: title.slice(0, 60),
    youtubeId,
    width: 1920,
    height: 1080,
    duration: 0,
    codec: '',
    size: 0,
    mime: 'video/youtube',
    createdAt: new Date().toISOString(),
  };
  data.items.unshift(item);
  await persist();
  return item;
}
