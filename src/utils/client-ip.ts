/**
 * 客户端 IP 解析（限流键 / 审计 / 授权白名单共用一套逻辑）
 *
 * 背景：Workers 运行时拿不到 socket 对端地址，客户端 IP 只能来自代理注入的头。
 * 云端由 Cloudflare 边缘强制注入 CF-Connecting-IP；自托管容器里由我们自己的
 * 反代注入。两种来源的信任级别不同，因此：
 *   - 未配置 PROXY_SHARED_SECRET：沿用原有行为（只信 CLIENT_IP_HEADER，本机开发回退代理头）
 *   - 配置了 PROXY_SHARED_SECRET：还要求请求带匹配的 X-Tirisfal-Proxy 头，
 *     否则视为不可信来源（直接访问 worker 端口无法伪造 IP 绕过限流/白名单）
 */

import type { Env } from '../types';

/** 反代共享密钥头（由 Caddy/cloudflared 侧注入，客户端不应能设置） */
export const PROXY_SECRET_HEADER = 'X-Tirisfal-Proxy';

/** 默认客户端 IP 头（Cloudflare 边缘注入） */
export const DEFAULT_CLIENT_IP_HEADER = 'CF-Connecting-IP';

export interface ClientIpResult {
  /** 规整后的纯 IP，用于审计与 allowed_ip 比对 */
  plain: string;
  /** 限流键：ip4:x.x.x.x 或折叠到 /64 的 ip6:xxxx:... */
  key: string;
}

function parseIpv4Octets(input: string): number[] | null {
  const value = input.trim();
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (num < 0 || num > 255) return null;
    octets.push(num);
  }
  return octets;
}

function parseIpv6Hextets(input: string): number[] | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }
  const zoneIndex = value.indexOf('%');
  if (zoneIndex >= 0) {
    value = value.slice(0, zoneIndex);
  }
  if (!value.includes(':')) return null;

  // IPv4 映射尾部（如 ::ffff:192.0.2.1）
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (lastColon < 0) return null;
    const octets = parseIpv4Octets(value.slice(lastColon + 1));
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, lastColon)}:${high}:${low}`;
  }

  if (value.indexOf('::') !== value.lastIndexOf('::')) return null;

  const parsePart = (part: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    const n = parseInt(part, 16);
    return Number.isNaN(n) ? null : n;
  };

  const parseParts = (parts: string[]): number[] | null => {
    const out: number[] = [];
    for (const p of parts) {
      if (!p) return null;
      const n = parsePart(p);
      if (n === null) return null;
      out.push(n);
    }
    return out;
  };

  if (value.includes('::')) {
    const [headRaw, tailRaw] = value.split('::');
    const head = headRaw ? headRaw.split(':') : [];
    const tail = tailRaw ? tailRaw.split(':') : [];
    const headNums = parseParts(head);
    const tailNums = parseParts(tail);
    if (!headNums || !tailNums) return null;
    const missing = 8 - (headNums.length + tailNums.length);
    if (missing < 1) return null;
    return [...headNums, ...new Array<number>(missing).fill(0), ...tailNums];
  }

  const all = parseParts(value.split(':'));
  if (!all || all.length !== 8) return null;
  return all;
}

/**
 * 规整客户端 IP：去端口、去方括号，IPv4 映射的 IPv6 归一成 IPv4。
 * @returns plain（审计用）与 key（限流用）
 */
export function normalizeClientIp(rawIp: string | null | undefined): ClientIpResult | null {
  if (!rawIp) return null;
  let input = rawIp.trim();
  if (!input) return null;

  // 去掉 host:port 形式（1.2.3.4:5678 / [::1]:5678）
  const bracketWithPort = /^\[([^\]]+)\](?::\d+)?$/.exec(input);
  if (bracketWithPort) input = bracketWithPort[1];
  else {
    const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(input);
    if (v4WithPort) input = v4WithPort[1];
  }

  const ipv4 = parseIpv4Octets(input);
  if (ipv4) {
    const plain = ipv4.join('.');
    return { plain, key: `ip4:${plain}` };
  }

  const ipv6 = parseIpv6Hextets(input);
  if (!ipv6) return null;

  // IPv4 映射/兼容的 IPv6 统一当作 IPv4 处理
  if (
    ipv6[0] === 0 &&
    ipv6[1] === 0 &&
    ipv6[2] === 0 &&
    ipv6[3] === 0 &&
    ipv6[4] === 0 &&
    (ipv6[5] === 0xffff || ipv6[5] === 0)
  ) {
    const octets = [ipv6[6] >> 8, ipv6[6] & 0xff, ipv6[7] >> 8, ipv6[7] & 0xff];
    const plain = octets.join('.');
    return { plain, key: `ip4:${plain}` };
  }

  const plain = ipv6.map((part) => part.toString(16).padStart(4, '0')).join(':');
  // 折叠到 /64：避免 IPv6 地址轮换绕过限流
  const prefix64 = ipv6
    .slice(0, 4)
    .map((part) => part.toString(16).padStart(4, '0'))
    .join(':');
  return { plain, key: `ip6:${prefix64}` };
}

/** 是否为本地开发请求（Host 指向回环） */
export function isLocalRequest(request: Request): boolean {
  const isLoopbackHost = (host: string | null): boolean => {
    if (!host) return false;
    const normalized = host.split(':')[0].trim().toLowerCase();
    return (
      normalized === 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized === '127.0.0.1' ||
      normalized === '0.0.0.0' ||
      normalized === '::1' ||
      normalized === '[::1]'
    );
  };

  try {
    if (isLoopbackHost(new URL(request.url).hostname)) return true;
  } catch {
    // URL 非法时回退到 Host 头判断
  }

  return isLoopbackHost(request.headers.get('Host'));
}

const LOOPBACK: ClientIpResult = { plain: '127.0.0.1', key: 'ip4:127.0.0.1' };

/**
 * 解析可信客户端 IP。
 *
 * 可信来源：
 * 1. PROXY_SHARED_SECRET 未配置：直接采信 CLIENT_IP_HEADER（Cloudflare 部署的既有行为）
 * 2. PROXY_SHARED_SECRET 已配置：必须同时带匹配的 X-Tirisfal-Proxy 头，
 *    否则只允许本机开发回退，其余一律视为不可定位（fail-closed）
 * 3. 本机回环请求：回退 X-Real-IP / X-Forwarded-For，再否则 127.0.0.1
 */
export function resolveClientIp(request: Request, env?: Partial<Env>): ClientIpResult | null {
  const headerName = (env?.CLIENT_IP_HEADER || DEFAULT_CLIENT_IP_HEADER).trim();
  const secret = (env?.PROXY_SHARED_SECRET || '').trim();
  const local = isLocalRequest(request);

  if (secret) {
    if (request.headers.get(PROXY_SECRET_HEADER) !== secret) {
      return local ? LOOPBACK : null;
    }
  }

  const direct = normalizeClientIp(request.headers.get(headerName));
  if (direct) return direct;

  if (local) {
    const forwarded = request.headers.get('X-Real-IP');
    const fromXff = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || null;
    return normalizeClientIp(forwarded) || normalizeClientIp(fromXff) || LOOPBACK;
  }

  return null;
}

/** 限流/锁定键；无法定位客户端时返回 null，由调用方拒绝 */
export function getClientIdentifier(request: Request, env?: Partial<Env>): string | null {
  return resolveClientIp(request, env)?.key ?? null;
}

/** 审计与 allowed_ip 比对用的纯 IP */
export function getClientIpAddress(request: Request, env?: Partial<Env>): string | null {
  return resolveClientIp(request, env)?.plain ?? null;
}
