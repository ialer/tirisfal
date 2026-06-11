import { describe, it, expect, vi } from 'vitest';
import { handleHealthCheck } from '../../src/handlers/health';

describe('Health Check Handler', () => {
  const mockEnv = {
    DB: {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ '1': 1 })
      })
    }
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
          first: vi.fn().mockRejectedValue(new Error('DB connection failed'))
        })
      }
    } as any;

    const request = new Request('https://example.com/health');
    const response = await handleHealthCheck(request, failingEnv);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.services.database).toBe('error');
  });

  it('should include version and timestamp', async () => {
    const request = new Request('https://example.com/health');
    const response = await handleHealthCheck(request, mockEnv);
    const data = await response.json();

    expect(data.version).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });
});
