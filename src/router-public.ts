import { LIMITS } from './config/limits';
import { handleGetPasswordHint, handleRecoverTwoFactor, handleRegister } from './handlers/accounts';
import { handlePublicDownloadAttachment, handlePublicUploadAttachment } from './handlers/attachments';
import { handleKnownDevice } from './handlers/devices';
import { handlePrelogin, handleRevocation, handleToken } from './handlers/identity';
import { handleNotificationsHub, handleNotificationsNegotiate } from './handlers/notifications';
import {
  handleAccessSend, handleAccessSendFile, handleAccessSendFileV2, handleAccessSendV2,
  handleDownloadSendFile, handlePublicUploadSendFile,
} from './handlers/sends';
import { handleWebsiteIcon } from './services/icon-proxy';
import type { Env } from './types';
import { DEFAULT_DEV_SECRET } from './types';
import { jsonResponse } from './utils/response';

type PublicRateLimiter = (category?: string, maxRequests?: number) => Promise<Response | null>;
type JwtUnsafeReason = 'missing' | 'default' | 'too_short' | null;

export interface WebBootstrapResponse {
  defaultKdfIterations: number;
  jwtUnsafeReason: JwtUnsafeReason;
  jwtSecretMinLength: number;
}

function isSameOriginWriteRequest(request: Request): boolean {
  const targetOrigin = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin) return origin === targetOrigin;
  const referer = request.headers.get('Referer');
  if (referer) {
    try { return new URL(referer).origin === targetOrigin; } catch { return false; }
  }
  return false;
}

function buildConfigResponse(origin: string) {
  return {
    version: LIMITS.compatibility.bitwardenServerVersion,
    gitHash: 'tirisfal',
    server: null,
    environment: {
      cloudRegion: 'self-hosted', vault: origin, api: `${origin}/api`,
      identity: `${origin}/identity`, notifications: `${origin}/notifications`,
      icons: origin, sso: '', fillAssistRules: null,
    },
    push: { pushTechnology: 0, vapidPublicKey: null },
    communication: null,
    settings: { disableUserRegistration: false },
    _icon_service_url: `${origin}/icons/{}/icon.png`,
    _icon_service_csp: `img-src 'self' data: ${origin}`,
    featureStates: {
      'cipher-key-encryption': true, 'duo-redirect': true, 'email-verification': true,
      'pm-19051-send-email-verification': false, 'pm-19148-innovation-archive': true,
      'unauth-ui-refresh': true, 'web-push': false,
    },
    object: 'config',
  };
}

export function buildWebBootstrapResponse(env: Env): WebBootstrapResponse {
  const secret = (env.JWT_SECRET || '').trim();
  const jwtUnsafeReason = !secret
    ? 'missing'
    : secret === DEFAULT_DEV_SECRET
      ? 'default'
      : secret.length < LIMITS.auth.jwtSecretMinLength
        ? 'too_short'
        : null;

  return {
    defaultKdfIterations: LIMITS.auth.defaultKdfIterations,
    jwtUnsafeReason,
    jwtSecretMinLength: LIMITS.auth.jwtSecretMinLength,
  };
}

export async function handlePublicRoute(
  request: Request,
  env: Env,
  path: string,
  method: string,
  enforcePublicRateLimit: PublicRateLimiter
): Promise<Response | null> {
  if (path === '/.well-known/appspecific/com.chrome.devtools.json' && method === 'GET') {
    return new Response('{}', {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  if ((path === '/api/web-bootstrap' || path === '/web-bootstrap') && method === 'GET') {
    const blocked = await enforcePublicRateLimit(
      'public-read',
      LIMITS.rateLimit.publicReadRequestsPerMinute
    );
    if (blocked) return blocked;
    return jsonResponse(buildWebBootstrapResponse(env));
  }

  const iconMatch = path.match(/^\/icons\/([^/]+)\/icon\.png$/i);
  if (iconMatch && method === 'GET') {
    const fallbackMode =
      new URL(request.url).searchParams.get('fallback') === '404' ? 'not-found' : 'default';
    return handleWebsiteIcon(iconMatch[1], fallbackMode);
  }

  const publicAttachmentMatch = path.match(/^\/api\/attachments\/([a-f0-9-]+)\/([a-f0-9-]+)$/i);
  if (publicAttachmentMatch && method === 'GET') {
    return handlePublicDownloadAttachment(
      request,
      env,
      publicAttachmentMatch[1],
      publicAttachmentMatch[2]
    );
  }

  const publicAttachmentUploadMatch = path.match(
    /^\/api\/ciphers\/([a-f0-9-]+)\/attachment\/([a-f0-9-]+)$/i
  );
  if (
    publicAttachmentUploadMatch &&
    (method === 'POST' || method === 'PUT') &&
    new URL(request.url).searchParams.has('token')
  ) {
    return handlePublicUploadAttachment(
      request,
      env,
      publicAttachmentUploadMatch[1],
      publicAttachmentUploadMatch[2]
    );
  }

  const publicSendUploadMatch = path.match(/^\/api\/sends\/([^/]+)\/file\/([^/]+)\/?$/i);
  if (
    publicSendUploadMatch &&
    (method === 'POST' || method === 'PUT') &&
    new URL(request.url).searchParams.has('token')
  ) {
    return handlePublicUploadSendFile(
      request,
      env,
      publicSendUploadMatch[1],
      publicSendUploadMatch[2]
    );
  }

  const sendAccessMatch = path.match(/^\/api\/sends\/access\/([^/]+)$/i);
  if (sendAccessMatch && method === 'POST') {
    const blocked = await enforcePublicRateLimit();
    if (blocked) return blocked;
    return handleAccessSend(request, env, sendAccessMatch[1]);
  }

  if (path === '/api/sends/access' && method === 'POST') {
    const blocked = await enforcePublicRateLimit();
    if (blocked) return blocked;
    return handleAccessSendV2(request, env);
  }

  const sendAccessFileV2Match = path.match(/^\/api\/sends\/access\/file\/([^/]+)\/?$/i);
  if (sendAccessFileV2Match && method === 'POST') {
    const blocked = await enforcePublicRateLimit();
    if (blocked) return blocked;
    return handleAccessSendFileV2(request, env, sendAccessFileV2Match[1]);
  }

  const sendAccessFileMatch = path.match(/^\/api\/sends\/([^/]+)\/access\/file\/([^/]+)\/?$/i);
  if (sendAccessFileMatch && method === 'POST') {
    const blocked = await enforcePublicRateLimit();
    if (blocked) return blocked;
    return handleAccessSendFile(request, env, sendAccessFileMatch[1], sendAccessFileMatch[2]);
  }

  const sendDownloadMatch = path.match(/^\/api\/sends\/([^/]+)\/([^/]+)\/?$/i);
  if (sendDownloadMatch && method === 'GET') {
    return handleDownloadSendFile(request, env, sendDownloadMatch[1], sendDownloadMatch[2]);
  }

  if (path === '/identity/connect/token' && method === 'POST') {
    return handleToken(request, env);
  }

  if (path === '/api/devices/knowndevice' && method === 'GET') {
    const blocked = await enforcePublicRateLimit();
    if (blocked) return jsonResponse(false);
    return handleKnownDevice(request, env);
  }

  const clearDeviceTokenMatch = path.match(/^\/api\/devices\/identifier\/([^/]+)\/clear-token$/i);
  if (clearDeviceTokenMatch && (method === 'PUT' || method === 'POST')) {
    return new Response(null, { status: 200 });
  }

  if (
    (path === '/identity/connect/revocation' || path === '/identity/connect/revoke') &&
    method === 'POST'
  ) {
    const blocked = await enforcePublicRateLimit(
      'public-sensitive',
      LIMITS.rateLimit.sensitivePublicRequestsPerMinute
    );
    if (blocked) return blocked;
    return handleRevocation(request, env);
  }

  if (path === '/identity/accounts/prelogin' && method === 'POST') {
    const blocked = await enforcePublicRateLimit(
      'public-sensitive',
      LIMITS.rateLimit.sensitivePublicRequestsPerMinute
    );
    if (blocked) return blocked;
    return handlePrelogin(request, env);
  }

  if (path === '/identity/accounts/prelogin/password' && method === 'POST') {
    const blocked = await enforcePublicRateLimit(
      'public-sensitive',
      LIMITS.rateLimit.sensitivePublicRequestsPerMinute
    );
    if (blocked) return blocked;
    return handlePrelogin(request, env);
  }

  if (
    (path === '/identity/accounts/recover-2fa' || path === '/api/accounts/recover-2fa') &&
    method === 'POST'
  ) {
    return handleRecoverTwoFactor(request, env);
  }

  if (path === '/api/accounts/password-hint' && method === 'POST') {
    const blocked = await enforcePublicRateLimit(
      'public-sensitive',
      LIMITS.rateLimit.sensitivePublicRequestsPerMinute
    );
    if (blocked) return blocked;
    if (!isSameOriginWriteRequest(request)) {
      return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return handleGetPasswordHint(request, env);
  }

  if ((path === '/config' || path === '/api/config') && method === 'GET') {
    const blocked = await enforcePublicRateLimit(
      'public-read',
      LIMITS.rateLimit.publicReadRequestsPerMinute
    );
    if (blocked) return blocked;
    const origin = new URL(request.url).origin;
    return jsonResponse(buildConfigResponse(origin));
  }

  if (path === '/api/version' && method === 'GET') {
    const blocked = await enforcePublicRateLimit(
      'public-read',
      LIMITS.rateLimit.publicReadRequestsPerMinute
    );
    if (blocked) return blocked;
    return jsonResponse(LIMITS.compatibility.bitwardenServerVersion);
  }

  if (path === '/api/accounts/register' && method === 'POST') {
    const blocked = await enforcePublicRateLimit(
      'register',
      LIMITS.rateLimit.registerRequestsPerMinute
    );
    if (blocked) return blocked;
    if (!isSameOriginWriteRequest(request)) {
      return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return handleRegister(request, env);
  }

  if (path === '/notifications/hub/negotiate' && method === 'POST') {
    return handleNotificationsNegotiate(request, env);
  }

  if (path === '/notifications/hub' && method === 'GET') {
    return handleNotificationsHub(request, env);
  }
  return null;
}
