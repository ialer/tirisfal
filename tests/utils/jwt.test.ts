import { describe, expect, it } from 'vitest';

import { createJWT, JWT_AUDIENCE, verifyJWT } from '../../src/utils/jwt';

const SECRET = 'unit-test-jwt-secret-with-enough-length-0001';

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 用同一密钥手写一个令牌，用来模拟「同密钥、异用途/异受众」的令牌 */
async function signRaw(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

const now = () => Math.floor(Date.now() / 1000);

function accessClaims(over: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    email: 'u@example.com',
    name: 'u',
    email_verified: true,
    amr: ['Application'],
    sstamp: 'stamp',
    iat: now(),
    exp: now() + 600,
    iss: 'tirisfal',
    aud: JWT_AUDIENCE,
    typ: 'access',
    premium: true,
    ...over,
  };
}

describe('JWT · 签发与校验', () => {
  it('正常访问令牌可往返验证', async () => {
    const token = await createJWT(
      { sub: 'user-1', email: 'u@example.com', name: 'u', sstamp: 'stamp' },
      SECRET
    );
    const payload = await verifyJWT(token, SECRET);
    expect(payload?.sub).toBe('user-1');
    expect(payload?.typ).toBe('access');
    expect(payload?.aud).toBe(JWT_AUDIENCE);
  });

  it('拒绝 typ 非 access 的同密钥令牌（令牌类型混淆）', async () => {
    const token = await signRaw(accessClaims({ typ: 'send_access' }));
    await expect(verifyJWT(token, SECRET)).resolves.toBeNull();
  });

  it('拒绝缺失 typ 的令牌（不再放行存量无 typ 令牌）', async () => {
    const { typ: _typ, ...rest } = accessClaims();
    const token = await signRaw(rest);
    await expect(verifyJWT(token, SECRET)).resolves.toBeNull();
  });

  it('拒绝 aud 不匹配或缺失的令牌', async () => {
    await expect(
      verifyJWT(await signRaw(accessClaims({ aud: 'other-api' })), SECRET)
    ).resolves.toBeNull();
    const { aud: _aud, ...rest } = accessClaims();
    await expect(verifyJWT(await signRaw(rest), SECRET)).resolves.toBeNull();
  });

  it('拒绝非 HS256 头部', async () => {
    const token = await signRaw(accessClaims(), { alg: 'none', typ: 'JWT' });
    await expect(verifyJWT(token, SECRET)).resolves.toBeNull();
  });

  it('拒绝过期令牌', async () => {
    const token = await signRaw(accessClaims({ exp: now() - 1 }));
    await expect(verifyJWT(token, SECRET)).resolves.toBeNull();
  });

  it('拒绝签发时间在未来的令牌', async () => {
    const token = await signRaw(accessClaims({ iat: now() + 3600 }));
    await expect(verifyJWT(token, SECRET)).resolves.toBeNull();
  });

  it('拒绝签名被篡改的令牌', async () => {
    const token = await createJWT(
      { sub: 'user-1', email: 'u@example.com', name: 'u', sstamp: 'stamp' },
      SECRET
    );
    const [h, p] = token.split('.');
    const forged = b64url(JSON.stringify(accessClaims({ sub: 'admin-1' })));
    await expect(verifyJWT([h, forged, token.split('.')[2]].join('.'), SECRET)).resolves.toBeNull();
    expect(p).toBeTruthy();
  });
});
