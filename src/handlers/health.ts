// Health Check Handler

import type { Env } from '../types';
import { jsonResponse } from '../utils/response';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  services: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error' | 'disabled';
  };
}

export async function handleHealthCheck(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const detailed = url.searchParams.get('detailed') === 'true';

  const status: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2026.1.0',
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

  // 检查 R2 连接（如果启用）
  if (env.ATTACHMENTS && detailed) {
    try {
      await env.ATTACHMENTS.head('health-check');
    } catch {
      status.services.storage = 'error';
      status.status = status.status === 'unhealthy' ? 'unhealthy' : 'degraded';
    }
  }

  const statusCode = status.status === 'healthy' ? 200 :
                     status.status === 'degraded' ? 200 : 503;

  return jsonResponse(status, statusCode);
}
