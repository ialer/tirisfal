import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockService = {
  validateProjectAccess: vi.fn(),
  getProjectGrant: vi.fn(),
  getSecretByNameAndProject: vi.fn(),
  decryptSecretValue: vi.fn(),
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

const ENV = { ENCRYPTION_KEY: 'test-encryption-key-32-bytes-long-xx' } as any;
const USER_ID = 'user-1';
const ACCOUNT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SECRET_VALUE = 'sk-live-abcdef123456';

function call(body: unknown, machineAccountId: string | null = ACCOUNT_ID) {
  const req = new Request('https://vault.example.com/api/secrets/use', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleSecrets(
    req,
    ENV,
    '/api/secrets/use',
    'POST',
    USER_ID,
    ENV.ENCRYPTION_KEY,
    machineAccountId
  );
}

const baseBody = {
  project_id: PROJECT_ID,
  name: 'API_KEY',
  url: 'https://api.example.com/v1/echo',
  purpose: 'unit-test',
};

describe('POST /api/secrets/use（凭证注入代理）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.validateProjectAccess.mockResolvedValue({ allowed: true });
    mockService.getProjectGrant.mockResolvedValue({
      project_id: PROJECT_ID,
      permission: 'read',
      allowed_ip: null,
      allowed_hours: null,
      max_requests_per_minute: null,
      expires_at: null,
      mode: 'inject',
      allowed_hosts: JSON.stringify(['api.example.com']),
    });
    mockService.getSecretByNameAndProject.mockResolvedValue({ id: 's1', value: 'cipher' });
    mockService.decryptSecretValue.mockResolvedValue(SECRET_VALUE);
    mockService.logSecretAccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('用户 token（非 machine account）调用返回 403', async () => {
    const resp = await call(baseBody, null);
    expect(resp.status).toBe(403);
  });

  it('未授权项目返回 403', async () => {
    mockService.validateProjectAccess.mockResolvedValue({ allowed: false, reason: 'No access' });
    const resp = await call(baseBody);
    expect(resp.status).toBe(403);
  });

  it('reveal 模式的 grant 不允许走注入接口', async () => {
    mockService.getProjectGrant.mockResolvedValue({
      ...(await mockService.getProjectGrant()),
      mode: 'reveal',
    });
    const resp = await call(baseBody);
    expect(resp.status).toBe(403);
  });

  it('目标不在 allowed_hosts 返回 403', async () => {
    const resp = await call({ ...baseBody, url: 'https://evil.example.net/x' });
    expect(resp.status).toBe(403);
  });

  it('http 目标返回 403', async () => {
    const resp = await call({ ...baseBody, url: 'http://api.example.com/x' });
    expect(resp.status).toBe(403);
  });

  it('IP 字面量目标返回 403（SSRF）', async () => {
    const resp = await call({ ...baseBody, url: 'https://169.254.169.254/latest/meta-data/' });
    expect(resp.status).toBe(403);
  });

  it('localhost 目标返回 403（SSRF）', async () => {
    const resp = await call({ ...baseBody, url: 'https://localhost:8443/x' });
    expect(resp.status).toBe(403);
  });

  it('缺少 purpose 返回 400', async () => {
    const resp = await call({ ...baseBody, purpose: '' });
    expect(resp.status).toBe(400);
  });

  it('正常注入：凭证进 Authorization 头，且上游回显的明文被脱敏', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const headers = init.headers as Headers;
      // 上游把收到的 Authorization 原样回显，模拟“上游回显凭证”
      return new Response(JSON.stringify({ echo: headers.get('Authorization') }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await call(baseBody);
    expect(resp.status).toBe(200);

    const init = fetchMock.mock.calls[0][1];
    const sent = (init.headers as Headers).get('Authorization');
    expect(sent).toBe('Bearer ' + SECRET_VALUE);

    const text = await resp.text();
    expect(text).not.toContain(SECRET_VALUE);
    expect(text).toContain('***REDACTED***');
    const auditArgs = mockService.logSecretAccess.mock.calls[0];
    expect(auditArgs[0]).toBe(ACCOUNT_ID);
    expect(auditArgs[2]).toBe('s1');
    expect(auditArgs[3]).toBe('use');
    expect(auditArgs[7]).toBe(PROJECT_ID);
    expect(auditArgs[8]).toBe('prod');
    expect(auditArgs[9]).toBe('api.example.com');
    expect(auditArgs[10]).toBe('unit-test');
  });
});
