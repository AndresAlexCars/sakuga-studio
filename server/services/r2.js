// Cliente mínimo para Cloudflare R2 (API compatible con S3), sin dependencias.
// Solo se usa si hay credenciales R2 en las variables de entorno. Las claves nunca llegan al navegador.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from '../config.js';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function signingKey(dateStamp) {
  const kDate = hmac(`AWS4${config.r2.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

async function request(method, key, body, contentType) {
  const host = `${config.r2.accountId}.r2.cloudflarestorage.com`;
  const path = `/${config.r2.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256(payload);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(dateStamp)).update(stringToSign).digest('hex');

  const sendHeaders = { ...headers };
  delete sendHeaders.host;
  sendHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${config.r2.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${host}${path}`, {
    method,
    headers: sendHeaders,
    body: method === 'PUT' ? payload : undefined,
    signal: AbortSignal.timeout(30_000),
  });
}

export const r2Enabled = () => config.r2.enabled;

export async function putObject(key, buffer, contentType = 'application/octet-stream') {
  const res = await request('PUT', key, buffer, contentType);
  if (!res.ok) throw new Error(`R2 PUT ${key}: ${res.status}`);
}

export async function getObject(key) {
  const res = await request('GET', key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${key}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteObject(key) {
  const res = await request('DELETE', key);
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key}: ${res.status}`);
}

// URL firmada: el navegador sube o descarga directo de R2, sin pasar por el servidor.
export function presignUrl(method, key, expires = 3600) {
  const host = `${config.r2.accountId}.r2.cloudflarestorage.com`;
  const urlPath = `/${config.r2.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.r2.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const canonicalRequest = [method, urlPath, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(dateStamp)).update(stringToSign).digest('hex');
  return `https://${host}${urlPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export async function headObject(key) {
  const res = await request('HEAD', key);
  return res.ok;
}

// Sube un video en streaming: el servidor lo reenvía a R2 sin guardarlo en memoria.
export async function putStream(key, stream, size, contentType) {
  const host = `${config.r2.accountId}.r2.cloudflarestorage.com`;
  const urlPath = `/${config.r2.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers = { host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amzDate, 'content-type': contentType };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = ['PUT', urlPath, '', canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(dateStamp)).update(stringToSign).digest('hex');
  const res = await fetch(`https://${host}${urlPath}`, {
    method: 'PUT',
    headers: {
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amzDate,
      'content-type': contentType,
      'content-length': String(size),
      authorization: `AWS4-HMAC-SHA256 Credential=${config.r2.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: Readable.toWeb(stream),
    duplex: 'half',
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`R2 PUT ${key}: ${res.status}`);
}

