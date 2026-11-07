import { LIMITS } from '../config/limits';
import type { TokenResponse, User } from '../types';
import { buildAccountKeys, buildUserDecryptionOptions } from '../utils/user-decryption';

export interface UserTokenOptions {
  /** Web 会话：不回传 refresh_token（走 HttpOnly cookie） */
  webSession: boolean;
  /** 需要回传的 refresh token（非 Web 会话） */
  refreshToken?: string;
  /** 可信设备 2FA：登录成功时回传一次性令牌 */
  twoFactorToken?: string;
}

/**
 * 统一的用户令牌响应构造。
 *
 * 旧实现把同一份 30 字段载荷在 login / refresh / client_credentials 三处各写一遍，
 * 新增字段漏改一处就会让某条客户端链路静默缺字段。
 */
export function buildUserTokenResponse(
  user: User,
  accessToken: string,
  options: UserTokenOptions
): TokenResponse {
  const accountKeys = buildAccountKeys(user);
  const userDecryptionOptions = buildUserDecryptionOptions(user);

  return {
    access_token: accessToken,
    expires_in: LIMITS.auth.accessTokenTtlSeconds,
    token_type: 'Bearer',
    ...(options.webSession
      ? { web_session: true }
      : options.refreshToken
        ? { refresh_token: options.refreshToken }
        : {}),
    ...(options.twoFactorToken ? { TwoFactorToken: options.twoFactorToken } : {}),
    Key: user.key,
    PrivateKey: user.privateKey,
    AccountKeys: accountKeys,
    accountKeys: accountKeys,
    Kdf: user.kdfType,
    KdfIterations: user.kdfIterations,
    KdfMemory: user.kdfMemory,
    KdfParallelism: user.kdfParallelism,
    ForcePasswordReset: false,
    ResetMasterPassword: false,
    MasterPasswordPolicy: {
      Object: 'masterPasswordPolicy',
    },
    ApiUseKeyConnector: false,
    scope: 'api offline_access',
    unofficialServer: true,
    UserDecryptionOptions: userDecryptionOptions,
    userDecryptionOptions: userDecryptionOptions,
  };
}
