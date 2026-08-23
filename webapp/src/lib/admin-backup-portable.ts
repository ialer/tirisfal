import { base64ToBytes, decryptBw, toBufferSource } from './crypto';
import type { AdminBackupSettings, BackupSettingsPortablePayload } from './api/backup';
import type { Profile, SessionState } from './types';

const PORTABLE_ALGORITHM = 'RSA-OAEP';
// 服务端新写入的 wrap 使用 SHA-256；存量 wrap 为 SHA-1。
// 解密时先试 SHA-256 再回退 SHA-1，保证新旧备份设置都可恢复。
const PORTABLE_HASHES = ['SHA-256', 'SHA-1'];
const AES_GCM_ALGORITHM = 'AES-GCM';

async function importPortableAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toBufferSource(keyBytes), { name: AES_GCM_ALGORITHM }, false, ['decrypt']);
}

export async function decryptPortableBackupSettings(
  portable: BackupSettingsPortablePayload,
  profile: Profile,
  session: SessionState
): Promise<AdminBackupSettings> {
  if (!profile.id) {
    throw new Error('Current administrator profile is missing an id');
  }
  if (!profile.privateKey) {
    throw new Error('Current administrator profile is missing a private key');
  }
  if (!session.symEncKey || !session.symMacKey) {
    throw new Error('Current session is missing unlocked vault keys');
  }

  const wrap = portable.wraps.find((entry) => entry.userId === profile.id);
  if (!wrap) {
    throw new Error('No portable backup settings wrap is available for the current administrator');
  }

  const privateKeyBytes = await decryptBw(
    profile.privateKey,
    base64ToBytes(session.symEncKey),
    base64ToBytes(session.symMacKey)
  );
  let portableDek: Uint8Array | null = null;
  for (const hash of PORTABLE_HASHES) {
    try {
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        toBufferSource(privateKeyBytes),
        { name: PORTABLE_ALGORITHM, hash },
        false,
        ['decrypt']
      );
      portableDek = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: PORTABLE_ALGORITHM },
          privateKey,
          toBufferSource(base64ToBytes(wrap.wrappedKey))
        )
      );
      break;
    } catch {
      // 尝试下一个 hash（SHA-256 失败则回退 SHA-1）
    }
  }
  if (!portableDek) {
    throw new Error('Failed to unwrap portable backup settings key with any supported OAEP hash');
  }
  const aesKey = await importPortableAesKey(portableDek);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: AES_GCM_ALGORITHM, iv: toBufferSource(base64ToBytes(portable.iv)) },
      aesKey,
      toBufferSource(base64ToBytes(portable.ciphertext))
    )
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as AdminBackupSettings;
}
