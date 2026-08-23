import { describe, expect, it } from 'vitest';

import {
  decrypt,
  decryptFast,
  encrypt,
  encryptFast,
  FAST_FORMAT_PREFIX,
  generateKey,
} from '../../src/utils/crypto';

describe('Crypto Utils', () => {
  const testKey = generateKey();

  it('should encrypt and decrypt data correctly', async () => {
    const plaintext = 'test-secret-value-12345';
    const encrypted = await encrypt(plaintext, testKey);
    const decrypted = await decrypt(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext', async () => {
    const plaintext = 'same-value';
    const encrypted1 = await encrypt(plaintext, testKey);
    const encrypted2 = await encrypt(plaintext, testKey);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should fail to decrypt with wrong key', async () => {
    const plaintext = 'secret';
    const encrypted = await encrypt(plaintext, testKey);
    const wrongKey = generateKey();
    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
  });

  it('should generate valid random key', () => {
    const key = generateKey();
    expect(key).toBeDefined();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});

describe('Crypto Fast Path (v2, HKDF + cached key)', () => {
  const testKey = generateKey();

  it('should round-trip data with the v2 fast format', async () => {
    const plaintext = 'fast-path-secret-值-🔐';
    const encrypted = await encryptFast(plaintext, testKey);
    expect(encrypted.startsWith(FAST_FORMAT_PREFIX)).toBe(true);
    const decrypted = await decryptFast(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV)', async () => {
    const encrypted1 = await encryptFast('same-value', testKey);
    const encrypted2 = await encryptFast('same-value', testKey);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should decrypt legacy PBKDF2 ciphertext via decryptFast', async () => {
    // 存量数据：旧 encrypt() 产出的 base64(iv+tag+ct)，无 v2 前缀
    const legacyEncrypted = await encrypt('legacy-data', testKey);
    expect(legacyEncrypted.startsWith(FAST_FORMAT_PREFIX)).toBe(false);
    await expect(decryptFast(legacyEncrypted, testKey)).resolves.toBe('legacy-data');
  });

  it('should fail to decrypt v2 ciphertext with wrong key', async () => {
    const encrypted = await encryptFast('secret', testKey);
    const wrongKey = generateKey();
    await expect(decryptFast(encrypted, wrongKey)).rejects.toThrow();
  });

  it('should fail to decrypt v2 ciphertext with wrong key even after caching', async () => {
    // 同一错误密钥连续解密，覆盖缓存命中路径
    const encrypted = await encryptFast('secret', testKey);
    const wrongKey = generateKey();
    await expect(decryptFast(encrypted, wrongKey)).rejects.toThrow();
    await expect(decryptFast(encrypted, wrongKey)).rejects.toThrow();
  });

  it('should not cross-decrypt between fast and legacy formats under same key', async () => {
    const plaintext = 'format-boundary';
    const fastEncrypted = await encryptFast(plaintext, testKey);
    // 旧 decrypt() 不识别 v2 前缀，应失败而不是返回明文
    await expect(decrypt(fastEncrypted, testKey)).rejects.toThrow();
    // 新 decryptFast() 可读旧格式
    await expect(decrypt(await encrypt(plaintext, testKey), testKey)).resolves.toBe(plaintext);
  });
});
