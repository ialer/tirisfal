#!/usr/bin/env node
/**
 * 安全门禁扫描（基线模式）
 *
 * 检查三类历史上真实出现过的问题，防止回归：
 *   1. IDOR：只按 id 过滤、没有 user_id 的 SQL
 *   2. 动态 SQL：prepare() 里用模板拼接标识符
 *   3. 公开路由限流：router-public.ts 的每个 path 分支必须有 enforcePublicRateLimit
 *
 * 用法：
 *   node scripts/check-security-gates.mjs           # 检查
 *   node scripts/check-security-gates.mjs --update  # 重新生成基线
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const BASELINE_PATH = join(ROOT, 'scripts', 'security-gates-baseline.json');
const update = process.argv.includes('--update');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const findings = [];

const PREPARE_RE = /prepare\(\s*(['"\x60])([\s\S]*?)\1/g;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = PREPARE_RE.exec(src))) {
    const sql = m[2].replace(/\s+/g, ' ').trim();
    if (!/where\s+id\s*=\s*\?/i.test(sql)) continue;
    if (/user_id/i.test(sql)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    findings.push({
      kind: 'idor-sql',
      file: relative(ROOT, file),
      line,
      detail: sql.slice(0, 120),
    });
  }
}

const DYNAMIC_RE = /prepare\(\s*\x60([^\x60]*)\x60/g;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = DYNAMIC_RE.exec(src))) {
    const sql = m[1];
    if (!sql.includes('$' + '{')) continue;
    const exprs = [...sql.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
    const unsafe = exprs.filter(
      (e) =>
        !/^placeholders$/.test(e) &&
        !/^shadowTableName\(/.test(e) &&
        !/^selectCipherColumns\(\)$/.test(e) &&
        !/^USER_SELECT_COLUMNS$/.test(e) &&
        !/^setClauses\.join\(/.test(e)
    );
    if (!unsafe.length) continue;
    const line = src.slice(0, m.index).split('\n').length;
    findings.push({
      kind: 'dynamic-sql',
      file: relative(ROOT, file),
      line,
      detail: unsafe.join(', ').slice(0, 120),
    });
  }
}

const publicRouter = join(SRC, 'router-public.ts');
if (existsSync(publicRouter)) {
  const lines = readFileSync(publicRouter, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    if (!/path\s*===\s*'/.test(line) && !/path\.match\(\//.test(line)) return;
    const window = lines.slice(idx, idx + 14).join('\n');
    if (/enforcePublicRateLimit/.test(window)) return;
    findings.push({
      kind: 'public-rate-limit',
      file: 'src/router-public.ts',
      line: idx + 1,
      detail: line.trim().slice(0, 100),
    });
  });
}

const key = (f) => f.kind + '|' + f.file + '|' + f.detail;

if (update) {
  const payload = {
    note: 'security gates baseline — 新增条目必须显式登记并说明为何安全',
    entries: findings.map((f) => ({ kind: f.kind, file: f.file, detail: f.detail })),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    'baseline updated: ' + findings.length + ' entries -> ' + relative(ROOT, BASELINE_PATH)
  );
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries || []
  : [];
const known = new Set(baseline.map((e) => e.kind + '|' + e.file + '|' + e.detail));
const fresh = findings.filter((f) => !known.has(key(f)));

console.log(
  '扫描 ' +
    files.length +
    ' 个文件：' +
    findings.length +
    ' 处命中，其中新增 ' +
    fresh.length +
    ' 处'
);
if (fresh.length) {
  console.error('\n新增的安全门禁违规：');
  for (const f of fresh)
    console.error('  [' + f.kind + '] ' + f.file + ':' + f.line + '  ' + f.detail);
  console.error('\n如确认安全，请运行 node scripts/check-security-gates.mjs --update 并说明理由。');
  process.exit(1);
}
console.log('✓ 无新增违规');
