import { describe, expect, it } from 'vitest';

import type { BackupSettings } from '../../shared/backup-schema';
import {
  assertPortableEncryptionAvailable,
  backupSettingsHasCredentials,
} from '../../src/services/backup-config';

function settingsWith(destination: Record<string, unknown>): BackupSettings {
  return {
    destinations: [
      {
        id: 'd1',
        name: 's3',
        type: destination.type as 's3',
        includeAttachments: false,
        destination,
        schedule: {
          enabled: false,
          intervalHours: 24,
          startTime: '03:00',
          timezone: 'UTC',
          retentionCount: 30,
        },
        runtime: {
          lastAttemptAt: null,
          lastAttemptLocalDate: null,
          lastSuccessAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
          lastUploadedFileName: null,
          lastUploadedSizeBytes: null,
          lastUploadedDestination: null,
        },
      },
    ],
  } as BackupSettings;
}

const s3 = settingsWith({
  type: 's3',
  endpoint: 'https://s3.example.com',
  bucket: 'b',
  region: 'auto',
  accessKeyId: 'AKIA',
  secretAccessKey: 'SECRET',
  rootPath: 'tirisfal',
});

describe('备份设置：无管理员公钥时 fail-closed', () => {
  it('识别含凭据的目的地', () => {
    expect(backupSettingsHasCredentials(s3)).toBe(true);
    expect(backupSettingsHasCredentials({ destinations: [] })).toBe(false);
  });

  it('没有管理员公钥且有凭据 → 拒绝落库', () => {
    expect(() => assertPortableEncryptionAvailable(s3, false)).toThrow(/管理员公钥/);
  });

  it('有管理员公钥时允许保存', () => {
    expect(() => assertPortableEncryptionAvailable(s3, true)).not.toThrow();
  });

  it('无凭据的空设置允许明文保存（只有时间表）', () => {
    expect(() => assertPortableEncryptionAvailable({ destinations: [] }, false)).not.toThrow();
  });
});
