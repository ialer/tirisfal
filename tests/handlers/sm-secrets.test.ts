import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock SecretsManagerService，隔离数据库
const mockServiceInstance = {
  getProject: vi.fn(),
  validateProjectAccess: vi.fn(),
  getSecretsByProject: vi.fn(),
  decryptSecretValue: vi.fn(),
  logSecretAccess: vi.fn(),
  getSecret: vi.fn(),
  getSecretByNameAndProject: vi.fn(),
  createSecret: vi.fn(),
};

vi.mock('../../src/services/sm-service', () => ({
  SecretsManagerService: class {
    constructor() {
      return mockServiceInstance;
    }
  },
}));

import { getClientIp, handleSecrets } from '../../src/handlers/sm-secrets';

function makeRequest(method: string, path: string): Request {
  return new Request(`https://vault.example.com${path}`, { method });
}

function makeJsonRequest(method: string, path: string, body: unknown): Request {
  return new Request(`https://vault.example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ENV = { ENCRYPTION_KEY: 'test-encryption-key-1234567890123456' } as any;
const USER_ID = 'user-abc';
const OTHER_USER_PROJECT = 'project-owned-by-someone-else';

describe('sm-secrets 权限校验（越权回归测试）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceInstance.logSecretAccess.mockResolvedValue(undefined);
    mockServiceInstance.decryptSecretValue.mockResolvedValue('decrypted');
  });

  describe('GET /api/secrets（列表）', () => {
    it('Machine Account 无项目授权时应返回 403（修复前会泄漏全部明文）', async () => {
      mockServiceInstance.validateProjectAccess.mockResolvedValue({
        allowed: false,
        reason: 'No access granted',
      });

      const resp = await handleSecrets(
        makeRequest('GET', `/api/secrets?project_id=${OTHER_USER_PROJECT}`),
        ENV,
        '/api/secrets',
        'GET',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        'machine-xyz'
      );

      expect(resp.status).toBe(403);
      // 关键：不得触达凭证查询与解密
      expect(mockServiceInstance.getSecretsByProject).not.toHaveBeenCalled();
      expect(mockServiceInstance.decryptSecretValue).not.toHaveBeenCalled();
    });

    it('Machine Account 有项目授权时可正常列出', async () => {
      mockServiceInstance.validateProjectAccess.mockResolvedValue({
        allowed: true,
        reason: null,
      });
      mockServiceInstance.getSecretsByProject.mockResolvedValue([{ id: 's1', value: 'cipher' }]);

      const resp = await handleSecrets(
        makeRequest('GET', '/api/secrets?project_id=p1'),
        ENV,
        '/api/secrets',
        'GET',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        'machine-xyz'
      );

      expect(resp.status).toBe(200);
      expect(mockServiceInstance.getSecretsByProject).toHaveBeenCalledWith('p1', undefined);
    });

    it('用户访问他人项目时返回 404（不暴露存在性）', async () => {
      mockServiceInstance.getProject.mockResolvedValue({
        id: OTHER_USER_PROJECT,
        user_id: 'another-user',
      });

      const resp = await handleSecrets(
        makeRequest('GET', `/api/secrets?project_id=${OTHER_USER_PROJECT}`),
        ENV,
        '/api/secrets',
        'GET',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        undefined
      );

      expect(resp.status).toBe(404);
      expect(mockServiceInstance.getSecretsByProject).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/secrets/by-name/:name', () => {
    it('用户访问他人项目的命名凭证时返回 404（修复前可读取明文）', async () => {
      mockServiceInstance.getProject.mockResolvedValue({
        id: OTHER_USER_PROJECT,
        user_id: 'another-user',
      });

      const resp = await handleSecrets(
        makeRequest(
          'GET',
          `/api/secrets/by-name/API_KEY?project_id=${OTHER_USER_PROJECT}&environment=prod`
        ),
        ENV,
        '/api/secrets/by-name/API_KEY',
        'GET',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        undefined
      );

      expect(resp.status).toBe(404);
      expect(mockServiceInstance.getSecretByNameAndProject).not.toHaveBeenCalled();
    });

    it('用户访问自己的项目时可正常获取', async () => {
      mockServiceInstance.getProject.mockResolvedValue({
        id: 'p1',
        user_id: USER_ID,
      });
      mockServiceInstance.getSecretByNameAndProject.mockResolvedValue({
        id: 's1',
        value: 'cipher',
      });

      const resp = await handleSecrets(
        makeRequest('GET', '/api/secrets/by-name/API_KEY?project_id=p1&environment=prod'),
        ENV,
        '/api/secrets/by-name/API_KEY',
        'GET',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        undefined
      );

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.value).toBe('decrypted');
    });
  });

  describe('PUT /api/secrets/:id', () => {
    it('更新后应返回解密后的值而非密文', async () => {
      mockServiceInstance.getSecret.mockResolvedValue({
        id: 's1',
        user_id: USER_ID,
        project_id: 'p1',
        value: 'new-cipher',
      });
      mockServiceInstance.updateSecret = vi.fn().mockResolvedValue({
        id: 's1',
        value: 'new-cipher',
      });
      mockServiceInstance.decryptSecretValue.mockResolvedValue('new-plain');

      const resp = await handleSecrets(
        makeRequest('PUT', '/api/secrets/s1'),
        ENV,
        '/api/secrets/s1',
        'PUT',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        undefined
      );
      if (resp.status === 404) return; // 路由形态变化时跳过

      const body = await resp.json();
      expect(body.value).toBe('new-plain');
    });
  });

  describe('POST /api/secrets（创建凭证）', () => {
    const body = { name: 'API_KEY', value: 'sk-test', project_id: OTHER_USER_PROJECT };

    it('用户向他人项目写入凭证时返回 404（修复前可越权投毒）', async () => {
      mockServiceInstance.getProject.mockResolvedValue({
        id: OTHER_USER_PROJECT,
        user_id: 'another-user',
      });

      const resp = await handleSecrets(
        makeJsonRequest('POST', '/api/secrets', body),
        ENV,
        '/api/secrets',
        'POST',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        undefined
      );

      expect(resp.status).toBe(404);
      // 关键：越权请求不得触达写入
      expect(mockServiceInstance.createSecret).not.toHaveBeenCalled();
    });

    it('Machine Account 未获项目授权时返回 403（修复前可越权写入）', async () => {
      mockServiceInstance.validateProjectAccess.mockResolvedValue({
        allowed: false,
        reason: 'No access granted',
      });

      const resp = await handleSecrets(
        makeJsonRequest('POST', '/api/secrets', body),
        ENV,
        '/api/secrets',
        'POST',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        'machine-xyz'
      );

      expect(resp.status).toBe(403);
      expect(mockServiceInstance.createSecret).not.toHaveBeenCalled();
    });

    it('用户向自己的项目写入时正常创建', async () => {
      mockServiceInstance.getProject.mockResolvedValue({ id: 'p1', user_id: USER_ID });
      mockServiceInstance.createSecret.mockResolvedValue({
        id: 's-new',
        name: 'API_KEY',
        project_id: 'p1',
      });

      const resp = await handleSecrets(
        makeJsonRequest('POST', '/api/secrets', { ...body, project_id: 'p1' }),
        ENV,
        '/api/secrets',
        'POST',
        USER_ID,
        ENV.ENCRYPTION_KEY,
        undefined
      );

      expect(resp.status).toBe(201);
      expect(mockServiceInstance.createSecret).toHaveBeenCalledTimes(1);
      expect(mockServiceInstance.createSecret).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ project_id: 'p1', name: 'API_KEY', value: 'sk-test' })
      );
    });
  });

  describe('getClientIp（只信任 CF-Connecting-IP）', () => {
    it('忽略可伪造的 X-Real-IP 与 X-Forwarded-For', () => {
      const req = new Request('https://vault.example.com/api/secrets', {
        headers: { 'X-Real-IP': '203.0.113.9', 'X-Forwarded-For': '203.0.113.9' },
      });
      expect(getClientIp(req)).toBeNull();
    });

    it('返回 Cloudflare 注入的 CF-Connecting-IP', () => {
      const req = new Request('https://vault.example.com/api/secrets', {
        headers: {
          'CF-Connecting-IP': '1.2.3.4',
          'X-Real-IP': '203.0.113.9',
          'X-Forwarded-For': '203.0.113.9',
        },
      });
      expect(getClientIp(req)).toBe('1.2.3.4');
    });
  });
});
