-- Secrets Manager tables
-- These tables support the AI Agent Secrets Manager functionality

CREATE TABLE IF NOT EXISTS machine_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  access_token_hash TEXT,
  access_token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_machine_accounts_user ON machine_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_machine_accounts_token ON machine_accounts(access_token_hash);

CREATE TABLE IF NOT EXISTS sm_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sm_projects_user ON sm_projects(user_id);

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'prod',
  note TEXT,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES sm_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_secrets_project ON secrets(project_id);
CREATE INDEX IF NOT EXISTS idx_secrets_name_project ON secrets(name, project_id, environment);

CREATE TABLE IF NOT EXISTS machine_account_projects (
  machine_account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'read',
  allowed_ip TEXT,
  allowed_hours TEXT,
  max_requests_per_minute INTEGER,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (machine_account_id, project_id),
  FOREIGN KEY (machine_account_id) REFERENCES machine_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES sm_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS secret_access_logs (
  id TEXT PRIMARY KEY,
  machine_account_id TEXT,
  user_id TEXT,
  secret_id TEXT NOT NULL,
  action TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (secret_id) REFERENCES secrets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_secret_access_logs_secret ON secret_access_logs(secret_id);
CREATE INDEX IF NOT EXISTS idx_secret_access_logs_created ON secret_access_logs(created_at);
