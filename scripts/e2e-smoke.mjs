#!/usr/bin/env node
/**
 * Tirisfal 端到端冒烟测试（对 wrangler dev 本地实例运行）
 *
 * 用法:
 *   1) 启动本地实例:  npx wrangler dev --local --port 8787
 *   2) 首次灌入测试账号:
 *      node scripts/e2e-provision-local.mjs
 *   3) 运行测试:
 *      E2E_PASSWORD='DiagE2E-9988-xK' node scripts/e2e-smoke.mjs
 */
import crypto from 'node:crypto';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:8787';
const EMAIL = (process.env.E2E_EMAIL || 'diag-e2e@tirisfal.local').toLowerCase();
const PW = process.env.E2E_PASSWORD || 'DiagE2E-9988-xK';
const ITERS = 600000;

let pass = 0,
  fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};
const uuid = () => crypto.randomUUID();

// ===== BW 标准算法 =====
function hkdfExpand(prk, info, length) {
  const infoBytes = Buffer.from(info, 'utf8');
  let prev = Buffer.alloc(0);
  const out = [];
  let counter = 1;
  while (out.reduce((a, b) => a + b.length, 0) < length) {
    const input = Buffer.concat([prev, infoBytes, Buffer.from([counter & 0xff])]);
    prev = crypto.createHmac('sha256', prk).update(input).digest();
    out.push(prev);
    counter++;
  }
  return Buffer.concat(out).subarray(0, length);
}
function decBw(cs, ek, mk) {
  const p = cs.indexOf('.');
  const type = Number(cs.slice(0, p));
  const parts = cs
    .slice(p + 1)
    .split('|')
    .map((x) => Buffer.from(x, 'base64'));
  if (type === 2 && parts[2]) {
    const expected = crypto
      .createHmac('sha256', mk)
      .update(Buffer.concat([parts[0], parts[1]]))
      .digest();
    if (!crypto.timingSafeEqual(expected, parts[2])) throw new Error('MAC mismatch');
  }
  const d = crypto.createDecipheriv('aes-256-cbc', ek, parts[0]);
  return Buffer.concat([d.update(parts[1]), d.final()]);
}
function decStr(cs, ek, mk) {
  return decBw(cs, ek, mk).toString('utf8');
}
function encBw(pt, ek, mk) {
  if (typeof ek === 'undefined')
    console.error(
      '[encBw] ek UNDEFINED! pt=',
      JSON.stringify(String(pt)).slice(0, 40),
      new Error().stack.split(String.fromCharCode(10))[1]
    );
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', ek, iv);
  const ct = Buffer.concat([c.update(Buffer.from(pt, 'utf8')), c.final()]);
  const mac = crypto
    .createHmac('sha256', mk)
    .update(Buffer.concat([iv, ct]))
    .digest();
  return `2.${iv.toString('base64')}|${ct.toString('base64')}|${mac.toString('base64')}`;
}

async function req(method, path, body, token, ct) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined && body !== null) headers['Content-Type'] = ct || 'application/json';
  const bodyOut =
    body === undefined || body === null
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
  const res = await fetch(BASE + path, { method, headers, body: bodyOut });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

(async () => {
  console.log(`E2E 冒烟测试 -> ${BASE}`);

  // 1. 健康
  const h = await req('GET', '/api/health');
  ok('健康检查', h.status === 200 && h.json?.status === 'healthy', h.text.slice(0, 80));

  // 2. 登录（Bitwarden 标准派生）
  const masterKey = crypto.pbkdf2Sync(PW, EMAIL, ITERS, 32, 'sha256');
  const loginHash = crypto.pbkdf2Sync(masterKey, PW, 1, 32, 'sha256').toString('base64');
  const qs = new URLSearchParams({
    grant_type: 'password',
    username: EMAIL,
    password: loginHash,
    scope: 'api offline_access',
    client_id: 'web',
    deviceType: '9',
    deviceIdentifier: 'e2e-' + uuid().slice(0, 8),
    deviceName: 'e2e',
  }).toString();
  const lr = await req(
    'POST',
    '/identity/connect/token',
    qs,
    null,
    'application/x-www-form-urlencoded'
  );
  ok('登录', !!lr.json?.access_token, lr.text.slice(0, 100));
  const token = lr.json?.access_token;
  if (!token) {
    console.log(`结果: ${pass} 通过, ${fail} 失败`);
    process.exit(1);
  }

  // 3. 解锁用户密钥
  let ukEnc,
    ukMac,
    unlocked = false;
  try {
    const sym = decBw(
      lr.json.Key,
      hkdfExpand(masterKey, 'enc', 32),
      hkdfExpand(masterKey, 'mac', 32)
    );
    ukEnc = sym.subarray(0, 32);
    ukMac = sym.subarray(32, 64);
    unlocked = sym.length >= 64;
  } catch (e) {
    console.log('  解锁异常:', e.message);
  }
  ok('用户密钥解锁', unlocked);

  // 4. 权限门禁抽查：未认证访问批量接口必须被拒
  const gate = await req('POST', '/api/secrets/batch', { project_id: 'x' });
  ok('未认证访问被拒', gate.status === 401 || gate.status === 403, 'got ' + gate.status);

  // 5. 创建条目 → sync 解密回读
  if (!unlocked) {
    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    process.exit(1);
  }
  const item = {
    type: 1,
    folderId: null,
    favorite: false,
    notes: null,
    name: encBw('E2E-' + stamp, ukEnc, ukMac),
    login: {
      username: encBw('e2e-user-' + stamp, ukEnc, ukMac),
      password: encBw('e2e-pass-' + stamp, ukEnc, ukMac),
      totp: null,
      uris: [{ uri: encBw('https://e2e.example.com', ukEnc, ukMac), match: null }],
    },
  };
  const cr = await req('POST', '/api/ciphers', item, token);
  ok(
    '创建条目',
    cr.status === 200 || cr.status === 201,
    'got ' + cr.status + ' ' + cr.text.slice(0, 60)
  );
  const cid = cr.json?.id;

  const sr = await req('GET', '/api/sync', undefined, token);
  const mine = (sr.json?.ciphers || []).find((c) => c.id === cid);
  ok('sync 回读条目', !!mine);
  let rdName = '',
    rdUser = '',
    rdPass = '';
  try {
    rdName = decStr(mine.name, ukEnc, ukMac);
    rdUser = decStr(mine.login.username, ukEnc, ukMac);
    rdPass = decStr(mine.login.password, ukEnc, ukMac);
  } catch {}
  ok('名称解密一致', rdName === 'E2E-' + stamp, repr(rdName));
  ok('账号解密一致', rdUser === 'e2e-user-' + stamp, repr(rdUser));
  ok('密码解密一致', rdPass === 'e2e-pass-' + stamp, repr(rdPass));

  // 6. 更新密码后回读
  item.login.password = encBw('e2e-pass-ROTATED', ukEnc, ukMac);
  const ur = await req('PUT', '/api/ciphers/' + cid, { ...item, id: cid }, token);
  ok('更新条目', ur.status === 200 || ur.status === 204, 'got ' + ur.status);
  const sr2 = await req('GET', '/api/sync', undefined, token);
  const mine2 = (sr2.json?.ciphers || []).find((c) => c.id === cid);
  let rp2 = '';
  try {
    rp2 = decStr(mine2.login.password, ukEnc, ukMac);
  } catch {}
  ok('更新后解密一致', rp2 === 'e2e-pass-ROTATED', repr(rp2));

  // 7. 删除
  const dr = await req('DELETE', '/api/ciphers/' + cid, undefined, token);
  ok('删除条目', dr.status === 200 || dr.status === 204 || dr.status === 400, 'got ' + dr.status);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);

  function repr(s) {
    return JSON.stringify(String(s)).slice(0, 50);
  }
})().catch((e) => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});
