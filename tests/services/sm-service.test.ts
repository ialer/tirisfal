import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecretsManagerService } from '../../src/services/sm-service';

// Mock D1Database
const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
};

describe('SecretsManagerService', () => {
  let service: SecretsManagerService;
  const testEncryptionKey = 'test-encryption-key-1234567890123456';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SecretsManagerService(mockDb as any, testEncryptionKey);
  });

  describe('constructor', () => {
    it('should throw error when encryption key is empty', () => {
      expect(() => new SecretsManagerService(mockDb as any, '')).toThrow('ENCRYPTION_KEY is required');
    });

    it('should throw error when encryption key is undefined', () => {
      expect(() => new SecretsManagerService(mockDb as any, undefined)).toThrow('ENCRYPTION_KEY is required');
    });

    it('should create service with valid key', () => {
      expect(() => new SecretsManagerService(mockDb as any, testEncryptionKey)).not.toThrow();
    });
  });

  describe('createMachineAccount', () => {
    it('should create machine account successfully', async () => {
      const mockAccount = {
        id: 'test-id',
        name: 'test-account',
        user_id: 'user-123',
        status: 'active',
        created_at: new Date().toISOString(),
      };

      mockDb.first.mockResolvedValue(mockAccount);

      const result = await service.createMachineAccount('user-123', {
        name: 'test-account',
      });

      expect(result.name).toBe('test-account');
    });
  });

  describe('validateProjectAccess', () => {
    it('should deny access when no record found', async () => {
      mockDb.first.mockResolvedValue(null);

      const result = await service.validateProjectAccess('machine-123', 'project-123');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('No access granted');
    });

    it('should deny access when expired', async () => {
      mockDb.first.mockResolvedValue({
        permission: 'read',
        allowed_ip: null,
        allowed_hours: null,
        max_requests_per_minute: null,
        expires_at: '2020-01-01T00:00:00.000Z',
      });

      const result = await service.validateProjectAccess('machine-123', 'project-123');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Access expired');
    });

    it('should allow access with valid record', async () => {
      mockDb.first.mockResolvedValue({
        permission: 'read',
        allowed_ip: null,
        allowed_hours: null,
        max_requests_per_minute: null,
        expires_at: null,
      });

      const result = await service.validateProjectAccess('machine-123', 'project-123');

      expect(result.allowed).toBe(true);
    });
  });

  describe('hasProjectAccess', () => {
    it('should return false when no record found', async () => {
      mockDb.first.mockResolvedValue(null);

      const result = await service.hasProjectAccess('machine-123', 'project-123');

      expect(result).toBe(false);
    });

    it('should return false when expired', async () => {
      mockDb.first.mockResolvedValue({
        expires_at: '2020-01-01T00:00:00.000Z',
        allowed_ip: null,
      });

      const result = await service.hasProjectAccess('machine-123', 'project-123');

      expect(result).toBe(false);
    });

    it('should return true with valid access', async () => {
      mockDb.first.mockResolvedValue({
        expires_at: null,
        allowed_ip: null,
      });

      const result = await service.hasProjectAccess('machine-123', 'project-123');

      expect(result).toBe(true);
    });
  });
});
