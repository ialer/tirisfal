import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateKey } from '../../src/utils/crypto';

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
