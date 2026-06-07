import { useState } from 'preact/hooks';
import { Eye, EyeOff, LogIn, UserPlus, ArrowLeft, KeyRound } from 'lucide-preact';
import { t } from '@/lib/i18n';

interface TirisfalLoginProps {
  mode: 'login' | 'register' | 'locked';
  loginValues: { email: string; password: string };
  registerValues: { name: string; email: string; password: string; password2: string; passwordHint: string; inviteCode: string };
  unlockPassword: string;
  emailForLock: string;
  onChangeLogin: (values: { email: string; password: string }) => void;
  onChangeRegister: (values: { name: string; email: string; password: string; password2: string; passwordHint: string; inviteCode: string }) => void;
  onChangeUnlock: (password: string) => void;
  onSubmitLogin: () => void;
  onSubmitRegister: () => void;
  onSubmitUnlock: () => void;
  onGotoLogin: () => void;
  onGotoRegister: () => void;
  onLogout: () => void;
  pendingAction: 'login' | 'register' | 'unlock' | null;
}

// Modern Tirisfal Logo Component
function TirisfalLogo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background circle */}
      <circle cx="50" cy="50" r="48" fill="url(#gradient)" stroke="#3b82f6" strokeWidth="2"/>
      
      {/* Shield shape */}
      <path d="M50 15 L80 30 L80 55 C80 70 65 82 50 88 C35 82 20 70 20 55 L20 30 Z" 
            fill="#1e293b" stroke="#3b82f6" strokeWidth="1.5"/>
      
      {/* Lock body */}
      <rect x="38" y="45" width="24" height="20" rx="3" fill="#3b82f6"/>
      
      {/* Lock shackle */}
      <path d="M42 45 L42 38 C42 32 48 28 50 28 C52 28 58 32 58 38 L58 45" 
            stroke="#60a5fa" strokeWidth="3" fill="none" strokeLinecap="round"/>
      
      {/* Keyhole */}
      <circle cx="50" cy="53" r="3" fill="#1e293b"/>
      <rect x="49" y="53" width="2" height="6" rx="1" fill="#1e293b"/>
      
      {/* Gradient definition */}
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f172a"/>
          <stop offset="100%" stopColor="#1e293b"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

// Password Field Component
function PasswordField({ label, value, onInput, autoFocus, autoComplete, placeholder }: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="tf-field">
      <label className="tf-label">{label}</label>
      <div className="tf-input-wrap">
        <KeyRound size={16} className="tf-input-icon" />
        <input
          className="tf-input"
          type={show ? 'text' : 'password'}
          value={value}
          onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
        <button type="button" className="tf-eye-btn" onClick={() => setShow((v) => !v)}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

export default function TirisfalLogin(props: TirisfalLoginProps) {
  const loginBusy = props.pendingAction === 'login';
  const registerBusy = props.pendingAction === 'register';
  const unlockBusy = props.pendingAction === 'unlock';

  // Locked/Unlock view
  if (props.mode === 'locked') {
    return (
      <div className="tf-auth-page">
        <div className="tf-auth-container">
          <div className="tf-auth-card">
            <div className="tf-auth-header">
              <TirisfalLogo size={56} />
              <h1 className="tf-auth-title">{t('txt_unlock_vault')}</h1>
              <p className="tf-auth-subtitle">{props.emailForLock}</p>
            </div>
            
            <form onSubmit={(e) => { e.preventDefault(); props.onSubmitUnlock(); }}>
              <input type="text" value={props.emailForLock} readOnly hidden tabIndex={-1} />
              
              <PasswordField
                label={t('txt_master_password')}
                value={props.unlockPassword}
                autoFocus
                autoComplete="current-password"
                onInput={props.onChangeUnlock}
              />
              
              <button type="submit" className="tf-btn tf-btn-primary tf-btn-full" disabled={unlockBusy}>
                {unlockBusy ? (
                  <span className="tf-loading" />
                ) : (
                  <>
                    <KeyRound size={16} />
                    {t('txt_unlock')}
                  </>
                )}
              </button>
              
              <div className="tf-divider">
                <span>{t('txt_or')}</span>
              </div>
              
              <button type="button" className="tf-btn tf-btn-secondary tf-btn-full" onClick={props.onLogout} disabled={unlockBusy}>
                {t('txt_log_out')}
              </button>
            </form>
          </div>
          
          <div className="tf-auth-footer">
            <a href="https://github.com/ialer/tirisfal" target="_blank" rel="noreferrer">
              Tirisfal v1.5.1
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Register view
  if (props.mode === 'register') {
    return (
      <div className="tf-auth-page">
        <div className="tf-auth-container">
          <div className="tf-auth-card">
            <div className="tf-auth-header">
              <TirisfalLogo size={56} />
              <h1 className="tf-auth-title">{t('txt_create_account')}</h1>
              <p className="tf-auth-subtitle">开始使用 Tirisfal</p>
            </div>
            
            <form onSubmit={(e) => { e.preventDefault(); props.onSubmitRegister(); }}>
              <div className="tf-field">
                <label className="tf-label">{t('txt_name')}</label>
                <div className="tf-input-wrap">
                  <input
                    className="tf-input"
                    value={props.registerValues.name}
                    autoComplete="name"
                    placeholder="输入您的名称"
                    onInput={(e) => props.onChangeRegister({ ...props.registerValues, name: (e.currentTarget as HTMLInputElement).value })}
                  />
                </div>
              </div>
              
              <div className="tf-field">
                <label className="tf-label">{t('txt_email')}</label>
                <div className="tf-input-wrap">
                  <input
                    className="tf-input"
                    type="email"
                    value={props.registerValues.email}
                    autoComplete="email"
                    placeholder="输入您的邮箱"
                    onInput={(e) => props.onChangeRegister({ ...props.registerValues, email: (e.currentTarget as HTMLInputElement).value })}
                  />
                </div>
              </div>
              
              <PasswordField
                label={t('txt_master_password')}
                value={props.registerValues.password}
                autoComplete="new-password"
                placeholder="设置主密码"
                onInput={(v) => props.onChangeRegister({ ...props.registerValues, password: v })}
              />
              
              <PasswordField
                label={t('txt_confirm_master_password')}
                value={props.registerValues.password2}
                autoComplete="new-password"
                placeholder="确认主密码"
                onInput={(v) => props.onChangeRegister({ ...props.registerValues, password2: v })}
              />
              
              <div className="tf-field">
                <label className="tf-label">{t('txt_password_hint_optional')}</label>
                <div className="tf-input-wrap">
                  <input
                    className="tf-input"
                    maxLength={120}
                    value={props.registerValues.passwordHint}
                    placeholder="密码提示（可选）"
                    onInput={(e) => props.onChangeRegister({ ...props.registerValues, passwordHint: (e.currentTarget as HTMLInputElement).value })}
                  />
                </div>
              </div>
              
              <button type="submit" className="tf-btn tf-btn-primary tf-btn-full" disabled={registerBusy}>
                {registerBusy ? (
                  <span className="tf-loading" />
                ) : (
                  <>
                    <UserPlus size={16} />
                    {t('txt_create_account')}
                  </>
                )}
              </button>
              
              <div className="tf-divider">
                <span>{t('txt_or')}</span>
              </div>
              
              <button type="button" className="tf-btn tf-btn-ghost tf-btn-full" onClick={props.onGotoLogin} disabled={registerBusy}>
                <ArrowLeft size={16} />
                {t('txt_back_to_login')}
              </button>
            </form>
          </div>
          
          <div className="tf-auth-footer">
            <a href="https://github.com/ialer/tirisfal" target="_blank" rel="noreferrer">
              Tirisfal v1.5.1
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Login view (default)
  return (
    <div className="tf-auth-page">
      <div className="tf-auth-container">
        <div className="tf-auth-card">
          <div className="tf-auth-header">
            <TirisfalLogo size={56} />
            <h1 className="tf-auth-title">{t('txt_log_in')}</h1>
            <p className="tf-auth-subtitle">欢迎回来</p>
          </div>
          
          <form onSubmit={(e) => { e.preventDefault(); props.onSubmitLogin(); }}>
            <div className="tf-field">
              <label className="tf-label">{t('txt_email')}</label>
              <div className="tf-input-wrap">
                <input
                  className="tf-input"
                  type="email"
                  value={props.loginValues.email}
                  autoComplete="username"
                  placeholder="输入您的邮箱"
                  autoFocus
                  onInput={(e) => props.onChangeLogin({ ...props.loginValues, email: (e.currentTarget as HTMLInputElement).value })}
                />
              </div>
            </div>
            
            <PasswordField
              label={t('txt_master_password')}
              value={props.loginValues.password}
              autoComplete="current-password"
              placeholder="输入主密码"
              onInput={(v) => props.onChangeLogin({ ...props.loginValues, password: v })}
            />
            
            <button type="submit" className="tf-btn tf-btn-primary tf-btn-full" disabled={loginBusy}>
              {loginBusy ? (
                <span className="tf-loading" />
              ) : (
                <>
                  <LogIn size={16} />
                  {t('txt_log_in')}
                </>
              )}
            </button>
            
            <div className="tf-divider">
              <span>{t('txt_or')}</span>
            </div>
            
            <button type="button" className="tf-btn tf-btn-ghost tf-btn-full" onClick={props.onGotoRegister} disabled={loginBusy}>
              <UserPlus size={16} />
              {t('txt_create_account')}
            </button>
          </form>
        </div>
        
        <div className="tf-auth-footer">
          <a href="https://github.com/ialer/tirisfal" target="_blank" rel="noreferrer">
            Tirisfal v1.5.1
          </a>
        </div>
      </div>
    </div>
  );
}
