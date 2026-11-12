const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function getInstagramPost(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(host === 'instagram.com' || host === 'www.instagram.com' || host === 'm.instagram.com')) {
    return null;
  }

  const match = url.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return null;
  return { type: match[1], shortcode: match[2] };
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#x26;/gi, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

function extractVideoUrl(html) {
  const candidates = [];

  // Open Graph tags used by some public Instagram embed responses.
  for (const match of html.matchAll(/<meta\b[^>]*(?:property|name)=["']og:video(?::secure_url)?["'][^>]*content=["']([^"']+)["'][^>]*>/gi)) {
    candidates.push(decodeHtml(match[1]));
  }
  for (const match of html.matchAll(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:video(?::secure_url)?["'][^>]*>/gi)) {
    candidates.push(decodeHtml(match[1]));
  }

  // Public embed HTML sometimes contains a JSON-escaped video_url field.
  for (const match of html.matchAll(/"video_url"\s*:\s*"((?:\\.|[^"\\])+)"/g)) {
    try {
      candidates.push(JSON.parse(`"${match[1]}"`));
    } catch {
      // Ignore malformed or truncated fields.
    }
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase();
      const allowedHost = host === 'fbcdn.net' || host.endsWith('.fbcdn.net') || host === 'cdninstagram.com' || host.endsWith('.cdninstagram.com');
      if (url.protocol === 'https:' && allowedHost) return url.toString();
    } catch {
      // Ignore non-URL metadata.
    }
  }
  return null;
}

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Envía un JSON válido con el campo url.' }, 400);
  }

  const post = getInstagramPost(body?.url);
  if (!post) {
    return json({ error: 'Enlace no válido. Usa un Reel o una publicación pública de Instagram.' }, 400);
  }

  const embedUrl = `https://www.instagram.com/${post.type}/${post.shortcode}/embed/captioned/`;
  try {
    const upstream = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JORDVEX/1.0; +https://jordvex.xyz)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': 'https://www.instagram.com/',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return json({ error: 'Instagram no permitió consultar esta publicación. Comprueba que sea pública e inténtalo más tarde.' }, 502);
    }

    const html = await upstream.text();
    const mediaUrl = extractVideoUrl(html);
    if (!mediaUrl) {
      return json({ error: 'Instagram no entregó el video público. Puede requerir inicio de sesión o no estar disponible para extracción.' }, 404);
    }

    const videoUrl = `/api/instagram/download?url=${encodeURIComponent(mediaUrl)}`;
    return json({ ok: true, videoUrl });
  } catch (error) {
    return json({ error: 'No se pudo consultar Instagram. Inténtalo de nuevo más tarde.' }, 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost({ request });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Allow': 'POST, OPTIONS' } });
  return json({ error: 'Método no permitido. Usa POST.' }, 405);
}
