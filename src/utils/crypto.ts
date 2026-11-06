/**
 * 加密工具模块
 * 使用 AES-256-GCM 加密敏感数据
 *
 * 密文格式（自识别，可长期共存）：
 *   v3:<base64(salt16 + iv12 + tag + ciphertext)>  —— 每次加密随机 salt，HKDF-SHA-256 派生
 *   v2:<base64(iv12 + tag + ciphertext)>           —— 历史快速格式，固定 HKDF salt（只读兼容）
 *   <base64(salt16 + iv12 + tag + ciphertext)>     —— 历史 PBKDF2-100k 格式（只读兼容）
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;
const SALT_LENGTH = 16;

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
 * 历史 PBKDF2 兼容路径（只读存量数据）。
 *
 * 迭代次数停在平台上限 100,000：Cloudflare Workers 的 Web Crypto 对 PBKDF2
 * 迭代次数有硬上限，调高会直接抛错。由于主密钥是高熵随机值（generateKey），
 * PBKDF2 在这里只承担「把字符串压成定长密钥」的作用，不是抗口令爆破的那一层；
 * 新写入的数据一律走 v3（HKDF + 每次随机 salt），并由读取路径透明升级存量。
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
// v2 兼容路径：固定 HKDF salt/info + 模块级密钥缓存。
// 仅用于读取历史密文（新写入已改为 v3），保留缓存以免存量读取回退到 PBKDF2。
// ---------------------------------------------------------------------------

/** v2 格式版本前缀（只读兼容） */
export const FAST_FORMAT_PREFIX = 'v2:';
const HKDF_SALT_V2 = 'tirisfal-value-v2';
const HKDF_INFO_V2 = 'tirisfal-value-v2';
const DERIVED_KEY_CACHE_MAX_SIZE = 100;

const derivedKeyCache = new Map<string, Promise<CryptoKey>>();

function getDerivedKeyV2(masterKey: string): Promise<CryptoKey> {
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
        salt: encoder.encode(HKDF_SALT_V2),
        info: encoder.encode(HKDF_INFO_V2),
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

// ---------------------------------------------------------------------------
// v3：每次加密随机 salt + 独立 info，密钥不跨记录复用，也不再需要缓存。
// ---------------------------------------------------------------------------

/** v3 格式版本前缀（当前写入格式） */
export const V3_FORMAT_PREFIX = 'v3:';
const HKDF_INFO_V3 = 'tirisfal-value-v3';

/**
 * 用 HKDF-SHA-256 从主密钥派生 AES-256-GCM 密钥。
 * salt 由调用方提供：v3 每次加密随机生成并随密文存储，因此派生结果逐条唯一；
 * 主密钥本身已是高熵随机值（见 generateKey），HKDF 足够且无需昂贵 KDF。
 */
async function deriveKeyV3(masterKey: string, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
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
      salt: salt as unknown as BufferSource,
      info: encoder.encode(info),
    },
    keyMaterial,
    KEY_LENGTH
  );
  return crypto.subtle.importKey('raw', bits, { name: ALGORITHM }, false, ['encrypt', 'decrypt']);
}

/** 密文是否为非 v3 的历史格式（读取路径据此触发透明升级） */
export function isLegacyCiphertext(encryptedData: string): boolean {
  return !encryptedData.startsWith(V3_FORMAT_PREFIX);
}

/**
 * 快速加密数据（v3 格式）
 * 返回格式: "v3:" + base64(salt + iv + tag + ciphertext)
 */
export async function encryptFast(plaintext: string, masterKey: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKeyV3(masterKey, salt, HKDF_INFO_V3);

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

  return V3_FORMAT_PREFIX + bytesToBase64(result);
}

/**
 * 快速解密数据（自识别格式）
 * - v3：用密文自带 salt 派生
 * - v2：走固定 salt 的兼容路径（带缓存）
 * - 无前缀：回退历史 PBKDF2 路径
 */
export async function decryptFast(encryptedData: string, masterKey: string): Promise<string> {
  if (encryptedData.startsWith(V3_FORMAT_PREFIX)) {
    const raw = encryptedData.slice(V3_FORMAT_PREFIX.length);
    const data = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

    const salt = data.slice(0, SALT_LENGTH);
    const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);

    const key = await deriveKeyV3(masterKey, salt, HKDF_INFO_V3);
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv as unknown as BufferSource, tagLength: TAG_LENGTH },
      key,
      ciphertext as unknown as BufferSource
    );
    return new TextDecoder().decode(decrypted);
  }

  if (!encryptedData.startsWith(FAST_FORMAT_PREFIX)) {
    return decrypt(encryptedData, masterKey);
  }

  const raw = encryptedData.slice(FAST_FORMAT_PREFIX.length);
  const data = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  const key = await getDerivedKeyV2(masterKey);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as unknown as BufferSource, tagLength: TAG_LENGTH },
    key,
    ciphertext as unknown as BufferSource
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * 加密数据
 * 返回格式: base64(salt + iv + tag + ciphertext)
 */
export async function encrypt(plaintext: string, masterKey: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
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
