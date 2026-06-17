/**
 * 加密工具模块
 * 使用 AES-256-GCM 加密敏感数据
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

/**
 * 从主密钥派生加密密钥
 */
async function deriveKey(masterKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterKey),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 加密数据
 * 返回格式: base64(iv + tag + ciphertext)
 */
export async function encrypt(plaintext: string, masterKey: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(masterKey, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as unknown as BufferSource, tagLength: TAG_LENGTH },
    key,
    new TextEncoder().encode(plaintext)
  );

  const encryptedArray = new Uint8Array(encrypted);
  const result = new Uint8Array(salt.length + iv.length + encryptedArray.length);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(encryptedArray, salt.length + iv.length);

  return btoa(String.fromCharCode.apply(null, Array.from(result)));
}

/**
 * 解密数据
 * 输入格式: base64(iv + tag + ciphertext)
 */
export async function decrypt(encryptedData: string, masterKey: string): Promise<string> {
  const data = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));

  const salt = data.slice(0, 16);
  const iv = data.slice(16, 16 + IV_LENGTH);
  const ciphertext = data.slice(16 + IV_LENGTH);

  const key = await deriveKey(masterKey, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as unknown as BufferSource, tagLength: TAG_LENGTH },
    key,
    ciphertext as unknown as BufferSource
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * 生成随机密钥
 */
export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
}
