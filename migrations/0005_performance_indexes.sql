-- 审计与授权反查性能索引（对应 Issue #5 工程质量项）
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_secret_access_logs_machine_account ON secret_access_logs(machine_account_id);
CREATE INDEX IF NOT EXISTS idx_secret_access_logs_user ON secret_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_machine_account_projects_project ON machine_account_projects(project_id);
