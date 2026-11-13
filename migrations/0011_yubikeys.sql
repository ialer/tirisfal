-- 0011: YubiKey OTP 两步验证
CREATE TABLE IF NOT EXISTS user_yubikeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_yubikeys_public_id ON user_yubikeys(public_id);
CREATE INDEX IF NOT EXISTS idx_user_yubikeys_user ON user_yubikeys(user_id);
