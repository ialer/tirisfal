import { describe, expect, it } from 'vitest';

import {
  getClientIdentifier,
  getClientIpAddress,
  normalizeClientIp,
  PROXY_SECRET_HEADER,
  resolveClientIp,
} from '../../src/utils/client-ip';

const SECRET = 'unit-proxy-secret-value';

function req(
  headers: Record<string, string>,
  url = 'https://vault.example.com/api/health'
): Request {
  return new Request(url, { headers });
}

describe('client-ip · 规整', () => {
  it('IPv4 去端口、IPv6 去方括号、映射地址归一', () => {
    expect(normalizeClientIp('1.2.3.4:5678')?.plain).toBe('1.2.3.4');
    expect(normalizeClientIp('[2001:db8::1]:443')?.plain).toBe(
      '2001:0db8:0000:0000:0000:0000:0000:0001'
    );
    expect(normalizeClientIp('::ffff:1.2.3.4')?.plain).toBe('1.2.3.4');
    expect(normalizeClientIp('   ')).toBeNull();
    expect(normalizeClientIp('not-an-ip')).toBeNull();
  });

  it('IPv6 限流键折叠到 /64，防止地址轮换绕过', () => {
    const a = normalizeClientIp('2001:db8:1:2::1')!.key;
    const b = normalizeClientIp('2001:db8:1:2::ffff')!.key;
    expect(a).toBe(b);
    expect(a.startsWith('ip6:')).toBe(true);
  });
});

describe('client-ip · 信任链', () => {
  it('未配置共享密钥时沿用 CF 头（Cloudflare 部署）', () => {
    const r = req({ 'CF-Connecting-IP': '1.2.3.4' });
    expect(resolveClientIp(r, {})?.plain).toBe('1.2.3.4');
    expect(getClientIdentifier(r, {})).toBe('ip4:1.2.3.4');
  });

  it('配置了共享密钥：头匹配才采信', () => {
    const env = { PROXY_SHARED_SECRET: SECRET, CLIENT_IP_HEADER: 'X-Real-IP' };
    const ok = req({ 'X-Real-IP': '1.2.3.4', [PROXY_SECRET_HEADER]: SECRET });
    expect(getClientIpAddress(ok, env)).toBe('1.2.3.4');

    const spoof = req({ 'X-Real-IP': '1.2.3.4' });
    expect(resolveClientIp(spoof, env)).toBeNull();

    const wrong = req({ 'X-Real-IP': '1.2.3.4', [PROXY_SECRET_HEADER]: 'guess' });
    expect(resolveClientIp(wrong, env)).toBeNull();
  });

  it('直连 worker 端口伪造 CF 头时，配了密钥的部署仍然拒绝', () => {
    const r = req({ 'CF-Connecting-IP': '203.0.113.9' });
    expect(resolveClientIp(r, { PROXY_SHARED_SECRET: SECRET })).toBeNull();
  });

  it('本机开发：无头时回退 127.0.0.1', () => {
    const r = req({}, 'http://127.0.0.1:8787/api/health');
    expect(resolveClientIp(r, {})?.plain).toBe('127.0.0.1');
  });
});
