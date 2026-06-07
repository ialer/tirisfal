import { useState, useEffect } from 'preact/hooks';
import { Shield, Key, Folder, Plus, Trash2, RefreshCw, Copy, Check, Eye, EyeOff, Zap } from 'lucide-preact';
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

export default function SecretsManagerPage(props: SecretsManagerProps) {
  const [activeTab, setActiveTab] = useState<'accounts' | 'projects' | 'secrets'>('accounts');
  const [accounts, setAccounts] = useState<MachineAccount[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [selectedToken, setSelectedToken] = useState('');
  const [copied, setCopied] = useState(false);

  // Form states
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

  async function generateToken(accountId: string) {
    try {
      const res = await props.authedFetch(`/api/machine-accounts/${accountId}/token`, {
        method: 'POST',
      });

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

  async function loadSecrets(projectId: string) {
    if (!projectId) {
      setSecrets([]);
      return;
    }

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

  return (
    <div className="sm-page">
      <div className="sm-header">
        <div className="sm-header-content">
          <Zap size={28} className="sm-icon" />
          <div>
            <h1 className="sm-title">Secrets Manager</h1>
            <p className="sm-subtitle">管理 Agent 凭证与访问权限</p>
          </div>
        </div>
      </div>

      <div className="sm-tabs">
        <button
          className={`sm-tab ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          <Shield size={16} />
          Machine Accounts
        </button>
        <button
          className={`sm-tab ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          <Folder size={16} />
          Projects
        </button>
        <button
          className={`sm-tab ${activeTab === 'secrets' ? 'active' : ''}`}
          onClick={() => setActiveTab('secrets')}
        >
          <Key size={16} />
          Secrets
        </button>
      </div>

      <div className="sm-content">
        {loading ? (
          <div className="sm-loading">
            <RefreshCw size={24} className="spinning" />
            <span>加载中...</span>
          </div>
        ) : (
          <>
            {/* Machine Accounts Tab */}
            {activeTab === 'accounts' && (
              <div className="sm-tab-content">
                <div className="sm-toolbar">
                  <button className="sm-btn sm-btn-primary" onClick={() => setShowCreateModal(true)}>
                    <Plus size={16} />
                    创建 Machine Account
                  </button>
                </div>

                {accounts.length === 0 ? (
                  <div className="sm-empty">
                    <Shield size={48} />
                    <h3>暂无 Machine Account</h3>
                    <p>创建一个 Machine Account 来让 Agent 访问凭证</p>
                  </div>
                ) : (
                  <div className="sm-list">
                    {accounts.map((account) => (
                      <div key={account.id} className="sm-card">
                        <div className="sm-card-header">
                          <Shield size={20} />
                          <span className="sm-card-name">{account.name}</span>
                          <span className={`sm-badge ${account.status === 'active' ? 'active' : 'inactive'}`}>
                            {account.status === 'active' ? '活跃' : '禁用'}
                          </span>
                        </div>
                        <div className="sm-card-meta">
                          <span>创建于 {new Date(account.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="sm-card-actions">
                          <button className="sm-btn sm-btn-sm" onClick={() => generateToken(account.id)}>
                            <Key size={14} />
                            生成 Token
                          </button>
                          <button className="sm-btn sm-btn-sm sm-btn-danger">
                            <Trash2 size={14} />
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Projects Tab */}
            {activeTab === 'projects' && (
              <div className="sm-tab-content">
                <div className="sm-toolbar">
                  <button className="sm-btn sm-btn-primary" onClick={() => setShowCreateModal(true)}>
                    <Plus size={16} />
                    创建 Project
                  </button>
                </div>

                {projects.length === 0 ? (
                  <div className="sm-empty">
                    <Folder size={48} />
                    <h3>暂无 Project</h3>
                    <p>创建一个 Project 来组织凭证</p>
                  </div>
                ) : (
                  <div className="sm-list">
                    {projects.map((project) => (
                      <div key={project.id} className="sm-card" onClick={() => { setActiveTab('secrets'); loadSecrets(project.id); }}>
                        <div className="sm-card-header">
                          <Folder size={20} />
                          <span className="sm-card-name">{project.name}</span>
                        </div>
                        {project.description && (
                          <div className="sm-card-desc">{project.description}</div>
                        )}
                        <div className="sm-card-meta">
                          <span>创建于 {new Date(project.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Secrets Tab */}
            {activeTab === 'secrets' && (
              <div className="sm-tab-content">
                <div className="sm-toolbar">
                  <select
                    className="sm-select"
                    value={newSecretProject}
                    onChange={(e) => {
                      const projectId = (e.target as HTMLSelectElement).value;
                      setNewSecretProject(projectId);
                      loadSecrets(projectId);
                    }}
                  >
                    <option value="">选择 Project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    className="sm-btn sm-btn-primary"
                    onClick={() => setShowCreateModal(true)}
                    disabled={!newSecretProject}
                  >
                    <Plus size={16} />
                    创建 Secret
                  </button>
                </div>

                {secrets.length === 0 ? (
                  <div className="sm-empty">
                    <Key size={48} />
                    <h3>暂无 Secrets</h3>
                    <p>{newSecretProject ? '选择一个 Project 后可以创建 Secret' : '请先选择一个 Project'}</p>
                  </div>
                ) : (
                  <div className="sm-list">
                    {secrets.map((secret) => (
                      <div key={secret.id} className="sm-card">
                        <div className="sm-card-header">
                          <Key size={20} />
                          <span className="sm-card-name">{secret.name}</span>
                          <span className="sm-badge sm-badge-env">{secret.environment}</span>
                        </div>
                        <div className="sm-card-value">
                          <code>{showSecretValue ? secret.value : maskValue(secret.value)}</code>
                          <button className="sm-btn-icon" onClick={() => setShowSecretValue(!showSecretValue)}>
                            {showSecretValue ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button className="sm-btn-icon" onClick={() => copyToClipboard(secret.value)}>
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="sm-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="sm-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="sm-modal-title">
              {activeTab === 'accounts' && '创建 Machine Account'}
              {activeTab === 'projects' && '创建 Project'}
              {activeTab === 'secrets' && '创建 Secret'}
            </h2>

            {activeTab === 'accounts' && (
              <div className="sm-form">
                <div className="sm-field">
                  <label>名称</label>
                  <input
                    type="text"
                    value={newAccountName}
                    onInput={(e) => setNewAccountName((e.target as HTMLInputElement).value)}
                    placeholder="例如: ningzhi-agent"
                  />
                </div>
                <div className="sm-field">
                  <label>描述（可选）</label>
                  <input
                    type="text"
                    value={newAccountDesc}
                    onInput={(e) => setNewAccountDesc((e.target as HTMLInputElement).value)}
                    placeholder="例如: 宁织 Agent 专用"
                  />
                </div>
              </div>
            )}

            {activeTab === 'projects' && (
              <div className="sm-form">
                <div className="sm-field">
                  <label>名称</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onInput={(e) => setNewProjectName((e.target as HTMLInputElement).value)}
                    placeholder="例如: SN-Team"
                  />
                </div>
                <div className="sm-field">
                  <label>描述（可选）</label>
                  <input
                    type="text"
                    value={newProjectDesc}
                    onInput={(e) => setNewProjectDesc((e.target as HTMLInputElement).value)}
                    placeholder="例如: SN团队凭证"
                  />
                </div>
              </div>
            )}

            {activeTab === 'secrets' && (
              <div className="sm-form">
                <div className="sm-field">
                  <label>名称</label>
                  <input
                    type="text"
                    value={newSecretName}
                    onInput={(e) => setNewSecretName((e.target as HTMLInputElement).value)}
                    placeholder="例如: XIAOMI_API_KEY"
                  />
                </div>
                <div className="sm-field">
                  <label>值</label>
                  <input
                    type="password"
                    value={newSecretValue}
                    onInput={(e) => setNewSecretValue((e.target as HTMLInputElement).value)}
                    placeholder="输入凭证值"
                  />
                </div>
                <div className="sm-field">
                  <label>环境</label>
                  <select value={newSecretEnv} onChange={(e) => setNewSecretEnv((e.target as HTMLSelectElement).value)}>
                    <option value="prod">生产环境</option>
                    <option value="dev">开发环境</option>
                    <option value="staging">测试环境</option>
                  </select>
                </div>
              </div>
            )}

            <div className="sm-modal-actions">
              <button className="sm-btn sm-btn-secondary" onClick={() => setShowCreateModal(false)}>
                取消
              </button>
              <button
                className="sm-btn sm-btn-primary"
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

      {/* Token Modal */}
      {showTokenModal && (
        <div className="sm-modal-overlay" onClick={() => setShowTokenModal(false)}>
          <div className="sm-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="sm-modal-title">Access Token 已生成</h2>
            <div className="sm-token-display">
              <code>{selectedToken}</code>
              <button className="sm-btn-icon" onClick={() => copyToClipboard(selectedToken)}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="sm-token-warning">
              ⚠️ 请保存此 Token，它不会再次显示。Agent 使用此 Token 访问凭证。
            </p>
            <div className="sm-modal-actions">
              <button className="sm-btn sm-btn-primary" onClick={() => setShowTokenModal(false)}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
