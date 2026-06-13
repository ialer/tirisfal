/**
 * 将字节数组转换为 Base64 URL 编码字符串
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * 将 Base64 URL 编码字符串转换为字节数组
 */
export function base64UrlToBytes(input: string): Uint8Array {
  const normalized = String(input || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * 生成随机挑战值（Base64 URL 编码）
 * @param size - 随机字节数，默认 32
 */
export function randomChallenge(size: number = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

/**
 * 解析客户端数据 JSON
 * @param base64Url - Base64 URL 编码的客户端数据
 * @returns 解析后的对象，无效则返回 null
 */
export function parseClientDataJSON(
  base64Url: string
): { type?: string; challenge?: string; origin?: string } | null {
  try {
    const raw = base64UrlToBytes(base64Url);
    const text = new TextDecoder().decode(raw);
    const parsed = JSON.parse(text) as { type?: string; challenge?: string; origin?: string };
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}
