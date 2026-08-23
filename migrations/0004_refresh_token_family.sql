-- 刷新令牌家族追踪：支持重用检测与家族撤销
-- family_id: 同一会话轮换链上的所有令牌共享一个家族 ID
-- rotated_at: 该令牌被轮换（换发新令牌）的时间；宽限期外的重用视为盗用信号
ALTER TABLE refresh_tokens ADD COLUMN family_id TEXT;
ALTER TABLE refresh_tokens ADD COLUMN rotated_at INTEGER;
