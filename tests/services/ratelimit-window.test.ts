import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { RATE_LIMIT_UPSERT_SQL } from '../../src/services/ratelimit';

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
  };
}

// Vite 不解析 node: 前缀的内置模块，用 createRequire 拿 node:sqlite
const nodeRequire = createRequire(import.meta.url);
const sqliteAvailable = (() => {
  try {
    nodeRequire('node:sqlite');
    return true;
  } catch {
    return false;
  }
})();
const { DatabaseSync } = (sqliteAvailable ? nodeRequire('node:sqlite') : {}) as {
  DatabaseSync: new (path: string) => SqliteDb;
};

/**
 * 回归：固定窗口计数器「换窗必须重置」。
 * 旧实现用 ON CONFLICT ... WHERE window_start = excluded.window_start，
 * 窗口变化时整行不更新，新窗口查询取不到行 → count 退化为 1，限流永久失效。
 */
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL, expires_at INTEGER NOT NULL)'
  );
  return db;
}

function hit(db: SqliteDb, key: string, windowStart: number, windowEnd: number): number {
  db.prepare(RATE_LIMIT_UPSERT_SQL).run(key, windowStart, windowEnd);
  const row = db
    .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
    .get(key, windowStart) as { count?: number } | undefined;
  return row?.count ?? 1;
}

describe.skipIf(!sqliteAvailable)('rate limit · 固定窗口换窗重置（需要 node:sqlite）', () => {
  it('同一窗口内递增', () => {
    const db = setup();
    expect(hit(db, 'ip:1', 100, 160)).toBe(1);
    expect(hit(db, 'ip:1', 100, 160)).toBe(2);
    expect(hit(db, 'ip:1', 100, 160)).toBe(3);
  });

  it('换窗后计数重置为 1，而不是沿用旧窗口的行', () => {
    const db = setup();
    for (let i = 0; i < 5; i += 1) hit(db, 'ip:1', 100, 160);
    expect(hit(db, 'ip:1', 160, 220)).toBe(1);
    expect(hit(db, 'ip:1', 160, 220)).toBe(2);
  });

  it('跨窗口连续请求仍会被限制（不能借换窗无限放行）', () => {
    const db = setup();
    const max = 3;
    const results: boolean[] = [];
    let window = 100;
    for (let i = 0; i < 6; i += 1) {
      if (i > 0 && i % 3 === 0) window += 60;
      const count = hit(db, 'ip:1', window, window + 60);
      results.push(count <= max);
    }
    expect(results.filter(Boolean)).toHaveLength(6);
    // 每个窗口内第 4 次就该被拒
    for (let i = 0; i < 4; i += 1) hit(db, 'ip:2', 300, 360);
    const row = db
      .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
      .get('ip:2', 300) as { count: number };
    expect(row.count).toBeGreaterThan(max);
  });

  it('不同 key 互不影响', () => {
    const db = setup();
    hit(db, 'ip:1', 100, 160);
    hit(db, 'ip:1', 100, 160);
    expect(hit(db, 'ip:2', 100, 160)).toBe(1);
  });
});
