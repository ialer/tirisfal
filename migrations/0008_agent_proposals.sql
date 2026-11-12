-- 0008: Agent 提议入库（AI 生成/获取的凭证，等待人类在客户端确认后写入密码库）
-- value 使用服务端 ENCRYPTION_KEY（v3 格式）加密；人类确认后由浏览器端重新用主密钥加密成 cipher
CREATE TABLE IF NOT EXISTS agent_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  machine_account_id TEXT,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'prod',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES sm_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (machine_account_id) REFERENCES machine_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_user ON agent_proposals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_expires ON agent_proposals(expires_at);
