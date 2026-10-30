// Fondos publicados por el administrador. Se guardan en disco y, si hay R2, también en R2.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { deleteObject, getObject, putObject, r2Enabled } from './r2.js';

const dir = path.join(config.dataDir, 'wallpapers');
const indexFile = path.join(dir, 'index.json');
const FILE_RE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
let index = null;
let chain = Promise.resolve();

export function detectImage(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { ext: 'png', type: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
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
        const buf = await getObject('wallpapers/index.json');
        if (buf) index = JSON.parse(buf.toString('utf8'));
      } catch (err) {
        console.error('[wallpapers] no se pudo leer el índice de R2:', err.message);
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
      if (r2Enabled()) await putObject('wallpapers/index.json', Buffer.from(json), 'application/json');
    })
    .catch((err) => console.error('[wallpapers] no se pudo guardar:', err.message));
  return chain;
}

export const REACTIONS = ['👍', '❤️', '😍', '😮', '😂', '😢'];

export function formatWallpaper(item, clientId = '') {
  const reactions = Object.fromEntries(REACTIONS.map((e) => [e, 0]));
  for (const emoji of Object.values(item.votes || {})) {
    if (reactions[emoji] !== undefined) reactions[emoji] += 1;
  }
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    createdAt: item.createdAt,
    url: `/wallpapers/${item.file}`,
    downloadName: `jordvex-${item.kind}-${item.id.slice(0, 8)}.${item.file.split('.').pop()}`,
    reactions,
    mine: (item.votes || {})[clientId] ?? null,
  };
}

export async function listWallpapers(clientId = '') {
  const data = await load();
  return data.items.map((item) => formatWallpaper(item, clientId));
}

export async function reactWallpaper(id, clientId, emoji) {
  if (!REACTIONS.includes(emoji)) throw new Error('reacción no válida');
  const data = await load();
  const item = data.items.find((x) => x.id === id);
  if (!item) return null;
  item.votes = item.votes || {};
  if (item.votes[clientId] === emoji) delete item.votes[clientId];
  else item.votes[clientId] = emoji;
  await persist();
  return formatWallpaper(item, clientId);
}

export async function addWallpaper({ buffer, title, kind }) {
  const info = detectImage(buffer);
  if (!info) throw new Error('formato no válido');
  const data = await load();
  const id = crypto.randomUUID();
  const file = `${id}.${info.ext}`;
  await fs.writeFile(path.join(dir, file), buffer);
  if (r2Enabled()) {
    await putObject(`wallpapers/${file}`, buffer, info.type).catch((err) => console.error('[wallpapers] R2:', err.message));
  }
  const item = { id, file, title: title.slice(0, 60), kind, createdAt: new Date().toISOString() };
  data.items.unshift(item);
  await persist();
  return item;
}

export async function removeWallpaper(id) {
  const data = await load();
  const i = data.items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const [item] = data.items.splice(i, 1);
  await fs.unlink(path.join(dir, item.file)).catch(() => {});
  if (r2Enabled()) await deleteObject(`wallpapers/${item.file}`).catch(() => {});
  await persist();
  return true;
}

export async function readWallpaperFile(file) {
  if (!FILE_RE.test(file)) return null;
  try {
    return await fs.readFile(path.join(dir, file));
  } catch {
    if (!r2Enabled()) return null;
    const buf = await getObject(`wallpapers/${file}`).catch(() => null);
    if (buf) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, file), buf);
    }
    return buf;
  }
}
