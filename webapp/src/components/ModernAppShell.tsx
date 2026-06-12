import { useState } from 'preact/hooks';
import { 
  Shield, Key, Folder, Users, Settings, LogOut, 
  Moon, Sun, ChevronLeft, Menu, ExternalLink, Github
} from 'lucide-preact';

interface ModernAppShellProps {
  children: preact.ComponentChildren;
  currentRoute: string;
  onNavigate: (route: string) => void;
  onLogout: () => void;
  user?: { name?: string; email?: string };
}

// Logo Component
function TirisfalLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="url(#shell-gradient)" stroke="var(--primary)" strokeWidth="2"/>
      <path d="M50 15 L80 30 L80 55 C80 70 65 82 50 88 C35 82 20 70 20 55 L20 30 Z" 
            fill="var(--bg-secondary)" stroke="var(--primary)" strokeWidth="1.5"/>
      <rect x="38" y="45" width="24" height="20" rx="3" fill="var(--primary)"/>
      <path d="M42 45 L42 38 C42 32 48 28 50 28 C52 28 58 32 58 38 L58 45" 
            stroke="var(--primary-hover)" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <circle cx="50" cy="53" r="3" fill="var(--bg-secondary)"/>
      <rect x="49" y="53" width="2" height="6" rx="1" fill="var(--bg-secondary)"/>
      <defs>
        <linearGradient id="shell-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--bg)"/>
          <stop offset="100%" stopColor="var(--bg-secondary)"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

// Navigation items
const navItems = [
  { id: 'vault', label: '密码库', icon: Shield, route: '/vault' },
  { id: 'secrets', label: '凭证管理', icon: Key, route: '/secrets' },
  { id: 'folders', label: '文件夹', icon: Folder, route: '/vault' },
  { id: 'settings', label: '设置', icon: Settings, route: '/settings' },
];

export default function ModernAppShell({
  children,
  currentRoute,
  onNavigate,
  onLogout,
  user
}: ModernAppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.dataset.theme = newTheme;
  };

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <TirisfalLogo size={32} />
          {sidebarOpen && <span className="sidebar-brand">Tirisfal</span>}
        </div>
        
        {/* Navigation */}
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`sidebar-link ${currentRoute === item.route ? 'active' : ''}`}
              onClick={() => onNavigate(item.route)}
            >
              <item.icon size={18} />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        
        {/* Footer */}
        <div className="sidebar-footer">
          <div className="flex items-center gap-sm mb-md">
            <div style={{ 
              width: '32px', 
              height: '32px', 
              borderRadius: '50%', 
              background: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '14px',
              fontWeight: '600'
            }}>
              {user?.name?.[0] || user?.email?.[0] || 'U'}
            </div>
            {sidebarOpen && (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ 
                  fontSize: '14px', 
                  fontWeight: '500',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {user?.name || 'User'}
                </div>
                <div style={{ 
                  fontSize: '12px', 
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {user?.email || ''}
                </div>
              </div>
            )}
          </div>
          
          <div className="flex gap-sm">
            <button 
              className="btn btn-ghost btn-icon" 
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <a 
              href="https://github.com/ialer/tirisfal" 
              target="_blank" 
              rel="noopener noreferrer"
              className="btn btn-ghost btn-icon"
              title="GitHub"
            >
              <Github size={18} />
            </a>
            <button 
              className="btn btn-ghost btn-icon" 
              onClick={onLogout}
              title="退出登录"
              style={{ color: 'var(--danger)' }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="main-content">
        {/* Top Bar */}
        <header className="topbar">
          <div className="flex items-center gap-md">
            <button 
              className="btn btn-ghost btn-icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <ChevronLeft size={18} /> : <Menu size={18} />}
            </button>
            <h1 className="topbar-title">
              {navItems.find(n => n.route === currentRoute)?.label || 'Tirisfal'}
            </h1>
          </div>
          
          <div className="topbar-actions">
            <a
              href="https://github.com/ialer/tirisfal"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-icon"
              title="GitHub"
            >
              <Github size={18} />
            </a>
          </div>
        </header>
        
        {/* Page Content */}
        <div className="content">
          {children}
        </div>
      </main>
    </div>
  );
}
