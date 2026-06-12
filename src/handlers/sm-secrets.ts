// Secrets API Handlers

import { SecretsManagerService } from '../services/sm-service';
import type { Env } from '../types';
import { errorResponse, jsonResponse } from '../utils/response';

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
    if (!body.name || typeof body.name !== 'string' || (body.name as string).trim().length === 0) {
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
    if (body.environment && typeof body.environment === 'string' && !['prod', 'staging', 'dev', 'test'].includes(body.environment)) {
      return errorResponse('environment must be one of: prod, staging, dev, test', 400);
    }

    const secret = await smService.createSecret(userId, {
      name: (body.name as string).trim(),
      value: body.value as string,
      project_id: body.project_id as string,
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

    const secrets = await smService.getSecretsByProject(projectId, environment || undefined);
    return jsonResponse({ data: secrets });
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
      // 权限隔离：验证用户是否拥有该项目
      if (secret.user_id !== userId && !machineAccountId) {
        return errorResponse('Not found', 404);
      }
      // 解密值
      const decryptedValue = await smService.decryptSecretValue(secret.value);
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
      // 权限隔离：验证用户是否拥有该项目
      if (secret.user_id !== userId && !machineAccountId) {
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
      return jsonResponse(updated);
    }

    // DELETE /api/secrets/:id
    if (method === 'DELETE') {
      const secret = await smService.getSecret(secretId);
      if (!secret) {
        return errorResponse('Not found', 404);
      }
      // 权限隔离：验证用户是否拥有该项目
      if (secret.user_id !== userId && !machineAccountId) {
        return errorResponse('Not found', 404);
      }

      await smService.deleteSecret(secretId);
      return jsonResponse({ success: true });
    }
  }

  // 匹配 /api/secrets/by-name/:name
  const secretByNameMatch = path.match(/^\/api\/secrets\/by-name\/([^\/]+)$/);
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

    // Machine Account 权限验证
    if (machineAccountId) {
      // 使用与 ratelimit 相同的 IP 提取逻辑
      const clientIp = request.headers.get('CF-Connecting-IP') ||
                       request.headers.get('X-Real-IP') ||
                       request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
      const accessCheck = await smService.validateProjectAccess(machineAccountId, projectId, clientIp || undefined);
      if (!accessCheck.allowed) {
        return errorResponse(`Access denied: ${accessCheck.reason}`, 403);
      }
    }

    const secret = await smService.getSecretByNameAndProject(secretName, projectId, environment);
    if (!secret) {
      return errorResponse('Not found', 404);
    }

    // 解密值
    const decryptedValue = await smService.decryptSecretValue(secret.value);

    // 记录访问日志
    const clientIp = request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Real-IP') ||
                     request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || null;
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
