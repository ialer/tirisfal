import { describe, expect, it, vi } from 'vitest';

import {
  decrypt,
  decryptFast,
  encrypt,
  encryptFast,
  FAST_FORMAT_PREFIX,
  generateKey,
  isLegacyCiphertext,
  V3_FORMAT_PREFIX,
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

describe('Crypto Fast Path (v3, 每条密文独立 salt)', () => {
  const testKey = generateKey();

  it('should round-trip data with the v3 fast format', async () => {
    const plaintext = 'fast-path-secret-值-🔐';
    const encrypted = await encryptFast(plaintext, testKey);
    expect(encrypted.startsWith(V3_FORMAT_PREFIX)).toBe(true);
    const decrypted = await decryptFast(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV + salt)', async () => {
    const encrypted1 = await encryptFast('same-value', testKey);
    const encrypted2 = await encryptFast('same-value', testKey);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('每次加密的 HKDF salt 不同（派生密钥不跨记录复用）', async () => {
    const strip = (s: string) => s.slice(V3_FORMAT_PREFIX.length);
    const a = Uint8Array.from(atob(strip(await encryptFast('same', testKey))), (c) =>
      c.charCodeAt(0)
    );
    const b = Uint8Array.from(atob(strip(await encryptFast('same', testKey))), (c) =>
      c.charCodeAt(0)
    );
    // 前缀 16 字节为 salt
    expect(Array.from(a.slice(0, 16))).not.toEqual(Array.from(b.slice(0, 16)));
  });

  it('should decrypt legacy v2 ciphertext via decryptFast', async () => {
    // 真实存量样本：固定 HKDF salt 的 v2 密文（masterKey = fixture-master-key-v2）
    const legacyV2 = 'v2:oimxnRQpncRjO3JEaqZZm8p2z9SovXX/C9Y4GQCF/0La6NPqp402Y07QrmFcrQ==';
    await expect(decryptFast(legacyV2, 'fixture-master-key-v2')).resolves.toBe(
      'legacy-v2-value-42'
    );
  });

  it('should decrypt legacy PBKDF2 ciphertext via decryptFast', async () => {
    // 存量数据：旧 encrypt() 产出的 base64(salt+iv+tag+ct)，无 v2/v3 前缀
    const legacyEncrypted = await encrypt('legacy-data', testKey);
    expect(legacyEncrypted.startsWith(FAST_FORMAT_PREFIX)).toBe(false);
    await expect(decryptFast(legacyEncrypted, testKey)).resolves.toBe('legacy-data');
  });

  it('should fail to decrypt v3 ciphertext with wrong key', async () => {
    const encrypted = await encryptFast('secret', testKey);
    const wrongKey = generateKey();
    await expect(decryptFast(encrypted, wrongKey)).rejects.toThrow();
    // 同一错误密钥连续解密（v3 不缓存密钥，仍必须失败）
    await expect(decryptFast(encrypted, wrongKey)).rejects.toThrow();
  });

  it('should not cross-decrypt between fast and legacy formats under same key', async () => {
    const plaintext = 'format-boundary';
    const fastEncrypted = await encryptFast(plaintext, testKey);
    // 旧 decrypt() 不识别 v3 前缀，应失败而不是返回明文
    await expect(decrypt(fastEncrypted, testKey)).rejects.toThrow();
    // 新 decryptFast() 可读旧格式
    await expect(decrypt(await encrypt(plaintext, testKey), testKey)).resolves.toBe(plaintext);
  });

  it('识别存量密文以便读取时透明升级', async () => {
    expect(isLegacyCiphertext('v2:abc')).toBe(true);
    expect(isLegacyCiphertext(btoa('legacy'))).toBe(true);
    expect(isLegacyCiphertext(await encryptFast('x', testKey))).toBe(false);
  });

  it('派生密钥失败后可重试（失败结果不进入缓存）', async () => {
    const key = `test-cache-poison-${Date.now()}`;
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    spy.mockRejectedValueOnce(new Error('derive-boom'));
    await expect(encryptFast('x', key)).rejects.toThrow('derive-boom');
    spy.mockRestore();

    const enc = await encryptFast('x', key);
    expect(enc.startsWith(V3_FORMAT_PREFIX)).toBe(true);
  });
});
