import { LIMITS } from '../config/limits';

const ICON_UPSTREAM_TIMEOUT_MS = 2500;
const DEFAULT_GLOBE_ICON_SHA256 = 'aaa64871332ad5b7d28fe8874efb19c2d9cc2f1e6de75d52b080b438225a0783';
const DEFAULT_GLOBE_ICON_BYTES = 500;

const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="Globe icon"><circle cx="48" cy="48" r="34" fill="none" stroke="#8ea9c7" stroke-width="6"/><path d="M14 48h68M48 14c10 10 16 21.5 16 34s-6 24-16 34c-10-10-16-21.5-16-34s6-24 16-34zm-24 10c8 5 17 8 24 8s16-3 24-8m-48 48c8-5 17-8 24-8s16 3 24 8" fill="none" stroke="#8ea9c7" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

type IconSource = {
  url: string;
  rejectImage?: { byteLength: number; sha256: string };
  headers?: HeadersInit;
};

function normalizeIconHost(rawHost: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(String(rawHost || '').trim()).toLowerCase().replace(/\.+$/, '');
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('/') || decoded.includes('\\')) return null;
  try {
    const parsed = new URL(`https://${decoded}`);
    return parsed.hostname === decoded ? decoded : null;
  } catch {
    return null;
  }
}

async function fetchIcon(source: { url: string; headers?: HeadersInit }): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ICON_UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(source.url, {
      headers: source.headers,
      redirect: 'follow',
      signal: controller.signal,
      cf: { cacheEverything: true, cacheTtl: LIMITS.cache.iconTtlSeconds },
    } as RequestInit & { cf: { cacheEverything: boolean; cacheTtl: number } });
  } finally {
    clearTimeout(timeout);
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function iconResponse(body: BodyInit | null, contentType: string | null): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType || 'image/png',
      'Cache-Control': `public, max-age=${LIMITS.cache.iconTtlSeconds}, immutable`,
    },
  });
}

function defaultIconResponse(): Response {
  return new Response(DEFAULT_ICON_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${LIMITS.cache.iconTtlSeconds}, immutable`,
    },
  });
}

function notFoundIconResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}

export async function handleWebsiteIcon(
  host: string,
  fallbackMode: 'default' | 'not-found' = 'default'
): Promise<Response> {
  const normalizedHost = normalizeIconHost(host);
  if (!normalizedHost) return fallbackMode === 'not-found' ? notFoundIconResponse() : defaultIconResponse();

  const encodedHost = encodeURIComponent(normalizedHost);
  const headers = { 'User-Agent': 'Tirisfal/1.0' };
  const sources: IconSource[] = [
    { url: `https://favicon.im/zh/${encodedHost}?larger=true&throw-error-on-404=true`, headers },
    {
      url: `https://icons.bitwarden.net/${encodedHost}/icon.png`,
      rejectImage: { byteLength: DEFAULT_GLOBE_ICON_BYTES, sha256: DEFAULT_GLOBE_ICON_SHA256 },
      headers,
    },
  ];

  for (const source of sources) {
    try {
      const resp = await fetchIcon(source);
      if (!resp.ok) continue;
      const ct = String(resp.headers.get('Content-Type') || '').toLowerCase();
      if (!ct.startsWith('image/')) continue;
      if (!source.rejectImage) return iconResponse(resp.body, resp.headers.get('Content-Type'));

      const contentLength = Number(resp.headers.get('Content-Length') || '');
      if (Number.isFinite(contentLength) && contentLength > 0 && contentLength !== source.rejectImage.byteLength) {
        return iconResponse(resp.body, resp.headers.get('Content-Type'));
      }

      const bytes = await resp.arrayBuffer();
      if (bytes.byteLength === 0) continue;
      if (bytes.byteLength === source.rejectImage.byteLength && (await sha256Hex(bytes)) === source.rejectImage.sha256) continue;
      return iconResponse(bytes, resp.headers.get('Content-Type'));
    } catch {
      continue;
    }
  }

  return fallbackMode === 'not-found' ? notFoundIconResponse() : defaultIconResponse();
}