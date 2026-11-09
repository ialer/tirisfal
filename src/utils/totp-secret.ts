import type { Env } from '../types';
import { decryptFast, encryptFast, isLegacyCiphertext } from './crypto';

/**
 * TOTP 密钥的落库加密。
 *
 * - 优先使用独立的 TOTP_SECRET（与 ENCRYPTION_KEY 分离，便于单独轮换）；
 * - 未配置时回退 ENCRYPTION_KEY；
 * - 历史数据是明文 base32：读取时原样返回，登录验证成功后再透明升级为密文。
 */
function totpMasterKey(env: Pick<Env, 'TOTP_SECRET' | 'ENCRYPTION_KEY'>): string {
  const dedicated = (env.TOTP_SECRET || '').trim();
  return dedicated || env.ENCRYPTION_KEY;
}

/** 是否为历史明文（base32 字母表不含 ':'，与 v3 前缀不会冲突） */
export function isLegacyPlaintextTotpSecret(stored: string | null | undefined): boolean {
  return Boolean(stored) && isLegacyCiphertext(stored as string);
}

export async function encryptTotpSecret(
  env: Pick<Env, 'TOTP_SECRET' | 'ENCRYPTION_KEY'>,
  plaintext: string
): Promise<string> {
  if (!plaintext) return plaintext;
  return encryptFast(plaintext, totpMasterKey(env));
}

export async function decryptTotpSecret(
  env: Pick<Env, 'TOTP_SECRET' | 'ENCRYPTION_KEY'>,
  stored: string | null | undefined
): Promise<string | null> {
  if (!stored) return null;
  if (isLegacyCiphertext(stored)) return stored; // 存量明文，交给调用方在使用后升级
  return decryptFast(stored, totpMasterKey(env));
}
