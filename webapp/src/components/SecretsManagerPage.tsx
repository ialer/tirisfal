import { useState, useEffect } from 'preact/hooks';
import { Shield, Key, Folder, Plus, Trash2, RefreshCw, Copy, Check, Eye, EyeOff, Zap, Search } from 'lucide-preact';
import { t } from '@/lib/i18n';

interface MachineAccount {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface Secret {
  id: string;
  name: string;
  value: string;
  project_id: string;
  environment: string;
  created_at: string;
}

interface SecretsManagerProps {
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

type TabType = 'accounts' | 'projects' | 'secrets';

export default function SecretsManagerPage(props: SecretsManagerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('accounts');
  const [accounts, setAccounts] = useState<MachineAccount[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [selectedToken, setSelectedToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountDesc, setNewAccountDesc] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [newSecretProject, setNewSecretProject] = useState('');
  const [newSecretEnv, setNewSecretEnv] = useState('prod');
  const [showSecretValue, setShowSecretValue] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [accountsRes, projectsRes] = await Promise.all([
        props.authedFetch('/api/machine-accounts'),
        props.authedFetch('/api/projects'),
      ]);

      if (accountsRes.ok) {
        const accountsData = await accountsRes.json();
        setAccounts(accountsData.data || []);
      }

      if (projectsRes.ok) {
        const projectsData = await projectsRes.json();
        setProjects(projectsData.data || []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
    setLoading(false);
  }

  async function createAccount() {
    if (!newAccountName) return;
    try {
      const res = await props.authedFetch('/api/machine-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAccountName, description: newAccountDesc }),
      });
      if (res.ok) {
        setNewAccountName('');
        setNewAccountDesc('');
        setShowCreateModal(false);
        loadData();
      }
    } catch (error) {
      console.error('Failed to create account:', error);
    }
  }

  async function deleteAccount(accountId: string) {
    try {
      const res = await props.authedFetch(`/api/machine-accounts/${accountId}`, { method: 'DELETE' });
      if (res.ok) loadData();
    } catch (error) {
      console.error('Failed to delete account:', error);
    }
  }

  async function generateToken(accountId: string) {
    try {
      const res = await props.authedFetch(`/api/machine-accounts/${accountId}/token`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSelectedToken(data.access_token);
        setShowTokenModal(true);
      }
    } catch (error) {
      console.error('Failed to generate token:', error);
    }
  }

  async function createProject() {
    if (!newProjectName) return;
    try {
      const res = await props.authedFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName, description: newProjectDesc }),
      });
      if (res.ok) {
        setNewProjectName('');
        setNewProjectDesc('');
        setShowCreateModal(false);
        loadData();
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  }

  async function deleteProject(projectId: string) {
    try {
      const res = await props.authedFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok) loadData();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  }

  async function createSecret() {
    if (!newSecretName || !newSecretValue || !newSecretProject) return;
    try {
      const res = await props.authedFetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSecretName,
          value: newSecretValue,
          project_id: newSecretProject,
          environment: newSecretEnv,
        }),
      });
      if (res.ok) {
        setNewSecretName('');
        setNewSecretValue('');
        setNewSecretProject('');
        setShowCreateModal(false);
        loadSecrets(newSecretProject);
      }
    } catch (error) {
      console.error('Failed to create secret:', error);
    }
  }

  async function deleteSecret(secretId: string) {
    try {
      const res = await props.authedFetch(`/api/secrets/${secretId}`, { method: 'DELETE' });
      if (res.ok && newSecretProject) loadSecrets(newSecretProject);
    } catch (error) {
      console.error('Failed to delete secret:', error);
    }
  }

  async function loadSecrets(projectId: string) {
    if (!projectId) { setSecrets([]); return; }
    try {
      const res = await props.authedFetch(`/api/secrets?project_id=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setSecrets(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load secrets:', error);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function maskValue(value: string) {
    if (value.length <= 8) return '****';
    return value.substring(0, 4) + '****' + value.substring(value.length - 4);
  }

  const filteredAccounts = accounts.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredProjects = projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredSecrets = secrets.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const tabConfig: Array<{ key: TabType; icon: typeof Shield; label: string }> = [
    { key: 'accounts', icon: Shield, label: t('nav_machine_accounts') || '机器账户' },
    { key: 'projects', icon: Folder, label: t('nav_projects') || '项目' },
    { key: 'secrets', icon: Key, label: t('nav_secrets') || '密钥' },
  ];

  return (
    <div className="content">
      <div className="secrets-header" style={{ marginBottom: '24px' }}>
        <div>
          <h2 style={{ marginBottom: '4px' }}>Secrets Manager</h2>
          <p className="text-sm text-muted">管理 Agent 凭证与访问权限</p>
        </div>
        <div className="flex items-center gap-md">
          <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            {t('txt_refresh') || '刷新'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
            {activeTab === 'accounts' && '创建账户'}
            {activeTab === 'projects' && '创建项目'}
            {activeTab === 'secrets' && '创建密钥'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-md mb-lg">
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            placeholder="搜索..."
            style={{ paddingLeft: '40px' }}
          />
        </div>
        <div className="flex gap-sm">
          {tabConfig.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              className={`btn ${activeTab === key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab(key)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card text-center" style={{ padding: '48px' }}>
          <RefreshCw size={24} className="spin" style={{ margin: '0 auto 16px', color: 'var(--text-muted)' }} />
          <p className="text-muted">{t('txt_loading') || '加载中...'}</p>
        </div>
      ) : (
        <>
          {activeTab === 'accounts' && (
            filteredAccounts.length === 0 ? (
              <div className="card text-center" style={{ padding: '48px' }}>
                <Shield size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
                <h3 style={{ marginBottom: '8px' }}>暂无机器账户</h3>
                <p className="text-muted">创建一个机器账户来让 Agent 访问凭证</p>
              </div>
            ) : (
              <div className="card-grid">
                {filteredAccounts.map((account) => (
                  <div key={account.id} className="card slide-up">
                    <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
                      <div className="flex items-center gap-sm">
                        <Shield size={16} style={{ color: 'var(--primary)' }} />
                        <span style={{ fontWeight: 600 }}>{account.name}</span>
                      </div>
                      <span className={`badge ${account.status === 'active' ? 'badge-primary' : 'badge-muted'}`}>
                        {account.status === 'active' ? '活跃' : '禁用'}
                      </span>
                    </div>
                    <div className="text-sm text-muted" style={{ marginBottom: '12px' }}>
                      创建于 {new Date(account.created_at).toLocaleDateString('zh-CN')}
                    </div>
                    <div className="flex gap-sm">
                      <button className="btn btn-secondary btn-sm" onClick={() => generateToken(account.id)}>
                        <Key size={14} />
                        生成 Token
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteAccount(account.id)} style={{ color: 'var(--danger)' }}>
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'projects' && (
            filteredProjects.length === 0 ? (
              <div className="card text-center" style={{ padding: '48px' }}>
                <Folder size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
                <h3 style={{ marginBottom: '8px' }}>暂无项目</h3>
                <p className="text-muted">创建一个项目来组织凭证</p>
              </div>
            ) : (
              <div className="card-grid">
                {filteredProjects.map((project) => (
                  <div
                    key={project.id}
                    className="card slide-up"
                    style={{ cursor: 'pointer' }}
                    onClick={() => { setActiveTab('secrets'); setNewSecretProject(project.id); loadSecrets(project.id); }}
                  >
                    <div className="flex items-center gap-sm" style={{ marginBottom: '8px' }}>
                      <Folder size={16} style={{ color: 'var(--primary)' }} />
                      <span style={{ fontWeight: 600 }}>{project.name}</span>
                    </div>
                    {project.description && (
                      <p className="text-sm text-muted" style={{ marginBottom: '8px' }}>{project.description}</p>
                    )}
                    <div className="text-sm text-muted">
                      创建于 {new Date(project.created_at).toLocaleDateString('zh-CN')}
                    </div>
                    <div className="flex gap-sm" style={{ marginTop: '12px' }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteProject(project.id)} style={{ color: 'var(--danger)' }}>
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'secrets' && (
            <>
              <div className="flex items-center gap-md mb-lg">
                <select
                  className="input"
                  value={newSecretProject}
                  onChange={(e) => {
                    const projectId = (e.target as HTMLSelectElement).value;
                    setNewSecretProject(projectId);
                    loadSecrets(projectId);
                  }}
                  style={{ width: '240px' }}
                >
                  <option value="">选择项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {filteredSecrets.length === 0 ? (
                <div className="card text-center" style={{ padding: '48px' }}>
                  <Key size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
                  <h3 style={{ marginBottom: '8px' }}>暂无密钥</h3>
                  <p className="text-muted">{newSecretProject ? '点击"创建密钥"开始添加' : '请先选择一个项目'}</p>
                </div>
              ) : (
                <div className="card-grid">
                  {filteredSecrets.map((secret) => (
                    <div key={secret.id} className="card slide-up">
                      <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                        <div className="flex items-center gap-sm">
                          <Key size={16} style={{ color: 'var(--primary)' }} />
                          <span style={{ fontWeight: 600 }}>{secret.name}</span>
                        </div>
                        <span className="badge badge-primary">{secret.environment}</span>
                      </div>
                      <div className="flex items-center gap-sm" style={{ marginBottom: '8px' }}>
                        <code style={{ flex: 1, fontSize: '13px', wordBreak: 'break-all' }}>
                          {showSecretValue ? secret.value : maskValue(secret.value)}
                        </code>
                        <button className="btn btn-ghost btn-icon" onClick={() => setShowSecretValue(!showSecretValue)}>
                          {showSecretValue ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(secret.value)}>
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted">
                          {new Date(secret.created_at).toLocaleDateString('zh-CN')}
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={() => deleteSecret(secret.id)} style={{ color: 'var(--danger)' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {showCreateModal && (
        <div className="dialog-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="dialog slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3 className="dialog-title">
                {activeTab === 'accounts' && '创建机器账户'}
                {activeTab === 'projects' && '创建项目'}
                {activeTab === 'secrets' && '创建密钥'}
              </h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowCreateModal(false)}>×</button>
            </div>

            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {activeTab === 'accounts' && (
                <>
                  <div className="input-group">
                    <label className="input-label">名称</label>
                    <input
                      className="input"
                      value={newAccountName}
                      onInput={(e) => setNewAccountName((e.target as HTMLInputElement).value)}
                      placeholder="例如: my-agent"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">描述（可选）</label>
                    <input
                      className="input"
                      value={newAccountDesc}
                      onInput={(e) => setNewAccountDesc((e.target as HTMLInputElement).value)}
                      placeholder="可选描述"
                    />
                  </div>
                </>
              )}

              {activeTab === 'projects' && (
                <>
                  <div className="input-group">
                    <label className="input-label">名称</label>
                    <input
                      className="input"
                      value={newProjectName}
                      onInput={(e) => setNewProjectName((e.target as HTMLInputElement).value)}
                      placeholder="例如: production"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">描述（可选）</label>
                    <input
                      className="input"
                      value={newProjectDesc}
                      onInput={(e) => setNewProjectDesc((e.target as HTMLInputElement).value)}
                      placeholder="可选描述"
                    />
                  </div>
                </>
              )}

              {activeTab === 'secrets' && (
                <>
                  <div className="input-group">
                    <label className="input-label">名称</label>
                    <input
                      className="input"
                      value={newSecretName}
                      onInput={(e) => setNewSecretName((e.target as HTMLInputElement).value)}
                      placeholder="例如: API_KEY"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">值</label>
                    <input
                      className="input"
                      type="password"
                      value={newSecretValue}
                      onInput={(e) => setNewSecretValue((e.target as HTMLInputElement).value)}
                      placeholder="输入凭证值"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">项目</label>
                    <select
                      className="input"
                      value={newSecretProject}
                      onChange={(e) => setNewSecretProject((e.target as HTMLSelectElement).value)}
                    >
                      <option value="">选择项目</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label className="input-label">环境</label>
                    <select
                      className="input"
                      value={newSecretEnv}
                      onChange={(e) => setNewSecretEnv((e.target as HTMLSelectElement).value)}
                    >
                      <option value="prod">生产环境</option>
                      <option value="dev">开发环境</option>
                      <option value="staging">测试环境</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="dialog-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>取消</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (activeTab === 'accounts') createAccount();
                  if (activeTab === 'projects') createProject();
                  if (activeTab === 'secrets') createSecret();
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {showTokenModal && (
        <div className="dialog-overlay" onClick={() => setShowTokenModal(false)}>
          <div className="dialog slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3 className="dialog-title">Access Token 已生成</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowTokenModal(false)}>×</button>
            </div>
            <div className="dialog-body">
              <div className="flex items-center gap-sm" style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', marginBottom: '12px' }}>
                <code style={{ flex: 1, fontSize: '13px', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>{selectedToken}</code>
                <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(selectedToken)}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <p className="text-sm" style={{ color: 'var(--warning)' }}>
                请保存此 Token，它不会再次显示。Agent 使用此 Token 访问凭证。
              </p>
            </div>
            <div className="dialog-footer">
              <button className="btn btn-primary" onClick={() => setShowTokenModal(false)}>确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
