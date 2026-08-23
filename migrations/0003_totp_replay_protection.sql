-- TOTP 防重放：记录每个用户最近成功使用的 TOTP timestep
-- 同一 timestep 的验证码只允许使用一次（窗口 ±1 内的重放将被拒绝）
ALTER TABLE users ADD COLUMN totp_last_used_step INTEGER;
