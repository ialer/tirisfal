-- 0006: Secrets Manager 凭证注入（P1）
-- grant 增加注入模式与目标主机白名单；审计增加 host/purpose
ALTER TABLE machine_account_projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'inject';
ALTER TABLE machine_account_projects ADD COLUMN allowed_hosts TEXT;
ALTER TABLE secret_access_logs ADD COLUMN host TEXT;
ALTER TABLE secret_access_logs ADD COLUMN purpose TEXT;
