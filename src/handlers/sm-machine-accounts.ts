// Machine Accounts API Handlers

import { Env } from '../types';
import { SecretsManagerService } from '../services/sm-service';
import { jsonResponse, errorResponse } from '../utils/response';

export async function handleMachineAccounts(
  request: Request,
  env: Env,
  path: string,
  method: string,
  userId: string
): Promise<Response> {
  const smService = new SecretsManagerService(env.DB);

  // POST /api/machine-accounts - 创建机器账号
  if (method === 'POST' && path === '/api/machine-accounts') {
    const body = await request.json() as { name: string; description?: string };
    
    if (!body.name) {
      return errorResponse('Name is required', 400);
    }

    const account = await smService.createMachineAccount(userId, {
      name: body.name,
      description: body.description,
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
      const account = await smService.getMachineAccount(accountId);
      if (!account || account.user_id !== userId) {
        return errorResponse('Not found', 404);
      }
      return jsonResponse(account);
    }

    // PUT /api/machine-accounts/:id
    if (method === 'PUT') {
      const account = await smService.getMachineAccount(accountId);
      if (!account || account.user_id !== userId) {
        return errorResponse('Not found', 404);
      }

      const body = await request.json() as { name?: string; status?: string; description?: string };
      // 确保 status 是有效的值
      const validStatus = body.status === 'active' || body.status === 'disabled' ? body.status : undefined;
      const updated = await smService.updateMachineAccount(accountId, {
        ...body,
        status: validStatus,
      });
      return jsonResponse(updated);
    }

    // DELETE /api/machine-accounts/:id
    if (method === 'DELETE') {
      const account = await smService.getMachineAccount(accountId);
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
    const account = await smService.getMachineAccount(accountId);
    
    if (!account || account.user_id !== userId) {
      return errorResponse('Not found', 404);
    }

    const tokenResponse = await smService.generateAccessToken(accountId);
    return jsonResponse(tokenResponse);
  }

  return errorResponse('Not found', 404);
}
