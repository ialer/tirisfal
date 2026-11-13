import type { Env } from '../types';

/** YubiCloud 默认校验地址；自建 yubikey-val 时用 YUBICO_VALIDATION_URL 覆盖 */
const DEFAULT_VALIDATION_URL = 'https://api.yubico.com/wsapi/2.0/verify';
const MODHEX_RE = /^[cbdefghijklnrtuv]{44}$/;

export interface YubikeyVerifyResult {
  ok: boolean;
  status: string;
  publicId: string | null;
}

function modhexToPublicId(otp: string): string | null {
  const normalized = otp.trim().toLowerCase();
  if (!MODHEX_RE.test(normalized)) return null;
  return normalized.slice(0, 12);
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-1' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 排序后的参数（不含 h）→ HMAC-SHA1 → base64 */
async function signedQuery(secret: string, params: Record<string, string>): Promise<string> {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
  const h = await hmacSha1Base64(secret, message);
  return `${message}&h=${encodeURIComponent(h)}`;
}

/** 校验 YubiCloud 响应签名（去掉 h 后同样排序签名） */
async function verifyResponseSignature(
  secret: string,
  responseParams: Record<string, string>
): Promise<boolean> {
  const provided = responseParams.h;
  if (!provided) return false;
  const rest: Record<string, string> = {};
  for (const key of Object.keys(responseParams)) {
    if (key !== 'h') rest[key] = responseParams[key];
  }
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(rest[k])}`)
    .join('&');
  const expected = await hmacSha1Base64(secret, message);
  return constantTimeEquals(expected, provided);
}

function parseResponse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** 校验 YubiKey OTP；未配置 YUBICO_* 时返回 NOT_CONFIGURED */
export async function verifyYubikeyOtp(env: Env, otp: string): Promise<YubikeyVerifyResult> {
  const publicId = modhexToPublicId(otp);
  const clientId = (env.YUBICO_CLIENT_ID || '').trim();
  const secret = (env.YUBICO_SECRET || '').trim();
  if (!publicId) return { ok: false, status: 'BAD_OTP', publicId: null };
  if (!clientId || !secret) return { ok: false, status: 'NOT_CONFIGURED', publicId };

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const base = (env.YUBICO_VALIDATION_URL || DEFAULT_VALIDATION_URL).trim();
  const query = await signedQuery(secret, {
    id: clientId,
    otp: otp.trim(),
    nonce,
    timestamp: '1',
    sl: 'secure',
    timeout: '5',
  });

  let text: string;
  try {
    const resp = await fetch(`${base}?${query}`, {
      method: 'GET',
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return { ok: false, status: `HTTP_${resp.status}`, publicId };
    text = await resp.text();
  } catch {
    return { ok: false, status: 'NETWORK_ERROR', publicId };
  }

  const params = parseResponse(text);
  if (!(await verifyResponseSignature(secret, params))) {
    return { ok: false, status: 'BAD_SIGNATURE', publicId };
  }
  if (params.nonce !== nonce) return { ok: false, status: 'BAD_NONCE', publicId };
  if (params.otp !== otp.trim()) return { ok: false, status: 'BAD_OTP', publicId };
  if (params.status !== 'OK') return { ok: false, status: params.status || 'UNKNOWN', publicId };
  return { ok: true, status: 'OK', publicId };
}

export function isYubikeyConfigured(env: Env): boolean {
  return Boolean((env.YUBICO_CLIENT_ID || '').trim() && (env.YUBICO_SECRET || '').trim());
}
/** OTP 哈希（仅用于本地防重放，不存储 OTP 明文） */
export async function hashOtp(otp: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(otp.trim()));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
