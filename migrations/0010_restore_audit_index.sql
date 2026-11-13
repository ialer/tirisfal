-- 0010: 恢复 0009 重建表时丢掉的 user_id 索引（v1.6.3 → v1.6.4）
CREATE INDEX IF NOT EXISTS idx_secret_access_logs_user ON secret_access_logs(user_id);
-- v1.6.2 的 0009 漏了 host/purpose 列；该版本从未部署，若确有存量库请按发布说明重建数据卷。
