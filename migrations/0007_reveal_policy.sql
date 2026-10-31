-- 0007: 凭证读取默认掩码 + 一次性 reveal（P2）
-- reveal_limit: 允许的显式 reveal 次数（NULL = 不限次）
-- reveal_count: 已消耗的 reveal 次数
ALTER TABLE machine_account_projects ADD COLUMN reveal_limit INTEGER;
ALTER TABLE machine_account_projects ADD COLUMN reveal_count INTEGER NOT NULL DEFAULT 0;
