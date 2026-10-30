import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateUserTotpLastUsedStep } from '../../src/services/storage-user-repo';

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  run: vi.fn(),
};

describe('updateUserTotpLastUsedStep（TOTP 防重放：原子占用）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('必须是条件更新：SQL 带 totp_last_used_step < ? 条件', async () => {
    mockDb.run.mockResolvedValue({ meta: { changes: 1 } });

    await updateUserTotpLastUsedStep(mockDb as any, 'user-1', 12345);

    const sql = mockDb.prepare.mock.calls[0][0] as string;
    // 只按 id 更新会留下 check-then-act 竞态（并发提交同一个 TOTP 码都能通过）
    expect(sql).toContain('totp_last_used_step < ?');
    expect(mockDb.bind).toHaveBeenCalledWith(12345, 'user-1', 12345);
  });

  it('changes=1 表示占用成功，返回 true', async () => {
    mockDb.run.mockResolvedValue({ meta: { changes: 1 } });
    await expect(updateUserTotpLastUsedStep(mockDb as any, 'user-1', 100)).resolves.toBe(true);
  });

  it('changes=0 表示已被其它请求占用，返回 false（应判为重放）', async () => {
    mockDb.run.mockResolvedValue({ meta: { changes: 0 } });
    await expect(updateUserTotpLastUsedStep(mockDb as any, 'user-1', 100)).resolves.toBe(false);
  });
});
