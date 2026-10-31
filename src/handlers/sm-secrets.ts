// Secrets API Handlers

import { SecretsManagerService } from '../services/sm-service';
import type { Env } from '../types';
import { errorResponse, jsonResponse } from '../utils/response';

/** 从请求头提取客户端真实 IP（与 ratelimit 的提取逻辑保持一致） */
export function getClientIp(request: Request): string | null {
  // 安全：只信任 Cloudflare 边缘注入的 CF-Connecting-IP。
  // X-Real-IP / X-Forwarded-For 由调用方自带，可随意伪造；一旦用于 IP 白名单判断，
  // 就能绕过 machine_account_projects.allowed_ip（审计日志也会被污染）。
  // 取不到真实 IP 时返回 null，由 validateProjectAccess 失效关闭（配置了白名单即拒绝）。
  const cfIp = request.headers.get('CF-Connecting-IP');
  return cfIp && cfIp.trim() ? cfIp.trim() : null;
}

/** 解析 grant 的 allowed_hosts（JSON 数组） */
function parseAllowedHosts(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 目标主机是否在白名单内（支持 *.example.com 单层通配） */
function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((entry) => {
    const p = entry.toLowerCase().trim();
    if (!p) return false;
    if (p.startsWith('*.')) {
      const suffix = p.slice(1);
      return h.endsWith(suffix) && h.length > suffix.length;
    }
    return h === p;
  });
}

const HOP_BY_HOP_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-authorization',
  'proxy-connection',
]);

/**
 * 出站目标校验（SSRF 防护）。
 * Workers 无法自定义 DNS 解析，因此这里只做「可判定」的部分：
 * 协议、IP 字面量、私网/本地域名、以及操作者配置的主机白名单。
 */
function validateOutboundTarget(url: URL, allowedHosts: string[]): string | null {
  if (url.protocol !== 'https:') return 'Only https targets are allowed';
  const host = url.hostname.toLowerCase();
  if (!host) return 'Invalid target host';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    return 'IP literal targets are not allowed';
  }
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
    return 'Private hosts are not allowed';
  }
  if (!allowedHosts.length) return 'allowed_hosts is not configured for this grant';
  if (!hostAllowed(host, allowedHosts)) return 'Target host is not in allowed_hosts';
  return null;
}

/** 校验当前调用者（用户或 Machine Account）对项目下凭证的访问权限，失败时返回错误 Response */
async function assertProjectSecretAccess(
  smService: SecretsManagerService,
  request: Request,
  projectId: string,
  userId: string,
  machineAccountId?: string
): Promise<Response | null> {
  if (machineAccountId) {
    const accessCheck = await smService.validateProjectAccess(
      machineAccountId,
      projectId,
      getClientIp(request) || undefined
    );
    if (!accessCheck.allowed) {
      return errorResponse(`Access denied: ${accessCheck.reason}`, 403);
    }
    return null;
  }
  const project = await smService.getProject(projectId);
  if (!project || project.user_id !== userId) {
    return errorResponse('Not found', 404);
  }
  return null;
}

export async function handleSecrets(
  request: Request,
  env: Env,
  path: string,
  method: string,
  userId: string,
  encryptionKey: string,
  machineAccountId?: string
): Promise<Response> {
  const smService = new SecretsManagerService(env.DB, encryptionKey);

  // POST /api/secrets - 创建凭证
  if (method === 'POST' && path === '/api/secrets') {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    // 输入验证
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return errorResponse('Name is required and must be a non-empty string', 400);
    }
    if (body.name.length > 255) {
      return errorResponse('Name must be less than 255 characters', 400);
    }
    if (!body.value || typeof body.value !== 'string') {
      return errorResponse('Value is required and must be a string', 400);
    }
    if (body.value.length > 10000) {
      return errorResponse('Value must be less than 10000 characters', 400);
    }
    if (!body.project_id || typeof body.project_id !== 'string') {
      return errorResponse('project_id is required and must be a string', 400);
    }
    if (body.environment && typeof body.environment !== 'string') {
      return errorResponse('environment must be a string', 400);
    }
    if (
      body.environment &&
      typeof body.environment === 'string' &&
      !['prod', 'staging', 'dev', 'test'].includes(body.environment)
    ) {
      return errorResponse('environment must be one of: prod, staging, dev, test', 400);
    }

    if (body.note !== undefined && body.note !== null) {
      if (typeof body.note !== 'string') {
        return errorResponse('note must be a string', 400);
      }
      if (body.note.length > 1000) {
        return errorResponse('note must be less than 1000 characters', 400);
      }
    }

    // 项目访问权限校验（Machine Account 走项目授权校验，用户走所有权校验）
    // 安全修复：此前 create 路径未校验 project_id 归属，任意已登录用户或未授权的
    // Machine Account 都可向他人项目写入凭证，进而投毒其他 agent 读取的密钥。
    const createAccessError = await assertProjectSecretAccess(
      smService,
      request,
      body.project_id,
      userId,
      machineAccountId
    );
    if (createAccessError) return createAccessError;

    const secret = await smService.createSecret(userId, {
      name: body.name.trim(),
      value: body.value,
      project_id: body.project_id,
      environment: body.environment as string | undefined,
      note: body.note as string | undefined,
    });

    return jsonResponse(secret, 201);
  }

  // POST /api/secrets/use - 凭证注入代理：服务端用真值访问上游，明文不出服务端
  if (method === 'POST' && path === '/api/secrets/use') {
    if (!machineAccountId) {
      return errorResponse('该接口仅限 Machine Account 调用', 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    const secretName = typeof body.name === 'string' ? body.name : '';
    const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
    const targetUrlRaw = typeof body.url === 'string' ? body.url : '';
    const httpMethod = (typeof body.method === 'string' ? body.method : 'GET').toUpperCase();
    const environment = typeof body.environment === 'string' ? body.environment : 'prod';

    if (!projectId || !secretName || !targetUrlRaw) {
      return errorResponse('project_id, name and url are required', 400);
    }
    if (!purpose) return errorResponse('purpose is required', 400);
    if (purpose.length > 200) return errorResponse('purpose must be <= 200 characters', 400);
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(httpMethod)) {
      return errorResponse('Unsupported HTTP method', 400);
    }

    // 授权检查（复用 validateProjectAccess：IP / 时段 / 过期）
    const access = await smService.validateProjectAccess(
      machineAccountId,
      projectId,
      getClientIp(request) ?? undefined
    );
    if (!access.allowed) return errorResponse('Access denied: ' + (access.reason || ''), 403);

    const grant = await smService.getProjectGrant(machineAccountId, projectId);
    if (!grant) return errorResponse('Access denied', 403);
    if ((grant.mode || 'inject') !== 'inject') {
      return errorResponse('该授权为 reveal 模式，请使用读取接口', 403);
    }

    const allowedHosts = parseAllowedHosts(grant.allowed_hosts);
    let target: URL;
    try {
      target = new URL(targetUrlRaw);
    } catch {
      return errorResponse('Invalid url', 400);
    }
    const targetError = validateOutboundTarget(target, allowedHosts);
    if (targetError) return errorResponse(targetError, 403);

    const secret = await smService.getSecretByNameAndProject(secretName, projectId, environment);
    if (!secret) return errorResponse('Not found', 404);
    const secretValue = await smService.decryptSecretValue(secret.value);

    // 请求头：丢弃 hop-by-hop，注入凭证
    const outHeaders = new Headers();
    const inputHeaders =
      body.headers && typeof body.headers === 'object'
        ? (body.headers as Record<string, unknown>)
        : {};
    for (const [key, val] of Object.entries(inputHeaders)) {
      if (typeof val !== 'string') continue;
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
      outHeaders.set(key, val);
    }
    const injectHeader =
      typeof body.header === 'string' && body.header ? body.header : 'Authorization';
    const injectPrefix = typeof body.prefix === 'string' ? body.prefix : 'Bearer ';
    outHeaders.set(injectHeader, injectPrefix + secretValue);

    const payload =
      httpMethod === 'GET' || httpMethod === 'HEAD'
        ? undefined
        : typeof body.body === 'string'
          ? body.body
          : '';
    if (payload && payload.length > 1024 * 1024) {
      return errorResponse('body too large (max 1MB)', 413);
    }

    const started = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), {
        method: httpMethod,
        headers: outHeaders,
        body: payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return errorResponse('Upstream request failed', 502);
    }
    const elapsedMs = Date.now() - started;

    // 读取上游响应：截断 + 脱敏（防止上游把凭证回显出来）
    const rawBytes = new Uint8Array(await upstream.arrayBuffer());
    const maxBytes = 512 * 1024;
    const truncated = rawBytes.length > maxBytes;
    const text = new TextDecoder().decode(truncated ? rawBytes.slice(0, maxBytes) : rawBytes);
    const redacted =
      secretValue.length >= 8 ? text.split(secretValue).join('***REDACTED***') : text;

    await smService.logSecretAccess(
      machineAccountId,
      null,
      secret.id,
      'use',
      getClientIp(request),
      request.headers.get('User-Agent'),
      { status: upstream.status, method: httpMethod, truncated, elapsed_ms: elapsedMs },
      projectId,
      environment,
      target.hostname,
      purpose
    );

    return new Response(redacted, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8',
        'X-Tirisfal-Upstream-Status': String(upstream.status),
        'X-Tirisfal-Truncated': truncated ? '1' : '0',
        'X-Tirisfal-Elapsed-Ms': String(elapsedMs),
        'Cache-Control': 'no-store',
      },
    });
  }

  // GET /api/secrets - 列出所有凭证
  if (method === 'GET' && path === '/api/secrets') {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');
    const environment = url.searchParams.get('environment');

    if (!projectId) {
      return errorResponse('project_id is required', 400);
    }

    // 验证项目访问权限（Machine Account 走项目授权校验，用户走所有权校验）
    const listAccessError = await assertProjectSecretAccess(
      smService,
      request,
      projectId,
      userId,
      machineAccountId
    );
    if (listAccessError) return listAccessError;

    const secrets = await smService.getSecretsByProject(projectId, environment || undefined);
    // 解密每个 secret 的 value
    const decryptedSecrets = await Promise.all(
      secrets.map(async (s: any) => ({
        ...s,
        value: await smService.decryptSecretValue(s.value),
      }))
    );
    return jsonResponse({ data: decryptedSecrets });
  }

  // 匹配 /api/secrets/:id
  const secretMatch = path.match(/^\/api\/secrets\/([a-f0-9-]+)$/);
  if (secretMatch) {
    const secretId = secretMatch[1];

    // GET /api/secrets/:id
    if (method === 'GET') {
      const secret = await smService.getSecret(secretId);
      if (!secret) {
        return errorResponse('Not found', 404);
      }

      // Machine Account 权限验证
      if (machineAccountId) {
        const clientIp = getClientIp(request);
        const accessCheck = await smService.validateProjectAccess(
          machineAccountId,
          secret.project_id,
          clientIp || undefined
        );
        if (!accessCheck.allowed) {
          return errorResponse(`Access denied: ${accessCheck.reason}`, 403);
        }
      } else if (secret.user_id !== userId) {
        // User 权限验证
        return errorResponse('Not found', 404);
      }

      // 解密值
      const decryptedValue = await smService.decryptSecretValue(secret.value);

      // 记录访问日志
      const clientIp =
        request.headers.get('CF-Connecting-IP') ||
        request.headers.get('X-Real-IP') ||
        request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
        null;
      await smService.logSecretAccess(
        machineAccountId || null,
        userId,
        secret.id,
        'read',
        clientIp,
        request.headers.get('User-Agent'),
        undefined,
        secret.project_id,
        secret.environment
      );

      return jsonResponse({
        ...secret,
        value: decryptedValue,
      });
    }

    // PUT /api/secrets/:id
    if (method === 'PUT') {
      const secret = await smService.getSecret(secretId);
      if (!secret) {
        return errorResponse('Not found', 404);
      }

      // Machine Account 权限验证
      if (machineAccountId) {
        const clientIp = getClientIp(request);
        const accessCheck = await smService.validateProjectAccess(
          machineAccountId,
          secret.project_id,
          clientIp || undefined
        );
        if (!accessCheck.allowed) {
          return errorResponse(`Access denied: ${accessCheck.reason}`, 403);
        }
      } else if (secret.user_id !== userId) {
        return errorResponse('Not found', 404);
      }

      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return errorResponse('Invalid JSON body', 400);
      }
      const updated = await smService.updateSecret(secretId, {
        value: body.value as string | undefined,
        note: body.note as string | undefined,
      });
      if (!updated) return errorResponse('Not found', 404);
      // 返回前解密 value，与 GET 行为保持一致（避免调用方拿到密文）
      return jsonResponse({
        ...updated,
        value: await smService.decryptSecretValue(updated.value),
      });
    }

    // DELETE /api/secrets/:id
    if (method === 'DELETE') {
      const secret = await smService.getSecret(secretId);
      if (!secret) {
        return errorResponse('Not found', 404);
      }

      // Machine Account 权限验证
      if (machineAccountId) {
        const clientIp = getClientIp(request);
        const accessCheck = await smService.validateProjectAccess(
          machineAccountId,
          secret.project_id,
          clientIp || undefined
        );
        if (!accessCheck.allowed) {
          return errorResponse(`Access denied: ${accessCheck.reason}`, 403);
        }
      } else if (secret.user_id !== userId) {
        return errorResponse('Not found', 404);
      }

      await smService.deleteSecret(secretId);
      return jsonResponse({ success: true });
    }
  }

  // POST /api/secrets/batch - 批量获取凭证（Agent 场景：一次调用拉取多个命名凭证）
  if (method === 'POST' && path === '/api/secrets/batch') {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    const environment =
      typeof body.environment === 'string' &&
      ['prod', 'staging', 'dev', 'test'].includes(body.environment)
        ? body.environment
        : undefined;
    const names = Array.isArray(body.names)
      ? (body.names as unknown[]).filter((n): n is string => typeof n === 'string' && n.length > 0)
      : null;
    if (!projectId) return errorResponse('project_id is required', 400);
    if (names !== null && names.length === 0) {
      return jsonResponse({ data: [] });
    }

    // 与单条读取一致的权限校验（Machine Account 走项目授权，用户走所有权）
    const accessError = await assertProjectSecretAccess(
      smService,
      request,
      projectId,
      userId,
      machineAccountId
    );
    if (accessError) return accessError;

    const secrets = await smService.getSecretsByProject(projectId, environment);
    const filtered = names ? secrets.filter((s) => names.includes(s.name)) : secrets;
    const data = await Promise.all(
      filtered.map(async (s) => ({
        name: s.name,
        value: await smService.decryptSecretValue(s.value),
        environment: s.environment ?? 'prod',
      }))
    );

    // 审计日志必须按真实 secret_id 记录：secret_access_logs.secret_id 有外键约束，
    // 传 "batch:N" 这类合成值会触发 FOREIGN KEY 失败，导致整个批量读取返回 500。
    await Promise.all(
      filtered.map((s) =>
        smService.logSecretAccess(
          machineAccountId || null,
          userId,
          s.id,
          'read_batch',
          getClientIp(request),
          request.headers.get('User-Agent'),
          undefined,
          projectId,
          environment
        )
      )
    );
    return jsonResponse({ data });
  }

  // 匹配 /api/secrets/by-name/:name
  const secretByNameMatch = path.match(/^\/api\/secrets\/by-name\/([^/]+)$/);
  if (secretByNameMatch && method === 'GET') {
    const secretName = decodeURIComponent(secretByNameMatch[1]);
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');
    const environment = url.searchParams.get('environment') || 'prod';

    // 输入验证
    if (!secretName || secretName.trim().length === 0) {
      return errorResponse('Secret name is required', 400);
    }
    if (secretName.length > 255) {
      return errorResponse('Secret name must be less than 255 characters', 400);
    }
    if (!projectId) {
      return errorResponse('project_id is required', 400);
    }
    if (!['prod', 'staging', 'dev', 'test'].includes(environment)) {
      return errorResponse('environment must be one of: prod, staging, dev, test', 400);
    }

    // 项目访问权限校验（Machine Account 走项目授权校验，用户走所有权校验）
    const byNameAccessError = await assertProjectSecretAccess(
      smService,
      request,
      projectId,
      userId,
      machineAccountId
    );
    if (byNameAccessError) return byNameAccessError;

    const secret = await smService.getSecretByNameAndProject(secretName, projectId, environment);
    if (!secret) {
      return errorResponse('Not found', 404);
    }

    // 解密值
    const decryptedValue = await smService.decryptSecretValue(secret.value);

    // 记录访问日志
    const clientIp = getClientIp(request);
    await smService.logSecretAccess(
      machineAccountId || null,
      userId,
      secret.id,
      'read',
      clientIp,
      request.headers.get('User-Agent'),
      undefined,
      projectId,
      environment
    );

    return jsonResponse({
      ...secret,
      value: decryptedValue,
    });
  }

  return errorResponse('Not found', 404);
}
