import { useEffect, useState } from 'preact/hooks';
import { Check, RefreshCw, Trash2 } from 'lucide-preact';

import { createCipher } from '@/lib/api/vault';
import { t } from '@/lib/i18n';
import type { SessionState, VaultDraft } from '@/lib/types';

interface AgentProposal {
  id: string;
  project_id: string;
  project_name: string | null;
  machine_account_id: string | null;
  name: string;
  environment: string;
  note: string | null;
  created_at: string;
  expires_at: string;
}

interface Props {
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  session: SessionState | null;
}

/**
 * Agent 待确认条目。
 * Agent 只能写 SM；想进密码库必须由人类在这里点确认——加密发生在浏览器端，
 * 服务端始终拿不到主密钥（零知识不被破坏）。
 */
export default function AgentProposalPanel({ authedFetch, session }: Props) {
  const [items, setItems] = useState<AgentProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await authedFetch('/api/agent-proposals');
      if (!resp.ok) throw new Error('load failed');
      const body = (await resp.json()) as { data?: AgentProposal[] };
      setItems(body.data || []);
    } catch {
      setError(t('agent_proposals_load_failed') || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const errorText = async (resp: Response, fallback: string): Promise<string> => {
    try {
      const body = (await resp.json()) as { error_description?: string; error?: string };
      return body.error_description || body.error || `${fallback} (${resp.status})`;
    } catch {
      return `${fallback} (${resp.status})`;
    }
  };

  const accept = async (item: AgentProposal) => {
    if (!session?.symEncKey || !session?.symMacKey) {
      setError(t('agent_proposals_locked') || '请先解锁密码库');
      return;
    }
    setBusy(item.id);
    setError('');
    try {
      const detailResp = await authedFetch(`/api/agent-proposals/${encodeURIComponent(item.id)}`);
      if (!detailResp.ok) throw new Error('detail failed');
      const detail = (await detailResp.json()) as {
        name: string;
        value: string;
        note: string | null;
      };
      const draft = {
        type: 1,
        favorite: false,
        name: detail.name,
        folderId: '',
        notes: detail.note || '',
        reprompt: false,
        loginUsername: '',
        loginPassword: detail.value,
        loginTotp: '',
        loginUris: [],
        loginFido2Credentials: [],
      } as unknown as VaultDraft;
      await createCipher(authedFetch, session, draft);
      await authedFetch(`/api/agent-proposals/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      await load();
    } catch {
      setError(t('agent_proposals_accept_failed') || '存入失败');
    } finally {
      setBusy('');
    }
  };

  const reject = async (item: AgentProposal) => {
    setBusy(item.id);
    try {
      await authedFetch(`/api/agent-proposals/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      await load();
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
        <p className="text-muted" style={{ margin: 0 }}>
          {t('agent_proposals_hint') ||
            'AI 生成的凭证会先出现在这里；确认后由浏览器加密写入密码库。'}
        </p>
        <button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} /> {t('txt_refresh') || '刷新'}
        </button>
      </div>

      {error ? (
        <div className="status-error" role="alert" style={{ marginBottom: '12px' }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-muted">{t('txt_loading') || '加载中...'}</p>
      ) : items.length === 0 ? (
        <p className="text-muted">{t('agent_proposals_empty') || '暂无待确认条目'}</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t('agent_proposals_name') || '名称'}</th>
                <th>{t('agent_proposals_project') || '项目'}</th>
                <th>{t('agent_proposals_environment') || '环境'}</th>
                <th>{t('agent_proposals_expires') || '过期时间'}</th>
                <th style={{ width: '160px' }} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.project_name || item.project_id}</td>
                  <td>{item.environment}</td>
                  <td>{new Date(item.expires_at).toLocaleDateString()}</td>
                  <td>
                    <div className="flex gap-2">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy === item.id}
                        onClick={() => void accept(item)}
                      >
                        <Check size={14} /> {t('agent_proposals_accept') || '存入密码库'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={busy === item.id}
                        aria-label={t('agent_proposals_reject') || '拒绝该提议'}
                        title={t('agent_proposals_reject') || '拒绝该提议'}
                        onClick={() => void reject(item)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
