import { describe, expect, it, vi } from 'vitest';

import {
  checkHostResolution,
  hostAllowed,
  isBlockedIp,
  isIpLiteralHost,
  isPrivateHostname,
  normalizeHostname,
  REDACTION_PLACEHOLDER,
  redactSecret,
  secretVariants,
} from '../../src/utils/outbound-guard';

describe('outbound-guard · 主机名规范化', () => {
  it('去掉尾部根点（URL 会保留 "example.com."）', () => {
    expect(normalizeHostname('API.Example.COM.')).toBe('api.example.com');
    expect(normalizeHostname('localhost.')).toBe('localhost');
    expect(normalizeHostname('...')).toBe('');
  });

  it('URL 归一后的数字/IPv6 形式一律识别为 IP 字面量', () => {
    for (const host of ['127.0.0.1', '169.254.169.254', '2130706433', '[::1]', '[::ffff:7f00:1]']) {
      expect(isIpLiteralHost(host), host).toBe(true);
    }
    expect(isIpLiteralHost('api.example.com')).toBe(false);
  });

  it('识别私网/保留网段', () => {
    const blocked = [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.5.31',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
    ];
    for (const ip of blocked) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ['1.1.1.1', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it('识别本地/内网域名（含去尾点形式）', () => {
    for (const host of ['localhost', 'localhost.', 'printer.local', 'metadata.google.internal']) {
      expect(isPrivateHostname(host), host).toBe(true);
    }
    expect(isPrivateHostname('api.example.com')).toBe(false);
  });
});

describe('outbound-guard · allowed_hosts 匹配', () => {
  it('精确匹配忽略大小写与尾点', () => {
    expect(hostAllowed('API.example.com.', ['api.example.com'])).toBe(true);
    expect(hostAllowed('api.example.com.evil.net', ['api.example.com'])).toBe(false);
  });

  it('通配只允许单层标签', () => {
    expect(hostAllowed('a.example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('a.b.example.com', ['*.example.com'])).toBe(false);
    expect(hostAllowed('example.com', ['*.example.com'])).toBe(false);
    expect(hostAllowed('notexample.com', ['*.example.com'])).toBe(false);
  });
});

describe('outbound-guard · 响应脱敏', () => {
  it('短凭证也必须脱敏（旧实现 <8 字符直接回显）', () => {
    expect(redactSecret('token=abc;', 'abc')).toBe(`token=${REDACTION_PLACEHOLDER};`);
    expect(redactSecret('x', 'x')).toBe(REDACTION_PLACEHOLDER);
  });

  it('覆盖 URL 编码与 base64 变体', () => {
    const secret = 'p@ss word/1';
    const urlEncoded = encodeURIComponent(secret);
    const b64 = secretVariants(secret).find((v) => v !== secret && v.includes('='));
    expect(redactSecret(`raw=${secret}`, secret)).not.toContain(secret);
    expect(redactSecret(`enc=${urlEncoded}`, secret)).not.toContain(urlEncoded);
    if (b64) expect(redactSecret(`b64=${b64}`, secret)).not.toContain(b64);
  });

  it('空凭证不做替换，避免误伤正常响应', () => {
    expect(redactSecret('hello', '')).toBe('hello');
  });
});

describe('outbound-guard · 逐次解析校验', () => {
  it('解析到私网地址即拒绝', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              Status: 0,
              Answer:
                new URL(String(url)).searchParams.get('type') === 'A'
                  ? [{ type: 1, data: '10.126.126.1' }]
                  : [],
            }),
            { status: 200 }
          )
        )
      )
    );
    await expect(checkHostResolution('internal.example.com')).resolves.toBe(
      'Target host resolves to a private or reserved address'
    );
    vi.unstubAllGlobals();
  });

  it('解析到公网地址放行', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              Answer:
                new URL(String(url)).searchParams.get('type') === 'A'
                  ? [{ type: 1, data: '1.1.1.1' }]
                  : [],
            }),
            { status: 200 }
          )
        )
      )
    );
    await expect(checkHostResolution('api.example.com')).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it('解析失败时失败关闭', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('doh down')))
    );
    await expect(checkHostResolution('api.example.com')).resolves.toBe(
      'DNS resolution guard unavailable'
    );
    vi.unstubAllGlobals();
  });
});
