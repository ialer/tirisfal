import { LIMITS } from '../config/limits';

const CORS_METHODS = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
/** 默认 CORS 允许的请求头 */
const DEFAULT_CORS_HEADERS = [
  'Content-Type',
  'Authorization',
  'Accept',
  'Device-Type',
  'Device-Identifier',
  'Device-Name',
  'Bitwarden-Client-Name',
  'Bitwarden-Client-Version',
  'Bitwarden-Package-Type',
  'Is-Prerelease',
  'X-Request-Email',
  'X-Device-Identifier',
  'X-Device-Name',
  'X-Tirisfal-Web-Session',
];

/** 判断是否为浏览器扩展来源 */
function isExtensionOrigin(origin: string): boolean {
  return (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://') ||
    origin.startsWith('safari-web-extension://')
  );
}

/** 判断是否为通配符 CORS 路径（无需认证的公共路径） */
function isWildcardCorsPath(path: string): boolean {
  return (
    path.startsWith('/icons/') ||
    path === '/config' ||
    path === '/api/config' ||
    path === '/api/version' ||
    path === '/health' ||
    path === '/api/health'
  );
}

/**
 * 获取 CORS 策略
 * @returns 允许的来源和是否允许凭证
 */
function getCorsPolicy(request: Request): {
  allowOrigin: string | null;
  allowCredentials: boolean;
} {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (isWildcardCorsPath(url.pathname)) {
    return { allowOrigin: '*', allowCredentials: false };
  }
  if (!origin) {
    return { allowOrigin: null, allowCredentials: false };
  }
  if (origin === url.origin) {
    return { allowOrigin: origin, allowCredentials: true };
  }
  if (isExtensionOrigin(origin)) {
    return { allowOrigin: origin, allowCredentials: true };
  }
  return { allowOrigin: null, allowCredentials: false };
}

/** 构建 CORS 响应头 */
function buildCorsHeaders(request: Request): Record<string, string> {
  const requestedHeaders = String(request.headers.get('Access-Control-Request-Headers') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowHeaders = Array.from(new Set([...DEFAULT_CORS_HEADERS, ...requestedHeaders]));

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': allowHeaders.join(', '),
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': String(LIMITS.cors.preflightMaxAgeSeconds),
  };

  const corsPolicy = getCorsPolicy(request);
  if (corsPolicy.allowOrigin) {
    headers['Access-Control-Allow-Origin'] = corsPolicy.allowOrigin;
    if (corsPolicy.allowCredentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    headers['Vary'] = 'Origin, Access-Control-Request-Headers';
  }

  return headers;
}

/**
 * 为响应应用 CORS 头和安全头
 */
export function applyCors(request: Request, response: Response): Response {
  const webSocket = (response as Response & { webSocket?: unknown }).webSocket;
  if (response.status === 101 || webSocket) {
    return response;
  }

  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request);
  for (const [k, v] of Object.entries(corsHeaders)) {
    headers.set(k, v);
  }
  // 安全响应头
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Content-Security-Policy', "frame-ancestors 'none'; img-src 'self' data:");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * JSON 响应辅助函数
 */
export function jsonResponse(
  data: any,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * 错误响应辅助函数
 * 生产环境不暴露内部错误详情
 */
export function errorResponse(message: string, status: number = 400, exposeInternals: boolean = false): Response {
  // 生产环境只暴露安全的错误信息
  const safeMessages: Record<number, string> = {
    400: '请求无效',
    401: '未授权',
    403: '禁止访问',
    404: '未找到',
    429: '请求过于频繁',
    500: '服务器内部错误',
  };

  const responseMessage = exposeInternals ? message : (safeMessages[status] || message);

  return jsonResponse(
    {
      error: responseMessage,
      error_description: responseMessage,
      ErrorModel: {
        Message: responseMessage,
        Object: 'error',
      },
    },
    status
  );
}

/**
 * 身份验证端点错误响应（用于 /identity/connect/token）
 */
export function identityErrorResponse(
  message: string,
  error: string = 'invalid_grant',
  status: number = 400
): Response {
  return jsonResponse(
    {
      error: error,
      error_description: message,
      ErrorModel: {
        Message: message,
        Object: 'error',
      },
    },
    status
  );
}

/**
 * 处理 CORS 预检请求
 */
export function handleCors(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(request),
  });
}

/**
 * 速率限制响应辅助函数
 */
export function rateLimitResponse(retryAfterSeconds?: number): Response {
  const retryAfter = String(retryAfterSeconds || 60);
  return jsonResponse(
    { error: '请求过于频繁', error_description: `速率限制已超出，请在 ${retryAfter} 秒后重试。` },
    429,
    { 'Retry-After': retryAfter, 'X-RateLimit-Remaining': '0' }
  );
}

/**
 * HTML 响应辅助函数
 */
export function htmlResponse(html: string, status: number = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
