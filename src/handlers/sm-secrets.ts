// Secrets API Handlers

import { Env } from '../types';
import { SecretsManagerService } from '../services/sm-service';
import { jsonResponse, errorResponse } from '../utils/response';

export async function handleSecrets(
  request: Request,
  env: Env,
  path: string,
  method: string,
  userId: string,
  machineAccountId?: string
): Promise<Response> {
  const smService = new SecretsManagerService(env.DB);

  // POST /api/secrets - 创建凭证 (只允许用户)
  if (method === 'POST' && path === '/api/secrets') {
    if (machineAccountId) {
      return errorResponse('Machine accounts cannot create secrets', 403);
    }
    
    const body = await request.json() as {
      name: string;
      value: string;
      project_id: string;
      environment?: string;
      note?: string;
    };
    
    if (!body.name || !body.value || !body.project_id) {
      return errorResponse('Name, value, and project_id are required', 400);
    }

    const secret = await smService.createSecret(userId, {
      name: body.name,
      value: body.value,
      project_id: body.project_id,
      environment: body.environment,
      note: body.note,
    });

    return jsonResponse(secret, 201);
  }

  // GET /api/secrets - 列出所有凭证 (只允许用户)
  if (method === 'GET' && path === '/api/secrets') {
    if (machineAccountId) {
      return errorResponse('Machine accounts cannot list all secrets', 403);
    }
    
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

    // GET /api/secrets/:id (只允许用户)
    if (method === 'GET') {
      if (machineAccountId) {
        return errorResponse('Machine accounts cannot access secrets by ID', 403);
      }
      
      const secret = await smService.getSecret(secretId);
      if (!secret) {
        return errorResponse('Not found', 404);
      }
      return jsonResponse(secret);
    }

    // PUT /api/secrets/:id (只允许用户)
    if (method === 'PUT') {
      if (machineAccountId) {
        return errorResponse('Machine accounts cannot update secrets', 403);
      }
      
      const secret = await smService.getSecret(secretId);
      if (!secret) {
        return errorResponse('Not found', 404);
      }

      const body = await request.json() as { value?: string; note?: string };
      const updated = await smService.updateSecret(secretId, body);
      return jsonResponse(updated);
    }

    // DELETE /api/secrets/:id (只允许用户)
    if (method === 'DELETE') {
      if (machineAccountId) {
        return errorResponse('Machine accounts cannot delete secrets', 403);
      }
      
      const secret = await smService.getSecret(secretId);
      if (!secret) {
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

    if (!projectId) {
      return errorResponse('project_id is required', 400);
    }

    // 如果是机器账号，检查是否有权限访问该项目
    if (machineAccountId) {
      const hasAccess = await smService.checkMachineAccountProjectAccess(machineAccountId, projectId);
      if (!hasAccess) {
        return errorResponse('Machine account does not have access to this project', 403);
      }
    }

    const secret = await smService.getSecretByNameAndProject(secretName, projectId, environment);
    if (!secret) {
      return errorResponse('Not found', 404);
    }

    // 解密值
    const decryptedValue = smService.decryptSecretValue(secret.value);

    return jsonResponse({
      ...secret,
      value: decryptedValue,
    });
  }

  return errorResponse('Not found', 404);
}
