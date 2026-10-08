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

export const config = {
  port: int(process.env.PORT, 3000),
  // Secretos: viven solo en el servidor y jamás se envían al navegador.
  falKey: process.env.FAL_KEY || '',
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
