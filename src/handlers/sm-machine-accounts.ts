// Machine Accounts API Handlers

import { SecretsManagerService } from '../services/sm-service';
import type { Env } from '../types';
import { errorResponse, jsonResponse } from '../utils/response';

export async function handleMachineAccounts(
  request: Request,
  env: Env,
  path: string,
  method: string,
  userId: string
): Promise<Response> {
  const smService = new SecretsManagerService(env.DB, env.ENCRYPTION_KEY);

  // POST /api/machine-accounts - 创建机器账号
  if (method === 'POST' && path === '/api/machine-accounts') {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    if (!body.name || typeof body.name !== 'string') {
      return errorResponse('Name is required', 400);
    }

    const account = await smService.createMachineAccount(userId, {
      name: body.name,
      description: body.description as string | undefined,
    });

    return jsonResponse(account, 201);
  }

  // GET /api/machine-accounts - 列出所有机器账号
  if (method === 'GET' && path === '/api/machine-accounts') {
    const accounts = await smService.getMachineAccountsByUserId(userId);
    return jsonResponse({ data: accounts });
  }

  // 匹配 /api/machine-accounts/:id
  const accountMatch = path.match(/^\/api\/machine-accounts\/([a-f0-9-]+)$/);
  if (accountMatch) {
    const accountId = accountMatch[1];

    // GET /api/machine-accounts/:id
    if (method === 'GET') {
      const account = await smService.getMachineAccount(accountId, userId);
      if (!account || account.user_id !== userId) {
        return errorResponse('Not found', 404);
      }
      return jsonResponse(account);
    }

    // PUT /api/machine-accounts/:id
    if (method === 'PUT') {
      const account = await smService.getMachineAccount(accountId, userId);
      if (!account || account.user_id !== userId) {
        return errorResponse('Not found', 404);
      }

      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return errorResponse('Invalid JSON body', 400);
      }
      // 确保 status 是有效的值
      const validStatus =
        body.status === 'active' || body.status === 'disabled'
          ? (body.status as string)
          : undefined;
      const updated = await smService.updateMachineAccount(accountId, {
        name: body.name as string | undefined,
        status: validStatus as 'active' | 'disabled' | undefined,
        description: body.description as string | undefined,
      });
      return jsonResponse(updated);
    }

    // DELETE /api/machine-accounts/:id
    if (method === 'DELETE') {
      const account = await smService.getMachineAccount(accountId, userId);
      if (!account || account.user_id !== userId) {
        return errorResponse('Not found', 404);
      }

      await smService.deleteMachineAccount(accountId);
      return jsonResponse({ success: true });
    }
  }

  // POST /api/machine-accounts/:id/token - 生成访问令牌
  const tokenMatch = path.match(/^\/api\/machine-accounts\/([a-f0-9-]+)\/token$/);
  if (tokenMatch && method === 'POST') {
    const accountId = tokenMatch[1];
    const account = await smService.getMachineAccount(accountId, userId);

    if (!account || account.user_id !== userId) {
      return errorResponse('Not found', 404);
    }

    // 支持自定义过期时间
    let expiryDays: number | undefined;
    try {
      const body = await request.json<Record<string, unknown>>();
      const expiryDaysRaw = body?.expiry_days;
      if (typeof expiryDaysRaw === 'number') {
        expiryDays = expiryDaysRaw;
      }
    } catch {
      // 使用默认值
    }

    const tokenResponse = await smService.generateAccessToken(accountId, expiryDays, userId);
    return jsonResponse(tokenResponse);
  }

  // POST /api/machine-accounts/:id/revoke-token - 撤销访问令牌
  const revokeTokenMatch = path.match(/^\/api\/machine-accounts\/([a-f0-9-]+)\/revoke-token$/);
  if (revokeTokenMatch && method === 'POST') {
    const accountId = revokeTokenMatch[1];
    const account = await smService.getMachineAccount(accountId, userId);

    if (!account || account.user_id !== userId) {
      return errorResponse('Not found', 404);
    }

    await smService.revokeAccessToken(accountId, userId);
    return jsonResponse({ success: true, message: 'Token revoked' });
  }

  // GET /api/machine-accounts/:id/projects - 列出已授权的项目
  const accessListMatch = path.match(/^\/api\/machine-accounts\/([a-f0-9-]+)\/projects$/);
  if (accessListMatch && method === 'GET') {
    const accountId = accessListMatch[1];
    const account = await smService.getMachineAccount(accountId, userId);
    if (!account) return errorResponse('Not found', 404);
    const grants = await smService.getProjectAccess(accountId);
    return jsonResponse({ data: grants });
  }

  // POST / DELETE /api/machine-accounts/:id/projects/:projectId - 授权 / 撤销授权
  const accessMatch = path.match(/^\/api\/machine-accounts\/([a-f0-9-]+)\/projects\/([a-f0-9-]+)$/);
  if (accessMatch && (method === 'POST' || method === 'DELETE')) {
    const accountId = accessMatch[1];
    const projectId = accessMatch[2];

    // 机器账号与项目都必须属于当前用户
    const account = await smService.getMachineAccount(accountId, userId);
    if (!account || account.user_id !== userId) return errorResponse('Not found', 404);
    const project = await smService.getProject(projectId);
    if (!project || project.user_id !== userId) return errorResponse('Not found', 404);

    if (method === 'DELETE') {
      const removed = await smService.revokeProjectAccess(accountId, projectId);
      if (!removed) return errorResponse('Not found', 404);
      return jsonResponse({ success: true });
    }

    let body: Record<string, unknown> = {};
    const raw = await request.text();
    if (raw.trim()) {
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return errorResponse('Invalid JSON body', 400);
      }
    }

    const permission = typeof body.permission === 'string' ? body.permission : 'read';
    if (!['read', 'write', 'admin'].includes(permission)) {
      return errorResponse('permission must be one of: read, write, admin', 400);
    }

    const allowedIp = body.allowed_ip;
    if (
      allowedIp !== undefined &&
      (!Array.isArray(allowedIp) || !allowedIp.every((x) => typeof x === 'string'))
    ) {
      return errorResponse('allowed_ip must be a string array', 400);
    }

    let allowedHours: { start: number; end: number } | undefined;
    if (body.allowed_hours !== undefined) {
      const h = body.allowed_hours as { start?: unknown; end?: unknown };
      if (
        !h ||
        typeof h !== 'object' ||
        typeof h.start !== 'number' ||
        typeof h.end !== 'number' ||
        h.start < 0 ||
        h.end > 23 ||
        h.start > h.end
      ) {
        return errorResponse('allowed_hours must be {start,end} within 0..23', 400);
      }
      allowedHours = { start: h.start, end: h.end };
    }

    let maxRpm: number | undefined;
    if (body.max_requests_per_minute !== undefined) {
      const v = body.max_requests_per_minute;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10000) {
        return errorResponse('max_requests_per_minute must be an integer within 1..10000', 400);
      }
      maxRpm = v;
    }

    let expiresAt: string | undefined;
    if (body.expires_at !== undefined) {
      const v = body.expires_at;
      if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
        return errorResponse('expires_at must be an ISO-8601 timestamp', 400);
      }
      expiresAt = v;
    }

    await smService.grantProjectAccess(accountId, projectId, permission, {
      allowed_ip: allowedIp,
      allowed_hours: allowedHours,
      max_requests_per_minute: maxRpm,
      expires_at: expiresAt,
    });

    return jsonResponse(
      { success: true, machine_account_id: accountId, project_id: projectId, permission },
      201
    );
  }

  return errorResponse('Not found', 404);
}
