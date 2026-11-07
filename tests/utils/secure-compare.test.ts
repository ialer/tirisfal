import { describe, expect, it } from 'vitest';

import { constantTimeEquals } from '../../src/utils/secure-compare';

describe('constant time compare', () => {
  it('相同字符串相等', () => {
    expect(constantTimeEquals('secret-token', 'secret-token')).toBe(true);
  });

  it('不同内容不相等', () => {
    expect(constantTimeEquals('secret-token', 'secret-tokeN')).toBe(false);
  });

  it('长度不同不相等（补零不能掩盖长度差异）', () => {
    expect(constantTimeEquals('abc', 'abc\0')).toBe(false);
    expect(constantTimeEquals('abc', 'ab')).toBe(false);
    expect(constantTimeEquals('', 'a')).toBe(false);
  });

  it('多字节字符按字节比较', () => {
    expect(constantTimeEquals('密钥', '密钥')).toBe(true);
    expect(constantTimeEquals('密钥', '密鈅')).toBe(false);
  });
});
