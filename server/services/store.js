// Almacenamiento simple y sin dependencias: imágenes en disco + historial en JSON.
// Para más de una instancia o muchos usuarios, cámbialo por SQLite/Postgres + S3.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const dbFile = path.join(config.dataDir, 'history.json');
let db = null;
let writeChain = Promise.resolve();

async function load() {
  if (db) return db;
  await fs.mkdir(config.imagesDir, { recursive: true });
  try {
    db = JSON.parse(await fs.readFile(dbFile, 'utf8'));
    if (!Array.isArray(db.items)) db = { items: [] };
  } catch {
    db = { items: [] };
  }
  return db;
}

function persist() {
  writeChain = writeChain
    .then(async () => {
      const tmp = `${dbFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(db));
      await fs.rename(tmp, dbFile); // escritura atómica
    })
    .catch((err) => console.error('[store] no se pudo guardar el historial:', err));
  return writeChain;
}

const removeFile = (file) => fs.unlink(path.join(config.imagesDir, file)).catch(() => {});

export function toPublic(item) {
  return {
    id: item.id,
    prompt: item.prompt,
    style: item.style,
    ratio: item.ratio,
    resolution: item.resolution,
    quality: item.quality,
    width: item.width,
    height: item.height,
    createdAt: item.createdAt,
    url: `/media/${item.file}`,
  };
}

export async function saveImageFile(file, buffer) {
  await load();
  await fs.writeFile(path.join(config.imagesDir, file), buffer);
}

export async function addItem(item) {
  const data = await load();
  data.items.unshift(item);

  // Límite por dispositivo: se descartan las más antiguas.
  const mine = data.items.filter((i) => i.clientId === item.clientId);
  for (const old of mine.slice(config.maxHistoryPerClient)) {
    data.items.splice(data.items.indexOf(old), 1);
    await removeFile(old.file);
  }
  await persist();
  return item;
}

export async function listItems(clientId) {
  const data = await load();
  return data.items.filter((i) => i.clientId === clientId).map(toPublic);
}

export async function deleteItem(clientId, id) {
  const data = await load();
  const index = data.items.findIndex((i) => i.id === id && i.clientId === clientId);
  if (index === -1) return false;
  const [item] = data.items.splice(index, 1);
  await removeFile(item.file);
  await persist();
  return true;
}

export async function clearItems(clientId) {
  const data = await load();
  const mine = data.items.filter((i) => i.clientId === clientId);
  data.items = data.items.filter((i) => i.clientId !== clientId);
  await Promise.all(mine.map((i) => removeFile(i.file)));
  await persist();
  return mine.length;
}
