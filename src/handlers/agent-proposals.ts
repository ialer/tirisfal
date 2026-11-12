// Agent 提议入库：AI 生成/获取的凭证先暂存，人类在客户端确认后再用主密钥加密成 cipher

import { LIMITS } from '../config/limits';
import { SecretsManagerService } from '../services/sm-service';
import type { Env } from '../types';
import { getClientIpAddress } from '../utils/client-ip';
import { errorResponse, jsonResponse } from '../utils/response';

/** 待确认提议的保留时长：集中配置在 config/limits.ts（默认 30 天） */
const PROPOSAL_TTL_MS = LIMITS.agentProposal.ttlMs;
const MAX_VALUE_LENGTH = 10_000;
const MAX_NOTE_LENGTH = 1_000;
const MAX_NAME_LENGTH = 255;
const ENVIRONMENTS = ['prod', 'staging', 'dev', 'test'];

interface ProposalContext {
  userId: string;
  machineAccountId?: string;
}

function parseEnvironment(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return 'prod';
  if (typeof raw !== 'string' || !ENVIRONMENTS.includes(raw)) return null;
  return raw;
}

export async function handleAgentProposals(
  request: Request,
  env: Env,
  path: string,
  method: string,
  ctx: ProposalContext
): Promise<Response> {
  const smService = new SecretsManagerService(env.DB, env.ENCRYPTION_KEY);
  const { userId, machineAccountId } = ctx;

  // ---- Agent 提交（仅机器账号；需要项目的 write 授权）----
  if (method === 'POST' && path === '/api/agent-proposals') {
    if (!machineAccountId) {
      return errorResponse('该接口仅限 Machine Account 提交提议', 403);
    }
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const value = typeof body.value === 'string' ? body.value : '';
    const environment = parseEnvironment(body.environment);
    const note = body.note === undefined || body.note === null ? null : String(body.note);

    if (!projectId) return errorResponse('project_id is required', 400);
    if (!name || name.length > MAX_NAME_LENGTH) {
      return errorResponse('name is required and must be <= 255 characters', 400);
    }
    if (!value || value.length > MAX_VALUE_LENGTH) {
      return errorResponse('value is required and must be <= 10000 characters', 400);
    }
    if (environment === null) return errorResponse('invalid environment', 400);
    if (note && note.length > MAX_NOTE_LENGTH) {
      return errorResponse('note must be <= 1000 characters', 400);
    }

    const access = await smService.validateProjectAccess(
      machineAccountId,
      projectId,
      getClientIpAddress(request, env) || undefined,
      'write'
    );
    if (!access.allowed) {
      return errorResponse('Access denied: ' + (access.reason || ''), 403);
    }

    const created = await smService.createAgentProposal(machineAccountId, userId, {
      project_id: projectId,
      name,
      value,
      environment: environment ?? 'prod',
      note: note ?? undefined,
      ttlMs: PROPOSAL_TTL_MS,
    });
    return jsonResponse({ success: true, id: created.id, expires_at: created.expires_at }, 201);
  }

  // ---- 人类查看待确认列表 ----
  if (method === 'GET' && path === '/api/agent-proposals') {
    const proposals = await smService.listAgentProposals(userId);
    return jsonResponse({ data: proposals });
  }

  const match = path.match(/^\/api\/agent-proposals\/([a-f0-9-]+)$/);
  if (match) {
    const id = match[1];

    // ---- 人类读取单条（明文，供浏览器端重新加密）----
    if (method === 'GET') {
      if (machineAccountId) return errorResponse('禁止：机器账号不能读取待确认明文', 403);
      const proposal = await smService.getAgentProposal(userId, id);
      if (!proposal) return errorResponse('Not found', 404);
      return jsonResponse(proposal);
    }

    // ---- 删除：人类拒绝，或创建它的机器账号撤回 ----
    if (method === 'DELETE') {
      const removed = await smService.deleteAgentProposal(userId, id, machineAccountId);
      if (!removed) return errorResponse('Not found', 404);
      return jsonResponse({ success: true });
    }
  }

  return errorResponse('Not found', 404);
}
