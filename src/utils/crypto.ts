/**
 * 加密工具模块
 * 使用 AES-256-GCM 加密敏感数据
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

/**
 * 字节数组转 base64（分块转换，避免大数组触发 String.fromCharCode.apply 栈溢出）
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

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

// ---------------------------------------------------------------------------
// 快速路径（v2）：HKDF 派生 + 模块级密钥缓存，避免每次调用都跑 PBKDF2-100k。
// ---------------------------------------------------------------------------

/** v2 格式版本前缀（自识别格式，旧格式自动走 PBKDF2 兼容路径） */
export const FAST_FORMAT_PREFIX = 'v2:';
const HKDF_SALT = 'tirisfal-value-v2';
const HKDF_INFO = 'tirisfal-value-v2';
const DERIVED_KEY_CACHE_MAX_SIZE = 100;

/**
 * 按 masterKey 缓存 HKDF 派生的 AES-256-GCM CryptoKey
 * （参考 jwt.ts 的 hmacKeyCache 模式，超过上限时按插入序淘汰最旧条目）。
 */
const derivedKeyCache = new Map<string, Promise<CryptoKey>>();

/**
 * 用 HKDF-SHA-256 从主密钥派生 AES-256-GCM 密钥并缓存。
 * 主密钥本身已是高熵随机密钥（见 generateKey），HKDF 足够且无需昂贵 KDF。
 */
function getDerivedKey(masterKey: string): Promise<CryptoKey> {
  let cached = derivedKeyCache.get(masterKey);
  if (cached) return cached;

  if (derivedKeyCache.size >= DERIVED_KEY_CACHE_MAX_SIZE) {
    const firstKey = derivedKeyCache.keys().next().value;
    if (firstKey !== undefined) {
      derivedKeyCache.delete(firstKey);
    }
  }

  const encoder = new TextEncoder();
  cached = (async () => {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(masterKey),
      'HKDF',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode(HKDF_SALT),
        info: encoder.encode(HKDF_INFO),
      },
      keyMaterial,
      KEY_LENGTH
    );
    return crypto.subtle.importKey('raw', bits, { name: ALGORITHM }, false, ['encrypt', 'decrypt']);
  })();

  // 安全：失败的派生不能留在缓存里——被拒绝的 Promise 会被后续所有请求复用，
  // 导致同一 isolate 内加解密持续失败直到实例回收。
  cached = cached.catch((error) => {
    derivedKeyCache.delete(masterKey);
    throw error;
  });

  derivedKeyCache.set(masterKey, cached);
  return cached;
}

/**
 * 快速加密数据（v2 格式）
 * 返回格式: "v2:" + base64(iv + tag + ciphertext)，每次调用仍使用随机 IV
 */
export async function encryptFast(plaintext: string, masterKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await getDerivedKey(masterKey);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as unknown as BufferSource, tagLength: TAG_LENGTH },
    key,
    new TextEncoder().encode(plaintext)
  );

  const encryptedArray = new Uint8Array(encrypted);
  const result = new Uint8Array(iv.length + encryptedArray.length);
  result.set(iv, 0);
  result.set(encryptedArray, iv.length);

  return FAST_FORMAT_PREFIX + bytesToBase64(result);
}

/**
 * 快速解密数据（自识别格式）
 * - 带 v2 前缀：走缓存的 HKDF 派生密钥路径
 * - 无前缀的存量密文：自动回退旧 PBKDF2 路径（无需数据迁移）
 */
export async function decryptFast(encryptedData: string, masterKey: string): Promise<string> {
  if (!encryptedData.startsWith(FAST_FORMAT_PREFIX)) {
    return decrypt(encryptedData, masterKey);
  }

  const raw = encryptedData.slice(FAST_FORMAT_PREFIX.length);
  const data = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  const key = await getDerivedKey(masterKey);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as unknown as BufferSource, tagLength: TAG_LENGTH },
    key,
    ciphertext as unknown as BufferSource
  );

  return new TextDecoder().decode(decrypted);
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

  return bytesToBase64(result);
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
  return bytesToBase64(bytes);
}
