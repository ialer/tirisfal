import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: {
    getUserById: vi.fn(),
    listYubikeys: vi.fn(),
    countYubikeys: vi.fn(),
    addYubikey: vi.fn(),
    deleteYubikey: vi.fn(),
    findYubikeyByPublicId: vi.fn(),
    findYubikeyOwner: vi.fn(),
    setYubikeyLastOtpHash: vi.fn(),
    touchYubikey: vi.fn(),
  },
  auth: { verifyPassword: vi.fn() },
  yubi: { verifyYubikeyOtp: vi.fn(), isYubikeyConfigured: vi.fn() },
  rate: { consumeBudget: vi.fn() },
}));
const { storage, auth, yubi } = mocks;

vi.mock('../../src/services/storage', () => ({
  StorageService: class {
    constructor() {
      return mocks.storage;
    }
  },
}));
vi.mock('../../src/services/auth', () => ({
  AuthService: class {
    constructor() {
      return mocks.auth;
    }
  },
}));
vi.mock('../../src/services/yubikey', () => mocks.yubi);
vi.mock('../../src/services/ratelimit', () => ({
  RateLimitService: class {
    constructor() {
      return mocks.rate;
    }
  },
}));

import { handleYubikeyRoute } from '../../src/handlers/yubikey';

const ENV = {} as never;
const USER = 'user-1';

function call(method: string, path: string, body?: unknown) {
  return handleYubikeyRoute(
    new Request(`https://vault.example.com${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ENV,
    path,
    method,
    USER
  );
}

describe('YubiKey 管理接口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getUserById.mockResolvedValue({
      id: USER,
      email: 'u@example.com',
      masterPasswordHash: 'hash',
    });
    storage.listYubikeys.mockResolvedValue([]);
    storage.findYubikeyByPublicId.mockResolvedValue(null);
    storage.findYubikeyOwner.mockResolvedValue(null);
    storage.setYubikeyLastOtpHash.mockResolvedValue(undefined);
    mocks.rate.consumeBudget.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    auth.verifyPassword.mockResolvedValue(true);
    yubi.isYubikeyConfigured.mockReturnValue(true);
    yubi.verifyYubikeyOtp.mockResolvedValue({ ok: true, status: 'OK', publicId: 'ccccccbcgujh' });
  });

  it('未配置时拒绝绑定', async () => {
    yubi.isYubikeyConfigured.mockReturnValue(false);
    const resp = await call('POST', '/two-factor/yubikey', {
      masterPasswordHash: 'hash',
      otp: 'x',
    });
    expect(resp.status).toBe(400);
  });

  it('密码错误时 401', async () => {
    auth.verifyPassword.mockResolvedValue(false);
    const resp = await call('POST', '/two-factor/yubikey', {
      masterPasswordHash: 'bad',
      otp: 'x',
    });
    expect(resp.status).toBe(401);
  });

  it('绑定成功写入存储', async () => {
    const resp = await call('POST', '/two-factor/yubikey', {
      masterPasswordHash: 'hash',
      otp: `ccccccbcgujh${'a'.repeat(32)}`,
      name: 'work key',
    });
    expect(resp.status).toBe(200);
    expect(storage.addYubikey).toHaveBeenCalledWith(USER, 'ccccccbcgujh', 'work key');
  });

  it('触发限速时返回 429', async () => {
    mocks.rate.consumeBudget.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const resp = await call('POST', '/two-factor/yubikey', {
      masterPasswordHash: 'hash',
      otp: 'x',
    });
    expect(resp.status).toBe(429);
  });

  it('钥匙已绑定到其他账号时返回 409', async () => {
    storage.findYubikeyOwner.mockResolvedValue({ id: 'k9', user_id: 'other' });
    const resp = await call('POST', '/two-factor/yubikey', {
      masterPasswordHash: 'hash',
      otp: 'x',
    });
    expect(resp.status).toBe(409);
  });

  it('重复绑定同一把钥匙返回 409', async () => {
    storage.findYubikeyByPublicId.mockResolvedValue({ id: 'k1' });
    const resp = await call('POST', '/two-factor/yubikey', {
      masterPasswordHash: 'hash',
      otp: 'x',
    });
    expect(resp.status).toBe(409);
  });

  it('列表只回显 publicId 前 4 位', async () => {
    storage.listYubikeys.mockResolvedValue([
      { id: 'k1', public_id: 'ccccccbcgujh', name: 'k', created_at: 't', last_used_at: null },
    ]);
    const resp = await call('GET', '/two-factor/yubikey');
    const body = await resp.json();
    expect(body.data[0].publicId).toBe('cccc***');
  });

  it('删除不存在的钥匙返回 404', async () => {
    storage.deleteYubikey.mockResolvedValue(false);
    const resp = await call('DELETE', '/two-factor/yubikey/11111111-1111-4111-8111-111111111111', {
      masterPasswordHash: 'hash',
    });
    expect(resp.status).toBe(404);
  });
});
