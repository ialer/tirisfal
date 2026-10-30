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

    await smService.logSecretAccess(
      machineAccountId || null,
      userId,
      `batch:${filtered.length}`,
      'read_batch',
      getClientIp(request),
      request.headers.get('User-Agent'),
      undefined,
      projectId,
      environment
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
