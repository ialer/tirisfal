import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockService = {
  getMachineAccount: vi.fn(),
  getProject: vi.fn(),
  grantProjectAccess: vi.fn(),
  revokeProjectAccess: vi.fn(),
  getProjectAccess: vi.fn(),
};

vi.mock('../../src/services/sm-service', () => ({
  SecretsManagerService: class {
    constructor() {
      return mockService;
    }
  },
}));

import { handleMachineAccounts } from '../../src/handlers/sm-machine-accounts';

const ENV = { ENCRYPTION_KEY: 'test-encryption-key-32-bytes-long-xx' } as any;
const USER_ID = 'user-1';
const ACCOUNT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

function req(method: string, path: string, body?: unknown): Request {
  return new Request('https://vault.example.com' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('machine account 项目授权（补齐产品缺口）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.getMachineAccount.mockResolvedValue({ id: ACCOUNT_ID, user_id: USER_ID });
    mockService.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: USER_ID });
    mockService.grantProjectAccess.mockResolvedValue(undefined);
    mockService.revokeProjectAccess.mockResolvedValue(true);
    mockService.getProjectAccess.mockResolvedValue([
      { project_id: PROJECT_ID, permission: 'read' },
    ]);
  });

  const path = '/api/machine-accounts/' + ACCOUNT_ID + '/projects/' + PROJECT_ID;

  it('POST 授权成功返回 201，并把 permission 传给 service', async () => {
    const resp = await handleMachineAccounts(
      req('POST', path, {
        permission: 'read',
        allowed_ip: ['1.2.3.4'],
        allowed_hosts: ['api.example.com'],
      }),
      ENV,
      path,
      'POST',
      USER_ID
    );
    expect(resp.status).toBe(201);
    expect(mockService.grantProjectAccess).toHaveBeenCalledWith(
      ACCOUNT_ID,
      PROJECT_ID,
      'read',
      expect.objectContaining({
        allowed_ip: ['1.2.3.4'],
        allowed_hosts: ['api.example.com'],
        mode: 'inject',
      })
    );
  });

  it('inject 模式缺少 allowed_hosts 返回 400', async () => {
    const resp = await handleMachineAccounts(
      req('POST', path, { permission: 'read' }),
      ENV,
      path,
      'POST',
      USER_ID
    );
    expect(resp.status).toBe(400);
    expect(mockService.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('reveal 模式可不配 allowed_hosts', async () => {
    const resp = await handleMachineAccounts(
      req('POST', path, { permission: 'read', mode: 'reveal' }),
      ENV,
      path,
      'POST',
      USER_ID
    );
    expect(resp.status).toBe(201);
  });

  it('他人的机器账号返回 404（不暴露存在性）', async () => {
    mockService.getMachineAccount.mockResolvedValue({ id: ACCOUNT_ID, user_id: 'other' });
    const resp = await handleMachineAccounts(req('POST', path, {}), ENV, path, 'POST', USER_ID);
    expect(resp.status).toBe(404);
    expect(mockService.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('他人的项目返回 404', async () => {
    mockService.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: 'other' });
    const resp = await handleMachineAccounts(req('POST', path, {}), ENV, path, 'POST', USER_ID);
    expect(resp.status).toBe(404);
    expect(mockService.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('非法 permission 返回 400', async () => {
    const resp = await handleMachineAccounts(
      req('POST', path, { permission: 'root' }),
      ENV,
      path,
      'POST',
      USER_ID
    );
    expect(resp.status).toBe(400);
    expect(mockService.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('非法 allowed_hours 返回 400', async () => {
    const resp = await handleMachineAccounts(
      req('POST', path, { allowed_hours: { start: 22, end: 3 } }),
      ENV,
      path,
      'POST',
      USER_ID
    );
    expect(resp.status).toBe(400);
  });

  it('DELETE 撤销授权返回 200', async () => {
    const resp = await handleMachineAccounts(req('DELETE', path), ENV, path, 'DELETE', USER_ID);
    expect(resp.status).toBe(200);
    expect(mockService.revokeProjectAccess).toHaveBeenCalledWith(ACCOUNT_ID, PROJECT_ID);
  });

  it('GET 列出已授权项目', async () => {
    const listPath = '/api/machine-accounts/' + ACCOUNT_ID + '/projects';
    const resp = await handleMachineAccounts(req('GET', listPath), ENV, listPath, 'GET', USER_ID);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data).toHaveLength(1);
  });
});
