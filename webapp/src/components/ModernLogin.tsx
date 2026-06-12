import { useState } from 'preact/hooks';
import { Eye, EyeOff, Lock, Mail, User, ArrowRight } from 'lucide-preact';

interface ModernLoginProps {
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

// Modern Tirisfal Logo
function TirisfalLogo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="url(#logo-gradient)" stroke="var(--primary)" strokeWidth="2"/>
      <path d="M50 15 L80 30 L80 55 C80 70 65 82 50 88 C35 82 20 70 20 55 L20 30 Z" 
            fill="var(--bg-secondary)" stroke="var(--primary)" strokeWidth="1.5"/>
      <rect x="38" y="45" width="24" height="20" rx="3" fill="var(--primary)"/>
      <path d="M42 45 L42 38 C42 32 48 28 50 28 C52 28 58 32 58 38 L58 45" 
            stroke="var(--primary-hover)" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <circle cx="50" cy="53" r="3" fill="var(--bg-secondary)"/>
      <rect x="49" y="53" width="2" height="6" rx="1" fill="var(--bg-secondary)"/>
      <defs>
        <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--bg)"/>
          <stop offset="100%" stopColor="var(--bg-secondary)"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

// Input Field Component
function InputField({ 
  label, 
  type = 'text', 
  value, 
  onInput, 
  autoFocus, 
  autoComplete, 
  placeholder,
  icon: Icon 
}: {
  label: string;
  type?: string;
  value: string;
  onInput: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  placeholder?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <div style={{ position: 'relative' }}>
        {Icon && (
          <Icon 
            size={16} 
            className="input-icon"
            style={{ 
              position: 'absolute', 
              left: '12px', 
              top: '50%', 
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)'
            }} 
          />
        )}
        <input
          className="input"
          type={inputType}
          value={value}
          onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          placeholder={placeholder}
          style={{ paddingLeft: Icon ? '40px' : '12px' }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '4px'
            }}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ModernLogin(props: ModernLoginProps) {
  const loginBusy = props.pendingAction === 'login';
  const registerBusy = props.pendingAction === 'register';
  const unlockBusy = props.pendingAction === 'unlock';

  // Locked view
  if (props.mode === 'locked') {
    return (
      <div className="auth-page">
        <div className="auth-card fade-in">
          <div className="auth-logo">
            <TirisfalLogo size={64} />
          </div>
          <h1 className="auth-title">Tirisfal</h1>
          <p className="auth-subtitle">输入主密码解锁密码库</p>
          
          <form className="auth-form" onSubmit={(e) => { e.preventDefault(); props.onSubmitUnlock(); }}>
            <InputField
              label="主密码"
              type="password"
              value={props.unlockPassword}
              onInput={props.onChangeUnlock}
              autoFocus
              autoComplete="current-password"
              placeholder="输入您的主密码"
              icon={Lock}
            />
            
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={unlockBusy || !props.unlockPassword}
              style={{ width: '100%', padding: '12px' }}
            >
              {unlockBusy ? '解锁中...' : '解锁'}
              {!unlockBusy && <ArrowRight size={16} />}
            </button>
          </form>
          
          <div className="auth-footer">
            <button 
              type="button"
              className="btn btn-ghost"
              onClick={props.onLogout}
              style={{ fontSize: '0.875rem' }}
            >
              切换账号
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Login view
  if (props.mode === 'login') {
    return (
      <div className="auth-page">
        <div className="auth-card fade-in">
          <div className="auth-logo">
            <TirisfalLogo size={64} />
          </div>
          <h1 className="auth-title">欢迎回来</h1>
          <p className="auth-subtitle">登录 Tirisfal 管理您的凭证</p>
          
          <form className="auth-form" onSubmit={(e) => { e.preventDefault(); props.onSubmitLogin(); }}>
            <InputField
              label="邮箱"
              type="email"
              value={props.loginValues.email}
              onInput={(v) => props.onChangeLogin({ ...props.loginValues, email: v })}
              autoFocus
              autoComplete="email"
              placeholder="your@email.com"
              icon={Mail}
            />
            
            <InputField
              label="主密码"
              type="password"
              value={props.loginValues.password}
              onInput={(v) => props.onChangeLogin({ ...props.loginValues, password: v })}
              autoComplete="current-password"
              placeholder="输入您的主密码"
              icon={Lock}
            />
            
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={loginBusy || !props.loginValues.email || !props.loginValues.password}
              style={{ width: '100%', padding: '12px' }}
            >
              {loginBusy ? '登录中...' : '登录'}
              {!loginBusy && <ArrowRight size={16} />}
            </button>
          </form>
          
          <div className="auth-footer">
            还没有账号？{' '}
            <button 
              type="button"
              className="btn btn-ghost"
              onClick={props.onGotoRegister}
              style={{ padding: '0', fontSize: '0.875rem' }}
            >
              立即注册
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Register view
  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <div className="auth-logo">
          <TirisfalLogo size={64} />
        </div>
        <h1 className="auth-title">创建账号</h1>
        <p className="auth-subtitle">开始使用 Tirisfal 管理凭证</p>
        
        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); props.onSubmitRegister(); }}>
          <InputField
            label="用户名"
            value={props.registerValues.name}
            onInput={(v) => props.onChangeRegister({ ...props.registerValues, name: v })}
            autoFocus
            autoComplete="name"
            placeholder="您的名字"
            icon={User}
          />
          
          <InputField
            label="邮箱"
            type="email"
            value={props.registerValues.email}
            onInput={(v) => props.onChangeRegister({ ...props.registerValues, email: v })}
            autoComplete="email"
            placeholder="your@email.com"
            icon={Mail}
          />
          
          <InputField
            label="主密码"
            type="password"
            value={props.registerValues.password}
            onInput={(v) => props.onChangeRegister({ ...props.registerValues, password: v })}
            autoComplete="new-password"
            placeholder="至少12位字符"
            icon={Lock}
          />
          
          <InputField
            label="确认密码"
            type="password"
            value={props.registerValues.password2}
            onInput={(v) => props.onChangeRegister({ ...props.registerValues, password2: v })}
            autoComplete="new-password"
            placeholder="再次输入密码"
            icon={Lock}
          />
          
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={registerBusy}
            style={{ width: '100%', padding: '12px' }}
          >
            {registerBusy ? '注册中...' : '创建账号'}
            {!registerBusy && <ArrowRight size={16} />}
          </button>
        </form>
        
        <div className="auth-footer">
          已有账号？{' '}
          <button 
            type="button"
            className="btn btn-ghost"
            onClick={props.onGotoLogin}
            style={{ padding: '0', fontSize: '0.875rem' }}
          >
            立即登录
          </button>
        </div>
      </div>
      
      <div style={{ 
        position: 'fixed', 
        bottom: '24px', 
        left: '50%', 
        transform: 'translateX(-50%)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)'
      }}>
        Tirisfal © 2024 | <a href="https://github.com/ialer/tirisfal" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    </div>
  );
}
