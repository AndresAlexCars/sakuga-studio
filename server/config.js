import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const trust = process.env.TRUST_PROXY ?? '0';
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');

// Proveedor de imágenes: 'fal' (de pago, más calidad) o 'cloudflare' (cupo diario gratis).
const provider = (process.env.PROVIDER || 'fal').toLowerCase() === 'cloudflare' ? 'cloudflare' : 'fal';
const falKey = process.env.FAL_KEY || '';
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const cfApiToken = process.env.CLOUDFLARE_API_TOKEN || '';

export const config = {
  port: int(process.env.PORT, 3000),
  // Secretos: viven solo en el servidor y jamás se envían al navegador.
  provider,
  falKey,
  cfAccountId,
  cfApiToken,
  providerReady: provider === 'cloudflare' ? Boolean(cfAccountId && cfApiToken) : Boolean(falKey),
  accessCode: process.env.ACCESS_CODE || '',

  trustProxy: Number.isNaN(Number(trust)) ? trust === 'true' : Number(trust),
  dailyLimit: int(process.env.DAILY_LIMIT, 150),
  rateLimitPer10Min: int(process.env.RATE_LIMIT_PER_10_MIN, 20),
  maxPromptLength: 800,
  maxHistoryPerClient: 200,
  requestTimeoutMs: 120_000,

  models: {
    fast: process.env.FAST_MODEL || 'fal-ai/flux/schnell',
    pro: process.env.PRO_MODEL || 'fal-ai/flux-pro/v1.1',
  },

  publicDir: path.join(root, 'public'),
  dataDir,
  imagesDir: path.join(dataDir, 'images'),
};
