// Health Check Handler

import { APP_VERSION } from '../../shared/app-version';
import type { Env } from '../types';
import { jsonResponse } from '../utils/response';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  /** 应用版本（shared/app-version.ts），不是 Bitwarden 兼容版本 */
  version: string;
  services: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error' | 'disabled';
  };
}

export async function handleHealthCheck(_request: Request, env: Env): Promise<Response> {
  const status: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    services: {
      database: 'ok',
      storage: env.ATTACHMENTS ? 'ok' : 'disabled',
    },
  };

  // 检查数据库连接
  try {
    await env.DB.prepare('SELECT 1').first();
  } catch {
    status.services.database = 'error';
    status.status = 'unhealthy';
  }

  // 检查对象存储（如果启用）：始终探测，否则存储挂了 health 仍然报 healthy
  if (env.ATTACHMENTS) {
    try {
      await env.ATTACHMENTS.head('health-check');
    } catch {
      status.services.storage = 'error';
      status.status = status.status === 'unhealthy' ? 'unhealthy' : 'degraded';
    }
  }

  const statusCode = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;

  return jsonResponse(status, statusCode);
}
