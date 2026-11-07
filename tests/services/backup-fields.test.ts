import { describe, expect, it } from 'vitest';

import {
  sanitizeUserRowsForExport,
  SENSITIVE_USER_FIELDS,
} from '../../src/services/backup-archive';
import { assertRequiredColumns, USER_REQUIRED_COLUMNS } from '../../src/services/backup-import';

const row = {
  id: 'u1',
  email: 'u@example.com',
  name: 'U',
  master_password_hash: '$s$abc$def',
  key: '2.aaaa|bbbb',
  private_key: '2.cccc|dddd',
  public_key: 'pk',
  kdf_type: 0,
  kdf_iterations: 600000,
  security_stamp: 'stamp',
  role: 'user',
  status: 'active',
  verify_devices: 1,
  totp_secret: 'TOTPSECRET',
  totp_recovery_code: 'RECOVERY',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('备份 round-trip 字段契约', () => {
  it('导出保留 NOT NULL 的 master hash（否则恢复必然失败）', () => {
    const [sanitized] = sanitizeUserRowsForExport([{ ...row }]);
    expect(sanitized.master_password_hash).toBe(row.master_password_hash);
  });

  it('仍然剥离 2FA 与密钥类敏感字段', () => {
    const [sanitized] = sanitizeUserRowsForExport([{ ...row }]);
    expect(sanitized.totp_secret).toBeUndefined();
    expect(sanitized.totp_recovery_code).toBeUndefined();
    expect(sanitized.private_key).toBeUndefined();
    expect(SENSITIVE_USER_FIELDS).not.toContain('master_password_hash');
  });

  it('导出后的行满足 users 表的 NOT NULL 约束', () => {
    const [sanitized] = sanitizeUserRowsForExport([{ ...row }]);
    expect(() => assertRequiredColumns('users', [sanitized], USER_REQUIRED_COLUMNS)).not.toThrow();
  });

  it('缺列时给出可读错误，而不是 SQLite constraint failed', () => {
    const broken = { ...row } as Record<string, unknown>;
    delete broken.master_password_hash;
    expect(() => assertRequiredColumns('users', [broken], USER_REQUIRED_COLUMNS)).toThrow(
      /missing required columns: master_password_hash/
    );
  });
});
