import { useEffect, useState } from 'preact/hooks';
import { KeyRound } from 'lucide-preact';

import {
  addYubikey,
  deleteYubikey,
  deriveLoginHashLocally,
  listYubikeys,
  type YubikeyInfo,
} from '@/lib/api/auth';
import { t } from '@/lib/i18n';

interface Props {
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  email: string;
  onNotify?: (type: 'success' | 'error', text: string) => void;
}

/** YubiKey OTP 绑定/解绑。密码只在浏览器里派生 masterPasswordHash，不发送明文。 */
export default function YubikeySettings({ authedFetch, email, onNotify }: Props) {
  const [keys, setKeys] = useState<YubikeyInfo[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  const load = async () => {
    try {
      const res = await listYubikeys(authedFetch);
      setKeys(res.data);
      setEnabled(res.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const bind = async () => {
    setBusy(true);
    setError('');
    try {
      const { hash } = await deriveLoginHashLocally(email, password, 600000);
      const result = await addYubikey(authedFetch, hash, otp.trim(), name.trim());
      setOtp('');
      setName('');
      setPassword('');
      if (result.recoveryCode) setRecoveryCode(result.recoveryCode);
      await load();
      onNotify?.('success', t('yubikey_bound') || 'YubiKey 已绑定');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bind failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const { hash } = await deriveLoginHashLocally(email, password, 600000);
      await deleteYubikey(authedFetch, id, hash);
      setPassword('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'remove failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card settings-module">
      <h3>
        <KeyRound size={16} /> {t('yubikey_title') || 'YubiKey（物理钥匙）'}
      </h3>
      {!enabled ? (
        <p className="text-muted">{t('yubikey_disabled') || '服务端未配置 YubiCloud，暂不可用'}</p>
      ) : (
        <>
          {keys.length > 0 ? (
            <ul className="list">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between">
                  <span>
                    {k.name || t('yubikey_unnamed') || '未命名'} · {k.publicId}
                  </span>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={() => void remove(k.id)}
                  >
                    {t('yubikey_remove') || '解绑'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t('yubikey_empty') || '尚未绑定 YubiKey'}</p>
          )}

          <div className="actions" style={{ marginTop: '12px' }}>
            <input
              className="input"
              placeholder={t('yubikey_name') || '名称（可选）'}
              value={name}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            />
            <input
              className="input"
              placeholder={t('yubikey_otp') || '按一下钥匙，粘贴 44 位 OTP'}
              value={otp}
              autoComplete="one-time-code"
              onInput={(e) => setOtp((e.currentTarget as HTMLInputElement).value)}
            />
            <input
              className="input"
              type="password"
              placeholder={t('yubikey_password') || '主密码（确认操作）'}
              value={password}
              onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
            />
            <button
              className="btn btn-primary"
              disabled={busy || !otp || !password}
              onClick={() => void bind()}
            >
              {t('yubikey_bind') || '绑定'}
            </button>
          </div>
          {error ? <div className="status-error">{error}</div> : null}
          {recoveryCode ? (
            <div className="status-ok" style={{ marginTop: '8px' }}>
              {t('yubikey_recovery_once') || '请立即保存恢复码（只显示一次）'}:{' '}
              <code>{recoveryCode}</code>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
