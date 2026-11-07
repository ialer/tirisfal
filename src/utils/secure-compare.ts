/**
 * 常量时间比较（防时序侧信道）。
 *
 * 两处历史实现（identity 的 API key 比对 / auth 的口令哈希比对）逐字节相同，
 * 收敛到这里，避免「改一处漏一处」。
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const encA = new TextEncoder().encode(a);
  const encB = new TextEncoder().encode(b);

  // 用较长者作为循环上界，缺失字节按 0 补齐，避免长度差异提前返回
  const maxLength = Math.max(encA.length, encB.length);
  let diff = 0;
  for (let i = 0; i < maxLength; i += 1) {
    const byteA = i < encA.length ? encA[i] : 0;
    const byteB = i < encB.length ? encB[i] : 0;
    diff |= byteA ^ byteB;
  }

  // 长度不同必须判否（避免 "abc" 与 "abc\0" 被判相等）
  diff |= encA.length ^ encB.length;
  return diff === 0;
}
