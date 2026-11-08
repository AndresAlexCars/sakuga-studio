// Cliente de la API del propio servidor. No contiene ninguna clave del proveedor.
const safeGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const safeSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } };
const CLIENT_KEY = 'sakuga.clientId';
const CODE_KEY = 'sakuga.accessCode';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// crypto.randomUUID no existe en http (red local); getRandomValues sí.
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return (clientId.fallback ??= uuid());
  }
}

export const hasAccessCode = () => Boolean(safeGet(CODE_KEY));
export const setAccessCode = (code) => safeSet(CODE_KEY, code);

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Client-Id': clientId() };
  const code = safeGet(CODE_KEY);
  if (code) headers['X-Access-Code'] = code;
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Sin conexión con el servidor. Revisa tu internet.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Algo salió mal. Inténtalo de nuevo.', res.status);
  return data;
}

async function raw(path, { method = 'GET', body, headers = {} } = {}) {
  const h = { 'X-Client-Id': clientId(), ...headers };
  const code = safeGet(CODE_KEY);
  if (code) h['X-Access-Code'] = code;
  let res;
  try {
    res = await fetch(path, { method, headers: h, body });
  } catch {
    throw new ApiError('Sin conexión con el servidor. Revisa tu internet.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Algo salió mal (código ${res.status}). Inténtalo de nuevo.`, res.status);
  return data;
}

export const api = {
  wallpapers: () => request('/api/wallpapers'),
  viewWallpaper: (id) => request(`/api/wallpapers/${encodeURIComponent(id)}/view`, { method: 'POST' }),
  statsCsv: async (adminCode) => {
    const headers = { 'X-Client-Id': clientId(), 'X-Admin-Code': adminCode };
    const code = safeGet(CODE_KEY);
    if (code) headers['X-Access-Code'] = code;
    let res;
    try {
      res = await fetch('/api/admin/stats.csv', { headers });
    } catch {
      throw new ApiError('Sin conexión con el servidor.', 0);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error || 'No se pudo descargar.', res.status);
    }
    return res.blob();
  },
  sound: () => request('/api/sound'),
  videoMeta: (id, meta) => request(`/api/videos/${encodeURIComponent(id)}/meta`, { method: 'POST', body: meta }),
  videoStream: (file, meta, title, adminCode) =>
    raw('/api/videos/stream', {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': file.type || 'video/mp4',
        'X-Size': String(file.size),
        'X-Title': encodeURIComponent(title),
        'X-Meta': encodeURIComponent(JSON.stringify(meta)),
        'X-Admin-Code': adminCode,
      },
    }),
  videoPresign: (contentType, size, adminCode) =>
    raw('/api/videos/presign', { method: 'POST', body: JSON.stringify({ contentType, size }), headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode } }),
  videoComplete: (data, adminCode) =>
    raw('/api/videos/complete', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode } }),
  music: () => request('/api/music'),
  uploadMusic: (blob, adminCode) =>
    raw('/api/music', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type, 'X-Admin-Code': adminCode } }),
  uploadSound: (blob, adminCode) =>
    raw('/api/sound', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type, 'X-Admin-Code': adminCode } }),
  videos: () => request('/api/videos'),
  uploadVideo: (blob, title, meta, adminCode) =>
    raw('/api/videos', {
      method: 'POST',
      body: blob,
      headers: {
        'Content-Type': blob.type || 'video/mp4',
        'X-Title': encodeURIComponent(title),
        'X-Width': String(meta.width),
        'X-Height': String(meta.height),
        'X-Duration': String(meta.duration),
        'X-Admin-Code': adminCode,
      },
    }),
  deleteVideo: (id, adminCode) => raw(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Admin-Code': adminCode } }),
  reactWallpaper: (id, emoji) => request(`/api/wallpapers/${encodeURIComponent(id)}/react`, { method: 'POST', body: { emoji } }),
  deleteWallpaper: (id, adminCode) => raw(`/api/wallpapers/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Admin-Code': adminCode } }),
  uploadWallpaper: (blob, kind, title, adminCode) =>
    raw('/api/wallpapers', {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': blob.type, 'X-Kind': kind, 'X-Title': encodeURIComponent(title), 'X-Admin-Code': adminCode },
    }),
  config: () => request('/api/config'),
  chat: (messages, provider) => request('/api/chat', { method: 'POST', body: { messages, provider } }),
  generate: (params) => raw('/api/generate', { method: 'POST', body: JSON.stringify(params), headers: { 'Content-Type': 'application/json', 'X-Admin-Code': safeGet('sakuga.adminCode') || '' } }),
  history: () => request('/api/history'),
  remove: (id) => request(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clear: () => request('/api/history', { method: 'DELETE' }),
};
