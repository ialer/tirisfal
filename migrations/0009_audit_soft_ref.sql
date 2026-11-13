-- 0009: 审计日志与 secret 解耦（删除凭证后保留删除审计）
-- 原表 secret_id NOT NULL + ON DELETE CASCADE：删除 secret 时审计被一并删掉，
-- 且删除后再写 'delete' 审计会因外键失败返回 500。
CREATE TABLE IF NOT EXISTS secret_access_logs_new (
  id TEXT PRIMARY KEY,
  machine_account_id TEXT,
  user_id TEXT,
  secret_id TEXT,
  action TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (secret_id) REFERENCES secrets(id) ON DELETE SET NULL
);

INSERT INTO secret_access_logs_new
  (id, machine_account_id, user_id, secret_id, action, ip_address, user_agent, metadata, created_at)
SELECT id, machine_account_id, user_id, secret_id, action, ip_address, user_agent, metadata, created_at
FROM secret_access_logs;

DROP TABLE secret_access_logs;
ALTER TABLE secret_access_logs_new RENAME TO secret_access_logs;

CREATE INDEX IF NOT EXISTS idx_secret_access_logs_secret ON secret_access_logs(secret_id);
CREATE INDEX IF NOT EXISTS idx_secret_access_logs_created ON secret_access_logs(created_at);
