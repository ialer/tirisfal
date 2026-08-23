const crypto = require('crypto');
const fs = require('fs');

const CF_EMAIL = fs.readFileSync(process.env.HOME + '/.cf-email', 'utf8').trim();
const CF_KEY = fs.readFileSync(process.env.HOME + '/.cf-key', 'utf8').trim();
const AID = 'c3b881d5cfd7b8223b02dc36bc6b5ac6';
const DB = '19134230-2817-4e34-9c29-04168ddb35bb';
const API = `https://api.cloudflare.com/client/v4/accounts/${AID}/d1/database/${DB}/query`;
const EMAIL = 'musk@snbar.top';
const PW = process.env.BW_PW;
const MODE = process.env.MIG_MODE || 'dry'; // dry | run

async function d1(sql, params) {
  const res = await fetch(API, { method: 'POST',
    headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params: params || [] }) });
  const j = await res.json();
  if (!j.success) throw new Error('D1 error: ' + JSON.stringify(j.errors));
  return (j.result && j.result[0]) || {};
}

// ===== 复刻 webapp/src/lib/crypto.ts 的算法 =====
function hkdfExpand(prk, info, length) {
  const infoBytes = Buffer.from(info, 'utf8');
  const h = crypto.createHmac('sha256', prk);
  let previous = Buffer.alloc(0); const out = []; let counter = 1;
  while (out.reduce((a, b) => a + b.length, 0) < length) {
    const input = Buffer.concat([previous, infoBytes, Buffer.from([counter & 0xff])]);
    previous = crypto.createHmac('sha256', prk).update(input).digest();
    out.push(previous); counter++;
  }
  return Buffer.concat(out).subarray(0, length);
}
function parseCS(s) {
  const p = s.indexOf('.');
  const type = Number(s.slice(0, p));
  const parts = s.slice(p + 1).split('|');
  return { type, iv: Buffer.from(parts[0], 'base64'), ct: Buffer.from(parts[1], 'base64'), mac: parts[2] ? Buffer.from(parts[2], 'base64') : null };
}
function decBw(cs, encKey, macKey) {
  const { iv, ct, mac, type } = parseCS(cs);
  if (type === 2 && mac) {
    const expected = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, ct])).digest();
    if (!crypto.timingSafeEqual(expected, mac)) throw new Error('MAC mismatch');
  }
  const d = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  return Buffer.concat([d.update(ct), d.final()]);
}
function encBw(data, encKey, macKey) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  const ct = Buffer.concat([c.update(data), c.final()]);
  const mac = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, ct])).digest();
  return `2.${iv.toString('base64')}|${ct.toString('base64')}|${mac.toString('base64')}`;
}
const ENC_RE = /^\d\.[A-Za-z0-9+/=]+\|/;
const needsEnc = v => typeof v === 'string' && v.length > 0 && !ENC_RE.test(v);
const maybeEnc = v => needsEnc(v) ? encBw(Buffer.from(v, 'utf8'), UK_ENC, UK_MAC) : v;

let UK_ENC = null, UK_MAC = null;

(async () => {
  const u = await d1('SELECT id, kdf_iterations, `key` FROM users WHERE email = ?', [EMAIL]);
  const { id: userId, kdf_iterations: iters, key: profileKey } = u.results[0];

  const masterKey = crypto.pbkdf2Sync(PW, EMAIL.trim().toLowerCase(), iters || 600000, 32, 'sha256');
  const encMk = hkdfExpand(masterKey, 'enc', 32);
  const macMk = hkdfExpand(masterKey, 'mac', 32);
  let sym;
  try { sym = decBw(profileKey, encMk, macMk); } catch (e) { console.error('解锁失败（主密码不匹配或格式异常）:', e.message); process.exit(1); }
  if (sym.length < 64) { console.error('解锁后的密钥长度异常:', sym.length); process.exit(1); }
  UK_ENC = sym.subarray(0, 32); UK_MAC = sym.subarray(32, 64);
  console.log('✅ 用户密钥解锁成功 (64 字节)，模式:', MODE);

  // 回环自检：加密→解密必须还原
  const probe = 'roundtrip-' + Date.now();
  const rt = decBw(encBw(Buffer.from(probe), UK_ENC, UK_MAC), UK_ENC, UK_MAC).toString('utf8');
  if (rt !== probe) { console.error('回环自检失败'); process.exit(1); }
  console.log('✅ 加解密回环自检通过');

  const ciphers = await d1('SELECT id, name, data FROM ciphers');
  const folders = await d1('SELECT id, name FROM folders');
  let nName = 0, nLogin = 0, nNotes = 0, nOther = 0, rowsChanged = 0, folderChanged = 0;

  for (const row of ciphers.results) {
    let d; try { d = JSON.parse(row.data); } catch { continue; }
    let changed = false;
    const newName = (() => { const v = row.name; if (needsEnc(v)) { nName++; changed = true; return maybeEnc(v); } return v; })();
    if (d.name !== undefined && needsEnc(d.name)) { d.name = maybeEnc(d.name); changed = true; }
    if (d.notes && needsEnc(d.notes)) { d.notes = maybeEnc(d.notes); nNotes++; changed = true; }
    if (d.login) {
      for (const k of ['username', 'password', 'totp']) {
        if (d.login[k] && needsEnc(d.login[k])) { d.login[k] = maybeEnc(d.login[k]); nLogin++; changed = true; }
      }
      if (Array.isArray(d.login.uris)) for (const u of d.login.uris) {
        if (u && u.uri && needsEnc(u.uri)) { u.uri = maybeEnc(u.uri); changed = true; }
      }
    }
    for (const obj of [d.card, d.identity]) {
      if (!obj || typeof obj !== 'object') continue;
      for (const k of Object.keys(obj)) {
        if (obj[k] && typeof obj[k] === 'string' && needsEnc(obj[k])) { obj[k] = maybeEnc(obj[k]); nOther++; changed = true; }
      }
    }
    if (d.sshKey && d.sshKey.privateKey && needsEnc(d.sshKey.privateKey)) { d.sshKey.privateKey = maybeEnc(d.sshKey.privateKey); nOther++; changed = true; }
    if (Array.isArray(d.fields)) for (const fl of d.fields) {
      for (const k of ['name', 'value']) {
        if (fl[k] && needsEnc(fl[k])) { fl[k] = maybeEnc(fl[k]); nOther++; changed = true; }
      }
    }
    if (MODE === 'run' && changed) {
      await d1('UPDATE ciphers SET name = ?, data = ? WHERE id = ?', [newName, JSON.stringify(d), row.id]);
      rowsChanged++;
    }
  }

  for (const f of folders.results) {
    if (!needsEnc(f.name)) continue;
    folderChanged++;
    if (MODE === 'run') await d1('UPDATE folders SET name = ? WHERE id = ?', [maybeEnc(f.name), f.id]);
  }

  console.log(`统计: 名称=${nName} 登录字段=${nLogin} 备注=${nNotes} 其他=${nOther} | 条目行=${rowsChanged} 文件夹=${folderChanged}`);

  if (MODE === 'run') {
    const now = new Date().toISOString();
    try { await d1('UPDATE user_revisions SET revision_date = ? WHERE user_id = ?', [now, userId]); } catch {}
    console.log('✅ 迁移完成，已更新同步时间戳');
  } else {
    console.log('(dry 模式，未写库。设置 MIG_MODE=run 执行真实迁移)');
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });