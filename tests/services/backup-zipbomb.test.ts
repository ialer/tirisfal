import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  assertArchiveEntryWithinLimits,
  parseBackupArchive,
} from '../../src/services/backup-archive';

describe('备份解压 · zip bomb 防护', () => {
  it('条目数超限直接拒绝', () => {
    const budget = { entries: 0, totalOriginalBytes: 0 };
    for (let i = 0; i < 10_000; i += 1) {
      assertArchiveEntryWithinLimits({ name: `f${i}`, originalSize: 1 }, budget);
    }
    expect(() =>
      assertArchiveEntryWithinLimits({ name: 'overflow', originalSize: 1 }, budget)
    ).toThrow(/too many files/);
  });

  it('单条解压后超过总量上限直接拒绝', () => {
    const budget = { entries: 0, totalOriginalBytes: 0 };
    expect(() =>
      assertArchiveEntryWithinLimits({ name: 'big.bin', originalSize: 65 * 1024 * 1024 }, budget)
    ).toThrow(/expands beyond/);
  });

  it('累计解压体积超限时拒绝', () => {
    const budget = { entries: 0, totalOriginalBytes: 0 };
    for (let i = 0; i < 63; i += 1) {
      assertArchiveEntryWithinLimits({ name: `p${i}`, originalSize: 1024 * 1024 }, budget);
    }
    expect(() =>
      assertArchiveEntryWithinLimits({ name: 'p-overflow', originalSize: 2 * 1024 * 1024 }, budget)
    ).toThrow(/expands beyond/);
  });

  it('真实高压缩比归档在解压前被拦下', () => {
    // 40MB 全零 → 压缩后极小，解压会膨胀超过 db.json 的 32MiB 限额
    const bomb = zipSync({ 'db.json': new Uint8Array(40 * 1024 * 1024) });
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect(() => parseBackupArchive(bomb)).toThrow(/database payload is too large/);
  });
});
