// Secrets Manager Router

import { handleMachineAccounts } from './handlers/sm-machine-accounts';
import { handleProjects } from './handlers/sm-projects';
import { handleSecrets } from './handlers/sm-secrets';
import { AuthService } from './services/auth';
import { SecretsManagerService } from './services/sm-service';
import type { Env } from './types';
import { errorResponse } from './utils/response';

export async function handleSmRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  // 检查是否是 Secrets Manager 路由
  if (
    !path.startsWith('/api/sm/') &&
    !path.startsWith('/api/machine-accounts') &&
    !path.startsWith('/api/projects') &&
    !path.startsWith('/api/secrets')
  ) {
    return null;
  }

  // 验证用户身份
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('Unauthorized', 401);
  }

  const auth = new AuthService(env);
  const verified = await auth.verifyAccessTokenWithUser(authHeader);
  if (!verified) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = verified.user.id;

  // 处理机器账号路由
  if (path.startsWith('/api/machine-accounts')) {
    return handleMachineAccounts(request, env, path, method, userId);
  }

  // 处理项目路由
  if (path.startsWith('/api/projects')) {
    return handleProjects(request, env, path, method, userId);
  }

  // 处理凭证路由
  if (path.startsWith('/api/secrets')) {
    return handleSecrets(request, env, path, method, userId);
  }

  return null;
}

// 机器账号 Token 验证路由
export async function verifyMachineToken(
  request: Request,
  env: Env
): Promise<{ machineAccountId: string; userId: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const smService = new SecretsManagerService(env.DB);
  const machineAccount = await smService.verifyAccessToken(token);

  if (!machineAccount) {
    return null;
  }

  return {
    machineAccountId: machineAccount.id,
    userId: machineAccount.user_id,
  };
}
