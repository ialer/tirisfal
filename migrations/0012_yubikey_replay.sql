-- 0012: YubiKey 本地防重放（YubiCloud 已一次性校验，这里是自建校验器/异常情况的兜底）
ALTER TABLE user_yubikeys ADD COLUMN last_otp_hash TEXT;
