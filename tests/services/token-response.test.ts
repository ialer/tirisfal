import { describe, expect, it } from 'vitest';

import { LIMITS } from '../../src/config/limits';
import { buildUserTokenResponse } from '../../src/services/token-response';
import type { User } from '../../src/types';

const user = {
  id: 'u1',
  email: 'u@example.com',
  name: 'U',
  status: 'active',
  role: 'user',
  key: '2.key|mac',
  privateKey: '2.priv|mac',
  publicKey: 'pk',
  kdfType: 0,
  kdfIterations: 600000,
  kdfMemory: null,
  kdfParallelism: null,
  securityStamp: 'stamp',
} as unknown as User;

describe('buildUserTokenResponse', () => {
  it('非 Web 会话返回 refresh_token 与账户密钥', () => {
    const res = buildUserTokenResponse(user, 'access-1', {
      webSession: false,
      refreshToken: 'refresh-1',
    });
    expect(res.access_token).toBe('access-1');
    expect(res.refresh_token).toBe('refresh-1');
    expect(res.expires_in).toBe(LIMITS.auth.accessTokenTtlSeconds);
    expect(res.Key).toBe(user.key);
    expect(res.KdfIterations).toBe(600000);
    expect(res.AccountKeys).toEqual(res.accountKeys);
    expect(res.UserDecryptionOptions).toBeTruthy();
  });

  it('Web 会话不回传 refresh_token，只标记 web_session', () => {
    const res = buildUserTokenResponse(user, 'access-2', {
      webSession: true,
      refreshToken: 'should-not-appear',
    });
    expect(res.web_session).toBe(true);
    expect(res.refresh_token).toBeUndefined();
  });

  it('只在传入时带上 TwoFactorToken', () => {
    const with2fa = buildUserTokenResponse(user, 'a', {
      webSession: false,
      refreshToken: 'r',
      twoFactorToken: 'tfa',
    });
    expect(with2fa.TwoFactorToken).toBe('tfa');
    const without = buildUserTokenResponse(user, 'a', { webSession: false, refreshToken: 'r' });
    expect(without.TwoFactorToken).toBeUndefined();
  });

  it('三处调用共享同一份字段集合（scope/unofficialServer 固定）', () => {
    const res = buildUserTokenResponse(user, 'a', { webSession: false, refreshToken: 'r' });
    expect(res.scope).toBe('api offline_access');
    expect(res.unofficialServer).toBe(true);
    expect(res.ForcePasswordReset).toBe(false);
  });
});
