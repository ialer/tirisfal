import { useState, useEffect } from 'preact/hooks';
import { 
  Plus, Search, Key, Copy, Eye, EyeOff, Trash2, Edit, 
  Folder, Shield, Clock, MoreVertical, RefreshCw, ExternalLink 
} from 'lucide-preact';

interface Secret {
  id: string;
  name: string;
  value: string;
  project_id: string;
  environment: string;
  note?: string;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
}

interface ModernSecretsManagerProps {
  secrets: Secret[];
  projects: Project[];
  selectedProject: string | null;
  onSelectProject: (id: string | null) => void;
  onCreateSecret: (data: { name: string; value: string; project_id: string; environment: string }) => void;
  onDeleteSecret: (id: string) => void;
  onUpdateSecret: (id: string, data: { value?: string; note?: string }) => void;
  onRefresh: () => void;
  loading?: boolean;
}

// Secret Card Component
function SecretCard({ 
  secret, 
  onDelete, 
  onUpdate 
}: { 
  secret: Secret; 
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: { value?: string }) => void;
}) {
  const [showValue, setShowValue] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(secret.value);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleSave = () => {
    onUpdate(secret.id, { value: editValue });
    setEditing(false);
  };

  return (
    <div className="secret-card slide-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <Key size={16} style={{ color: 'var(--primary)' }} />
          <span className="secret-name">{secret.name}</span>
        </div>
        <div className="flex items-center gap-sm">
          <button 
            className="btn btn-ghost btn-icon"
            onClick={() => setShowValue(!showValue)}
            title={showValue ? '隐藏' : '显示'}
          >
            {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button 
            className="btn btn-ghost btn-icon"
            onClick={handleCopy}
            title="复制"
          >
            <Copy size={14} />
          </button>
          <button 
            className="btn btn-ghost btn-icon"
            onClick={() => onDelete(secret.id)}
            title="删除"
            style={{ color: 'var(--danger)' }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      
      <div className="secret-meta">
        <span className="badge badge-primary">{secret.environment}</span>
        <span style={{ marginLeft: '8px' }}>
          {new Date(secret.updated_at).toLocaleDateString('zh-CN')}
        </span>
      </div>
      
      {(showValue || editing) && (
        <div className="secret-value" style={{ marginTop: '12px' }}>
          {editing ? (
            <div className="flex gap-sm">
              <input
                className="input"
                value={editValue}
                onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
                style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
              />
              <button className="btn btn-primary btn-sm" onClick={handleSave}>保存</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>取消</button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <code style={{ flex: 1, wordBreak: 'break-all' }}>{secret.value}</code>
              <button 
                className="btn btn-ghost btn-icon"
                onClick={() => setEditing(true)}
                title="编辑"
              >
                <Edit size={14} />
              </button>
            </div>
          )}
        </div>
      )}
      
      {copied && (
        <div style={{ 
          position: 'absolute', 
          top: '8px', 
          right: '8px',
          background: 'var(--success)', 
          color: 'white', 
          padding: '4px 8px', 
          borderRadius: '4px',
          fontSize: '12px'
        }}>
          已复制
        </div>
      )}
    </div>
  );
}

// Create Secret Modal
function CreateSecretModal({ 
  projects, 
  selectedProject,
  onClose, 
  onSubmit 
}: { 
  projects: Project[];
  selectedProject: string | null;
  onClose: () => void;
  onSubmit: (data: { name: string; value: string; project_id: string; environment: string }) => void;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [projectId, setProjectId] = useState(selectedProject || '');
  const [environment, setEnvironment] = useState('prod');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (name && value && projectId) {
      onSubmit({ name, value, project_id: projectId, environment });
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3 className="dialog-title">创建凭证</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>×</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="input-group">
              <label className="input-label">名称</label>
              <input
                className="input"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                placeholder="例如: API_KEY"
                required
              />
            </div>
            
            <div className="input-group">
              <label className="input-label">值</label>
              <input
                className="input"
                value={value}
                onInput={(e) => setValue((e.target as HTMLInputElement).value)}
                placeholder="sk-***"
                style={{ fontFamily: 'var(--font-mono)' }}
                required
              />
            </div>
            
            <div className="input-group">
              <label className="input-label">项目</label>
              <select
                className="input"
                value={projectId}
                onChange={(e) => setProjectId((e.target as HTMLSelectElement).value)}
                required
              >
                <option value="">选择项目</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            
            <div className="input-group">
              <label className="input-label">环境</label>
              <select
                className="input"
                value={environment}
                onChange={(e) => setEnvironment((e.target as HTMLSelectElement).value)}
              >
                <option value="prod">生产环境</option>
                <option value="staging">预发布环境</option>
                <option value="dev">开发环境</option>
                <option value="test">测试环境</option>
              </select>
            </div>
          </div>
          
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary">创建</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ModernSecretsManager({
  secrets,
  projects,
  selectedProject,
  onSelectProject,
  onCreateSecret,
  onDeleteSecret,
  onUpdateSecret,
  onRefresh,
  loading = false
}: ModernSecretsManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filteredSecrets = secrets.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.environment.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="content">
      {/* Header */}
      <div className="secrets-header">
        <div>
          <h2 style={{ marginBottom: '4px' }}>凭证管理</h2>
          <p className="text-sm text-muted">安全存储和管理您的 API 密钥、Token 等凭证</p>
        </div>
        <div className="flex items-center gap-md">
          <button 
            className="btn btn-secondary"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            刷新
          </button>
          <button 
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={16} />
            新建凭证
          </button>
        </div>
      </div>
      
      {/* Filters */}
      <div className="flex items-center gap-md mb-lg">
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <Search 
            size={16} 
            style={{ 
              position: 'absolute', 
              left: '12px', 
              top: '50%', 
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)'
            }} 
          />
          <input
            className="input"
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            placeholder="搜索凭证..."
            style={{ paddingLeft: '40px' }}
          />
        </div>
        
        <select
          className="input"
          value={selectedProject || ''}
          onChange={(e) => onSelectProject((e.target as HTMLSelectElement).value || null)}
          style={{ width: '200px' }}
        >
          <option value="">所有项目</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      
      {/* Secrets Grid */}
      {filteredSecrets.length === 0 ? (
        <div className="card text-center" style={{ padding: '48px' }}>
          <Key size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
          <h3 style={{ marginBottom: '8px' }}>暂无凭证</h3>
          <p className="text-muted">点击"新建凭证"开始添加</p>
        </div>
      ) : (
        <div className="secrets-grid">
          {filteredSecrets.map(secret => (
            <SecretCard
              key={secret.id}
              secret={secret}
              onDelete={onDeleteSecret}
              onUpdate={onUpdateSecret}
            />
          ))}
        </div>
      )}
      
      {/* Create Modal */}
      {showCreateModal && (
        <CreateSecretModal
          projects={projects}
          selectedProject={selectedProject}
          onClose={() => setShowCreateModal(false)}
          onSubmit={onCreateSecret}
        />
      )}
    </div>
  );
}
