import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockService = {
  validateProjectAccess: vi.fn(),
  createAgentProposal: vi.fn(),
  listAgentProposals: vi.fn(),
  getAgentProposal: vi.fn(),
  deleteAgentProposal: vi.fn(),
};

vi.mock('../../src/services/sm-service', () => ({
  SecretsManagerService: class {
    constructor() {
      return mockService;
    }
  },
}));

import { handleAgentProposals } from '../../src/handlers/agent-proposals';

const ENV = {
  ENCRYPTION_KEY: 'test-encryption-key',
  DB: {
    prepare: () => ({ bind: () => ({ run: () => Promise.resolve({}) }) }),
  },
} as never;
const USER = 'user-1';
const MA = 'ma-1';

function call(
  method: string,
  path: string,
  body?: unknown,
  ctx: { userId: string; machineAccountId?: string } = { userId: USER }
) {
  const req = new Request('https://vault.example.com' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleAgentProposals(req, ENV, path, method, ctx);
}

describe('Agent 提议入库', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.validateProjectAccess.mockResolvedValue({ allowed: true });
    mockService.createAgentProposal.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      expires_at: '2026-11-20T00:00:00Z',
    });
    mockService.listAgentProposals.mockResolvedValue([]);
    mockService.getAgentProposal.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'DB',
      value: 's3cret',
      note: null,
      project_id: '22222222-2222-4222-8222-222222222222',
    });
    mockService.deleteAgentProposal.mockResolvedValue(true);
  });

  it('机器账号提交需要项目 write 授权', async () => {
    mockService.validateProjectAccess.mockResolvedValue({
      allowed: false,
      reason: 'Write permission required',
    });
    const resp = await call(
      'POST',
      '/api/agent-proposals',
      { project_id: '22222222-2222-4222-8222-222222222222', name: 'DB', value: 's3cret' },
      { userId: USER, machineAccountId: MA }
    );
    expect(resp.status).toBe(403);
    expect(mockService.validateProjectAccess).toHaveBeenCalledWith(
      MA,
      '22222222-2222-4222-8222-222222222222',
      undefined,
      'write'
    );
  });

  it('机器账号提交成功返回 201 与过期时间', async () => {
    const resp = await call(
      'POST',
      '/api/agent-proposals',
      { project_id: '22222222-2222-4222-8222-222222222222', name: 'DB', value: 's3cret' },
      { userId: USER, machineAccountId: MA }
    );
    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body).toMatchObject({ success: true, id: '11111111-1111-4111-8111-111111111111' });
    expect(mockService.createAgentProposal).toHaveBeenCalled();
  });

  it('用户 token 不能提交提议', async () => {
    const resp = await call('POST', '/api/agent-proposals', {
      project_id: '22222222-2222-4222-8222-222222222222',
      name: 'DB',
      value: 'x',
    });
    expect(resp.status).toBe(403);
  });

  it('机器账号不能列举待确认条目', async () => {
    const resp = await call('GET', '/api/agent-proposals', undefined, {
      userId: USER,
      machineAccountId: MA,
    });
    expect(resp.status).toBe(403);
  });

  it('用户可列出待确认条目（不含明文）', async () => {
    mockService.listAgentProposals.mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111', name: 'DB' },
    ]);
    const resp = await call('GET', '/api/agent-proposals');
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('"value"');
  });

  it('用户可读取单条明文', async () => {
    const resp = await call('GET', '/api/agent-proposals/11111111-1111-4111-8111-111111111111');
    expect(resp.status).toBe(200);
    expect((await resp.json()).value).toBe('s3cret');
  });

  it('机器账号不能读取待确认明文', async () => {
    const resp = await call(
      'GET',
      '/api/agent-proposals/11111111-1111-4111-8111-111111111111',
      undefined,
      { userId: USER, machineAccountId: MA }
    );
    expect(resp.status).toBe(403);
  });

  it('删除不存在返回 404', async () => {
    mockService.deleteAgentProposal.mockResolvedValue(false);
    const resp = await call('DELETE', '/api/agent-proposals/11111111-1111-4111-8111-111111111111');
    expect(resp.status).toBe(404);
  });
});
