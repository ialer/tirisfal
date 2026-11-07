import { describe, expect, it, vi } from 'vitest';

import { APP_VERSION } from '../../shared/app-version';
import { handleHealthCheck } from '../../src/handlers/health';

describe('Health Check Handler', () => {
  const mockEnv = {
    DB: {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ '1': 1 }),
      }),
    },
  } as any;

  it('should return healthy status', async () => {
    const request = new Request('https://example.com/health');
    const response = await handleHealthCheck(request, mockEnv);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.services.database).toBe('ok');
  });

  it('should return unhealthy when database fails', async () => {
    const failingEnv = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        }),
      },
    } as any;

    const request = new Request('https://example.com/health');
    const response = await handleHealthCheck(request, failingEnv);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.services.database).toBe('error');
  });

  it('对象存储不可用时降级（不再只在 detailed=true 才检查）', async () => {
    const env = {
      ...mockEnv,
      ATTACHMENTS: { head: vi.fn().mockRejectedValue(new Error('r2 down')) },
    };
    const response = await handleHealthCheck(new Request('https://example.com/health'), env);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.status).toBe('degraded');
    expect(data.services.storage).toBe('error');
  });

  it('对象存储可用时 storage=ok', async () => {
    const env = {
      ...mockEnv,
      ATTACHMENTS: { head: vi.fn().mockResolvedValue(null) },
    };
    const response = await handleHealthCheck(new Request('https://example.com/health'), env);
    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.services.storage).toBe('ok');
  });

  it('should include version and timestamp', async () => {
    const request = new Request('https://example.com/health');
    const response = await handleHealthCheck(request, mockEnv);
    const data = await response.json();

    expect(data.version).toBe(APP_VERSION);
    expect(data.timestamp).toBeDefined();
  });
});
