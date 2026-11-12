const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const ALLOWED_SUFFIXES = ['.fbcdn.net', '.cdninstagram.com'];

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

function allowedMediaUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

export async function onRequestGet({ request }) {
  const incoming = new URL(request.url);
  const mediaUrl = incoming.searchParams.get('url');
  if (!mediaUrl || !allowedMediaUrl(mediaUrl)) {
    return jsonError('Dirección de video no válida.', 400);
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; JORDVEX/1.0)',
    'Referer': 'https://www.instagram.com/',
    'Accept': '*/*',
  };
  const range = request.headers.get('Range');
  if (range) headers.Range = range;

  try {
    let target = mediaUrl;
    let upstream;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      upstream = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(60000) });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get('Location');
      if (!location) return jsonError('Instagram devolvió una redirección incompleta.', 502);
      target = new URL(location, target).toString();
      if (!allowedMediaUrl(target)) return jsonError('Redirección de video no permitida.', 502);
    }

    if (!upstream || ![200, 206].includes(upstream.status) || !upstream.body) {
      return jsonError('No se pudo obtener el archivo de video desde Instagram.', 502);
    }

    const contentType = upstream.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('video/')) {
      return jsonError('Instagram no devolvió un archivo de video.', 502);
    }

    const download = incoming.searchParams.get('download') === '1';
    const responseHeaders = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="jordvex-instagram.mp4"`,
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of ['Content-Length', 'Content-Range']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return jsonError('Error transmitiendo el video. Inténtalo de nuevo.', 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'HEAD') return onRequestGet({ request });
  return jsonError('Método no permitido.', 405);
}
