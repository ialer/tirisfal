import type { User, UserDecryptionOptions } from '../types';

/** 标准化可选公钥值 */
function normalizeOptionalPublicKey(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

/**
 * 构建账户密钥对象
 * @param user - 用户对象（需包含 privateKey 和 publicKey）
 * @returns 账户密钥对象，无私钥则返回 null
 */
export function buildAccountKeys(
  user: Pick<User, 'privateKey' | 'publicKey'>
): Record<string, unknown> | null {
  if (!user.privateKey) {
    return null;
  }

  const publicKey = normalizeOptionalPublicKey(user.publicKey);

  return {
    publicKeyEncryptionKeyPair: {
      wrappedPrivateKey: user.privateKey,
      publicKey,
      Object: 'publicKeyEncryptionKeyPair',
    },
    Object: 'privateKeys',
  };
}

/**
 * 构建主密码解锁选项
 */
export function buildMasterPasswordUnlock(
  user: Pick<User, 'email' | 'key' | 'kdfType' | 'kdfIterations' | 'kdfMemory' | 'kdfParallelism'>
): UserDecryptionOptions['MasterPasswordUnlock'] {
  return {
    Kdf: {
      KdfType: user.kdfType,
      Iterations: user.kdfIterations,
      Memory: user.kdfMemory ?? null,
      Parallelism: user.kdfParallelism ?? null,
    },
    MasterKeyEncryptedUserKey: user.key,
    MasterKeyWrappedUserKey: user.key,
    Salt: user.email.toLowerCase(),
    Object: 'masterPasswordUnlock',
  };
}

/**
 * 构建用户解密选项（PascalCase 格式，用于桌面/浏览器客户端）
 */
export function buildUserDecryptionOptions(
  user: Pick<User, 'email' | 'key' | 'kdfType' | 'kdfIterations' | 'kdfMemory' | 'kdfParallelism'>
): UserDecryptionOptions {
  return {
    HasMasterPassword: true,
    Object: 'userDecryptionOptions',
    MasterPasswordUnlock: buildMasterPasswordUnlock(user),
    TrustedDeviceOption: null,
    KeyConnectorOption: null,
  };
}

/**
 * 构建用户解密选项兼容格式（camelCase，用于 Android 客户端）
 */
export function buildUserDecryptionCompat(
  user: Pick<User, 'email' | 'key' | 'kdfType' | 'kdfIterations' | 'kdfMemory' | 'kdfParallelism'>
): Record<string, unknown> {
  return {
    masterPasswordUnlock: {
      kdf: {
        kdfType: user.kdfType,
        iterations: user.kdfIterations,
        memory: user.kdfMemory ?? null,
        parallelism: user.kdfParallelism ?? null,
      },
      masterKeyWrappedUserKey: user.key,
      masterKeyEncryptedUserKey: user.key,
      salt: user.email.toLowerCase(),
    },
  };
}
