import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockService = {
  getProject: vi.fn(),
  validateProjectAccess: vi.fn(),
  getProjectGrant: vi.fn(),
  getSecretByNameAndProject: vi.fn(),
  decryptSecretValue: vi.fn(),
  consumeReveal: vi.fn(),
  logSecretAccess: vi.fn(),
};

vi.mock('../../src/services/sm-service', () => ({
  SecretsManagerService: class {
    constructor() {
      return mockService;
    }
  },
}));

import { handleSecrets } from '../../src/handlers/sm-secrets';

const ENV = { ENCRYPTION_KEY: 'test-nksypsnwj-ynk-25-huqxr-nqao-zi' } as any;
const USER_ID = 'user-1';
const ACCOUNT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SECRET_VALUE = 'sk-live-abcdef123456';
const MASKED = SECRET_VALUE.slice(0, 4) + '****' + SECRET_VALUE.slice(-4);

function call(query: string, machineAccountId: string | null) {
  const path = '/api/secrets/by-name/API_KEY';
  const url = 'https://vault.example.com' + path + '?project_id=' + PROJECT_ID + query;
  return handleSecrets(
    new Request(url),
    ENV,
    path,
    'GET',
    USER_ID,
    ENV.ENCRYPTION_KEY,
    machineAccountId
  );
}

describe('凭证读取默认掩码 + 一次性 reveal（P2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: USER_ID });
    mockService.validateProjectAccess.mockResolvedValue({ allowed: true });
    mockService.getProjectGrant.mockResolvedValue({
      project_id: PROJECT_ID,
      permission: 'read',
      allowed_ip: null,
      allowed_hours: null,
      max_requests_per_minute: null,
      expires_at: null,
      mode: 'reveal',
      allowed_hosts: null,
      reveal_limit: 1,
      reveal_count: 0,
    });
    mockService.getSecretByNameAndProject.mockResolvedValue({
      id: 's1',
      value: 'cipher',
      project_id: PROJECT_ID,
    });
    mockService.decryptSecretValue.mockResolvedValue(SECRET_VALUE);
    mockService.consumeReveal.mockResolvedValue(true);
    mockService.logSecretAccess.mockResolvedValue(undefined);
  });

  it('Machine Account 默认拿到掩码，不是明文', async () => {
    const resp = await call('', ACCOUNT_ID);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.value).toBe(MASKED);
    expect(body.value).not.toBe(SECRET_VALUE);
    expect(mockService.consumeReveal).not.toHaveBeenCalled();
  });

  it('inject 模式下请求 reveal 返回 403', async () => {
    mockService.getProjectGrant.mockResolvedValue({
      ...(await mockService.getProjectGrant()),
      mode: 'inject',
    });
    const resp = await call('&reveal=1', ACCOUNT_ID);
    expect(resp.status).toBe(403);
    expect(mockService.consumeReveal).not.toHaveBeenCalled();
  });

  it('reveal 授权 + ?reveal=1 返回明文，并消耗一次配额、审计记为 reveal', async () => {
    const resp = await call('&reveal=1', ACCOUNT_ID);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.value).toBe(SECRET_VALUE);
    expect(mockService.consumeReveal).toHaveBeenCalledWith(ACCOUNT_ID, PROJECT_ID);
    expect(mockService.logSecretAccess.mock.calls[0][3]).toBe('reveal');
  });

  it('配额用尽时返回 429 且只给掩码', async () => {
    mockService.consumeReveal.mockResolvedValue(false);
    const resp = await call('&reveal=1', ACCOUNT_ID);
    expect(resp.status).toBe(429);
  });

  it('人类用户（无 machine account）始终拿到明文', async () => {
    const resp = await call('', null);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.value).toBe(SECRET_VALUE);
  });
});
