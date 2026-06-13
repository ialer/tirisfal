/** 恢复码字符表（Base32） */
const RECOVERY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET_LENGTH = RECOVERY_ALPHABET.length;
/** 无偏最大字节值，用于消除取模偏差 */
const RECOVERY_MAX_UNBIASED_BYTE =
  Math.floor(256 / RECOVERY_ALPHABET_LENGTH) * RECOVERY_ALPHABET_LENGTH;

/** 标准化恢复码：大写并移除非 Base32 字符 */
function normalizeRecoveryCode(raw: string): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
}

/** 格式化恢复码：每 4 个字符加一个空格 */
function formatRecoveryCode(compact: string): string {
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * 生成 32 位恢复码
 * @returns 格式化的恢复码字符串（如 "ABCD EFGH IJKL ..."）
 */
export function createRecoveryCode(): string {
  let compact = '';
  while (compact.length < 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    for (const b of bytes) {
      if (b >= RECOVERY_MAX_UNBIASED_BYTE) continue;
      compact += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET_LENGTH];
      if (compact.length >= 32) break;
    }
  }
  return formatRecoveryCode(compact.slice(0, 32));
}

/**
 * 恢复码常量时间比较，防止时序攻击
 * @param input - 用户输入的恢复码
 * @param storedCode - 存储的恢复码
 * @returns 是否匹配
 */
export function recoveryCodeEquals(input: string, storedCode: string | null | undefined): boolean {
  if (!storedCode) return false;
  const a = new TextEncoder().encode(normalizeRecoveryCode(input));
  const b = new TextEncoder().encode(normalizeRecoveryCode(storedCode));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
