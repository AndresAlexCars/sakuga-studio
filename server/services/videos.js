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
    createdAt: item.createdAt,
    url: `/videos/${item.file}`,
    downloadName: `jordvex-video-${item.id.slice(0, 8)}.${item.file.split('.').pop()}`,
  };
}

export async function listVideos() {
  const data = await load();
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
  const item = {
    id, file, title: title.slice(0, 60), width, height, duration,
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
