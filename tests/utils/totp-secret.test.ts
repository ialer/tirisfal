import { describe, expect, it } from 'vitest';

import {
  decryptTotpSecret,
  encryptTotpSecret,
  isLegacyPlaintextTotpSecret,
} from '../../src/utils/totp-secret';

const BASE_ENV = { ENCRYPTION_KEY: 'unit-encryption-key-for-totp-tests' } as const;
const WITH_DEDICATED = { ...BASE_ENV, TOTP_SECRET: 'unit-totp-dedicated-key' } as const;

describe('TOTP 密钥落库加密', () => {
  it('加密后带 v3 前缀，且可还原', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const stored = await encryptTotpSecret(BASE_ENV, secret);
    expect(stored.startsWith('v3:')).toBe(true);
    expect(stored).not.toContain(secret);
    await expect(decryptTotpSecret(BASE_ENV, stored)).resolves.toBe(secret);
  });

  it('存量明文原样返回并标记为 legacy', async () => {
    const legacy = 'JBSWY3DPEHPK3PXP';
    expect(isLegacyPlaintextTotpSecret(legacy)).toBe(true);
    await expect(decryptTotpSecret(BASE_ENV, legacy)).resolves.toBe(legacy);
  });

  it('密文不标记为 legacy', async () => {
    const stored = await encryptTotpSecret(BASE_ENV, 'JBSWY3DPEHPK3PXP');
    expect(isLegacyPlaintextTotpSecret(stored)).toBe(false);
  });

  it('TOTP_SECRET 优先：换环境解不开', async () => {
    const stored = await encryptTotpSecret(WITH_DEDICATED, 'JBSWY3DPEHPK3PXP');
    await expect(decryptTotpSecret(WITH_DEDICATED, stored)).resolves.toBe('JBSWY3DPEHPK3PXP');
    await expect(decryptTotpSecret(BASE_ENV, stored)).rejects.toThrow();
  });

  it('空值不加密、不解密', async () => {
    expect(await encryptTotpSecret(BASE_ENV, '')).toBe('');
    await expect(decryptTotpSecret(BASE_ENV, null)).resolves.toBeNull();
    await expect(decryptTotpSecret(BASE_ENV, '')).resolves.toBeNull();
  });
});
