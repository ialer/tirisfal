import { describe, expect, it } from 'vitest';

import { LIMITS } from '../../src/config/limits';
import { isRotatedTokenReuse } from '../../src/services/auth';

describe('refresh token · 重用检测', () => {
  const grace = LIMITS.auth.refreshTokenOverlapGraceMs;

  it('未轮换的令牌不算重用', () => {
    expect(isRotatedTokenReuse({ rotatedAt: null, familyId: 'f1' }, Date.now(), grace)).toBe(false);
  });

  it('宽限窗口内允许重放（吸收多端并发刷新）', () => {
    const now = 1_000_000;
    expect(isRotatedTokenReuse({ rotatedAt: now - 1_000, familyId: 'f1' }, now, grace)).toBe(false);
  });

  it('超出宽限且属于某家族 → 判定重用', () => {
    const now = 1_000_000;
    expect(isRotatedTokenReuse({ rotatedAt: now - grace - 1, familyId: 'f1' }, now, grace)).toBe(
      true
    );
  });

  it('无家族的历史令牌无法撤销，按普通令牌处理', () => {
    const now = 1_000_000;
    expect(isRotatedTokenReuse({ rotatedAt: now - grace - 1, familyId: null }, now, grace)).toBe(
      false
    );
  });

  it('保留时长必须远大于宽限窗口，否则检测永远不可达', () => {
    expect(LIMITS.auth.refreshTokenReuseRetentionMs).toBeGreaterThan(
      LIMITS.auth.refreshTokenOverlapGraceMs * 10
    );
  });
});
