// Cliente de la API del propio servidor. No contiene ninguna clave del proveedor.
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

export const hasAccessCode = () => Boolean(localStorage.getItem(CODE_KEY));
export const setAccessCode = (code) => localStorage.setItem(CODE_KEY, code);

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Client-Id': clientId() };
  const code = localStorage.getItem(CODE_KEY);
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

export const api = {
  config: () => request('/api/config'),
  generate: (params) => request('/api/generate', { method: 'POST', body: params }),
  history: () => request('/api/history'),
  remove: (id) => request(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clear: () => request('/api/history', { method: 'DELETE' }),
};
