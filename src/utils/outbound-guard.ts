/**
 * 出站目标守卫（SSRF 相关工具）
 *
 * 背景：Workers 无法自定义 DNS 解析，因此「主机名字符串校验」本身挡不住
 * DNS rebinding——白名单里的域名可以在校验之后解析到内网地址。本模块把
 * 能判定的部分做到最严（主机名规范化、IP 字面量识别、私网/保留网段识别、
 * 逐次解析校验），并把不可判定的部分显式留给部署方（Cloudflare 出站策略 /
 * 自建环境的出口防火墙）。
 */

/** 上游响应中替换凭证明文的占位符 */
export const REDACTION_PLACEHOLDER = '***REDACTED***';

/** 逐次解析校验使用的 DoH 端点（Cloudflare，支持 application/dns-json） */
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

/**
 * 规范化主机名：
 * - WHATWG URL 已把 2130706433 / 0x7f000001 / 127.1 这类写法归一成点分十进制；
 * - 但保留尾部根点（"api.example.com."），必须自行去掉，否则白名单精确匹配被绕过。
 */
export function normalizeHostname(host: string): string {
  let h = (host || '').trim().toLowerCase();
  const bracketed = h.startsWith('[') && h.endsWith(']');
  if (bracketed) return h;
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/** 是否 IP 字面量（IPv4 点分 / 单整数 / IPv6 含冒号 / 方括号形式） */
export function isIpLiteralHost(host: string): boolean {
  const h = normalizeHostname(host);
  if (!h) return false;
  if (h.startsWith('[') && h.endsWith(']')) return true;
  if (h.includes(':')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (/^\d+$/.test(h)) return true;
  return false;
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map((x) => Number(x));
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** IPv4 私网 / 保留 / 组播 / 文档网段（RFC1918、RFC6598、RFC5737、link-local 等） */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function inCidr4(value: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseInt & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return BLOCKED_V4.some(([base, bits]) => inCidr4(value, base, bits));
}

/** IPv6 私网 / 回环 / link-local / 组播 / 文档 / IPv4 映射形式 */
function isBlockedIpv6(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase();
  if (ip === '::' || ip === '::1') return true;

  // IPv4 映射的两种写法：::ffff:127.0.0.1 与 URL 归一后的 ::ffff:7f00:1
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (dotted) return isBlockedIpv4(dotted[1]);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hexMapped) {
    const value = ((parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16)) >>> 0;
    return BLOCKED_V4.some(([base, bits]) => inCidr4(value, base, bits));
  }

  if (/^f[cd][0-9a-f]{0,2}:/.test(ip)) return true; // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]?:/.test(ip)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{0,2}:/.test(ip)) return true; // ff00::/8 组播
  if (ip.startsWith('64:ff9b:')) return true; // NAT64
  if (ip.startsWith('2001:db8:')) return true; // 文档网段
  return false;
}

/** IP 字符串是否属于私网 / 保留 / 不可路由网段 */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.trim();
  if (clean.includes(':')) return isBlockedIpv6(clean);
  return isBlockedIpv4(clean);
}

/** 本地/内网域名（含去尾点后的形式） */
export function isPrivateHostname(host: string): boolean {
  const h = normalizeHostname(host);
  if (!h) return true;
  if (h === 'localhost') return true;
  return /\.(localhost|local|internal|localdomain|lan|home\.arpa|intranet|corp)$/.test(h);
}

/**
 * 主机是否命中白名单。
 * 通配只允许「单层标签」：*.example.com 匹配 a.example.com，不匹配 a.b.example.com。
 */
export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = normalizeHostname(host);
  return allowed.some((entry) => {
    const p = normalizeHostname(entry);
    if (!p) return false;
    if (p.startsWith('*.')) {
      const suffix = p.slice(1);
      if (!h.endsWith(suffix)) return false;
      const label = h.slice(0, h.length - suffix.length);
      return label.length > 0 && !label.includes('.');
    }
    return h === p;
  });
}

/** 简单 base64（凭证回显可能以 base64 形式出现） */
function base64Of(text: string): string {
  try {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  } catch {
    return '';
  }
}

/**
 * 生成需要从响应中抹掉的凭证变体：原文、URL 编码、base64、base64url。
 * 长串优先替换，避免短变体先破坏长变体的匹配。
 */
export function secretVariants(secret: string): string[] {
  if (!secret) return [];
  const variants = new Set<string>();
  variants.add(secret);
  try {
    variants.add(encodeURIComponent(secret));
  } catch {
    /* 非法代理对等情况忽略 */
  }
  const b64 = base64Of(secret);
  if (b64) {
    variants.add(b64);
    variants.add(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  }
  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
}

/**
 * 上游响应脱敏：任何长度、任何已知编码形式的凭证都不得回传给调用方。
 * 旧实现只在 length >= 8 时脱敏，短凭证会原文回显。
 */
export function redactSecret(text: string, secret: string): string {
  if (!text || !secret) return text;
  let out = text;
  for (const v of secretVariants(secret)) {
    out = out.split(v).join(REDACTION_PLACEHOLDER);
  }
  return out;
}

interface DohAnswer {
  type?: number;
  data?: string;
}

async function dohLookup(name: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
  const body: { Answer?: DohAnswer[] } = await res.json();
  const wanted = type === 'A' ? 1 : 28;
  return (body.Answer ?? []).flatMap((a) =>
    a.type === wanted && typeof a.data === 'string' ? [a.data] : []
  );
}

/**
 * 逐次解析校验（可选开启）：解析目标主机，任一 A/AAAA 落在私网/保留网段即拒绝。
 *
 * 这能把 DNS rebinding 的成本抬高一个量级（校验时就必须给出公网地址，且
 * Cloudflare 递归解析对 TTL 有下限），但 fetch 会自行再解析一次，理论上仍
 * 存在 TOCTOU 窗口。真正的兜底在部署侧：Cloudflare Workers 默认禁止向
 * RFC1918 出站；自建 workerd 请用出口防火墙只放行白名单目标。
 *
 * @returns 拒绝原因；null 表示通过
 */
export async function checkHostResolution(host: string): Promise<string | null> {
  const h = normalizeHostname(host);
  if (!h) return 'Invalid target host';

  let answers: string[];
  try {
    const [a, aaaa] = await Promise.all([dohLookup(h, 'A'), dohLookup(h, 'AAAA')]);
    answers = [...a, ...aaaa];
  } catch {
    // 校验不可用时失败关闭：宁可拒绝一次注入，也不放行未校验的目标
    return 'DNS resolution guard unavailable';
  }

  if (!answers.length) return 'Target host did not resolve';
  if (answers.some((ip) => isBlockedIp(ip))) {
    return 'Target host resolves to a private or reserved address';
  }
  return null;
}
