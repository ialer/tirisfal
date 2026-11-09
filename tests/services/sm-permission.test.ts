import { describe, expect, it, vi } from 'vitest';

import { SecretsManagerService } from '../../src/services/sm-service';

function serviceWithGrant(grant: Record<string, unknown>) {
  const db = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(grant) }),
    }),
  };
  return new SecretsManagerService(db as never, 'test-key');
}

const baseGrant = {
  permission: 'read',
  allowed_ip: null,
  allowed_hours: null,
  max_requests_per_minute: null,
  expires_at: null,
};

describe('SM 授权 · permission 位必须生效', () => {
  it('read 授权可以读', async () => {
    const svc = serviceWithGrant({ ...baseGrant });
    await expect(svc.validateProjectAccess('ma', 'p', undefined, 'read')).resolves.toEqual({
      allowed: true,
    });
  });

  it('read 授权不能写', async () => {
    const svc = serviceWithGrant({ ...baseGrant });
    const res = await svc.validateProjectAccess('ma', 'p', undefined, 'write');
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/Write permission required/);
  });

  it('write 授权可以写', async () => {
    const svc = serviceWithGrant({ ...baseGrant, permission: 'write' });
    await expect(svc.validateProjectAccess('ma', 'p', undefined, 'write')).resolves.toEqual({
      allowed: true,
    });
  });
});
