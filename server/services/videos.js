// Videos publicados por el administrador. Se guardan tal cual (sin recomprimir) en disco y, si hay R2, también en R2.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { deleteObject, getObject, putObject, r2Enabled } from './r2.js';

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
  const data = await load();
  // Videos publicados antes de esta versión: se leen sus medidas una sola vez y se guardan.
  let changed = false;
  for (const item of data.items) {
    if (item.width && item.codec) continue;
    const buf = await readVideoFile(item.file).catch(() => null);
    if (!buf) continue;
    const info = parseMp4(buf);
    item.width = item.width || info.width;
    item.height = item.height || info.height;
    item.duration = item.duration || info.duration;
    item.codec = info.codec || item.codec || '';
    changed = true;
  }
  if (changed) await persist();
  return data.items.map(formatVideo);
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
  await fs.unlink(path.join(dir, item.file)).catch(() => {});
  if (r2Enabled()) await deleteObject(`videos/${item.file}`).catch(() => {});
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
