// Secrets Manager Service
// 核心业务逻辑

import { encrypt, decrypt } from '../utils/crypto';
import type {
  CreateMachineAccountRequest,
  CreateProjectRequest,
  CreateSecretRequest,
  MachineAccount,
  MachineAccountTokenResponse,
  Secret,
  SecretAccessLog,
  SmProject,
} from '../types/sm';

export class SecretsManagerService {
  private db: D1Database;
  private encryptionKey: string;

  constructor(db: D1Database, encryptionKey?: string) {
    this.db = db;
    this.encryptionKey = encryptionKey || '';
    // 验证加密密钥不为空
    if (!this.encryptionKey) {
      throw new Error('ENCRYPTION_KEY is required');
    }
  }

  // ==================== Machine Accounts ====================

  async createMachineAccount(
    userId: string,
    request: CreateMachineAccountRequest
  ): Promise<MachineAccount> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await this.db
        .prepare(
          'INSERT INTO machine_accounts (id, name, user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(id, request.name, userId, 'active', now, now)
        .run();
    } catch (error) {
      // 处理唯一性约束冲突（并发创建同名账号）
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        // 查找已存在的账号
        const existing = await this.db
          .prepare('SELECT * FROM machine_accounts WHERE name = ? AND user_id = ?')
          .bind(request.name, userId)
          .first<MachineAccount>();
        if (existing) {
          return existing;
        }
      }
      throw error;
    }

    const account = await this.getMachineAccount(id);
    if (!account) throw new Error('Failed to create machine account');
    return account;
  }

  async getMachineAccount(id: string): Promise<MachineAccount | null> {
    const result = await this.db
      .prepare('SELECT * FROM machine_accounts WHERE id = ?')
      .bind(id)
      .first<MachineAccount>();
    return result || null;
  }

  async getMachineAccountsByUserId(userId: string): Promise<MachineAccount[]> {
    const result = await this.db
      .prepare('SELECT * FROM machine_accounts WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<MachineAccount>();
    return result.results || [];
  }

  async updateMachineAccount(
    id: string,
    updates: Partial<MachineAccount>
  ): Promise<MachineAccount | null> {
    const now = new Date().toISOString();
    const setClauses: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.status !== undefined) {
      // 确保 status 是有效的值
      const validStatus =
        updates.status === 'active' || updates.status === 'disabled' ? updates.status : 'active';
      setClauses.push('status = ?');
      values.push(validStatus);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }

    values.push(id);

    await this.db
      .prepare(`UPDATE machine_accounts SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return this.getMachineAccount(id);
  }

  async deleteMachineAccount(id: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM machine_accounts WHERE id = ?')
      .bind(id)
      .run();
    return result.meta.changes > 0;
  }

  async generateAccessToken(
    machineAccountId: string,
    expiryDays?: number
  ): Promise<MachineAccountTokenResponse> {
    // 验证过期时间
    const maxDays = 90;
    const days = Math.min(Math.max(1, expiryDays || 30), maxDays);

    // 撤销旧 token（如果有）
    await this.revokeAccessToken(machineAccountId);

    // 生成随机 token（使用 URL-safe base64）
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = btoa(String.fromCharCode(...tokenBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // 计算 token 哈希
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // 设置过期时间
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await this.db
      .prepare(
        'UPDATE machine_accounts SET access_token_hash = ?, access_token_expires_at = ?, updated_at = ? WHERE id = ?'
      )
      .bind(hashHex, expiresAt, new Date().toISOString(), machineAccountId)
      .run();

    return {
      access_token: token,
      expires_at: expiresAt,
    };
  }

  async revokeAccessToken(machineAccountId: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE machine_accounts SET access_token_hash = NULL, access_token_expires_at = NULL, updated_at = ? WHERE id = ?'
      )
      .bind(new Date().toISOString(), machineAccountId)
      .run();
  }

  async verifyAccessToken(token: string): Promise<MachineAccount | null> {
    // 计算 token 哈希
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const result = await this.db
      .prepare(
        'SELECT * FROM machine_accounts WHERE access_token_hash = ? AND status = ? AND (access_token_expires_at IS NULL OR access_token_expires_at > ?)'
      )
      .bind(hashHex, 'active', new Date().toISOString())
      .first<MachineAccount>();

    return result || null;
  }

  // ==================== Projects ====================

  async createProject(userId: string, request: CreateProjectRequest): Promise<SmProject> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        'INSERT INTO sm_projects (id, name, description, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id, request.name, request.description || null, userId, now, now)
      .run();

    const project = await this.getProject(id);
    if (!project) throw new Error('Failed to create project');
    return project;
  }

  async getProject(id: string): Promise<SmProject | null> {
    const result = await this.db
      .prepare('SELECT * FROM sm_projects WHERE id = ?')
      .bind(id)
      .first<SmProject>();
    return result || null;
  }

  async getProjectsByUserId(userId: string): Promise<SmProject[]> {
    const result = await this.db
      .prepare('SELECT * FROM sm_projects WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<SmProject>();
    return result.results || [];
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM sm_projects WHERE id = ?').bind(id).run();
    return result.meta.changes > 0;
  }

  // ==================== Secrets ====================

  async createSecret(userId: string, request: CreateSecretRequest): Promise<Secret> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // 使用 AES-256-GCM 加密凭证
    const encryptedValue = await encrypt(request.value, this.encryptionKey);

    try {
      await this.db
        .prepare(
          'INSERT INTO secrets (id, name, value, project_id, environment, note, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          id,
          request.name,
          encryptedValue,
          request.project_id,
          request.environment || 'prod',
          request.note || null,
          userId,
          now,
          now
        )
        .run();
    } catch (error) {
      // 处理唯一性约束冲突（并发创建同名凭证）
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        const existing = await this.db
          .prepare('SELECT * FROM secrets WHERE name = ? AND project_id = ? AND environment = ?')
          .bind(request.name, request.project_id, request.environment || 'prod')
          .first<Secret>();
        if (existing) {
          return existing;
        }
      }
      throw error;
    }

    const secret = await this.getSecret(id);
    if (!secret) throw new Error('Failed to create secret');
    return secret;
  }

  async getSecret(id: string): Promise<Secret | null> {
    const result = await this.db
      .prepare('SELECT * FROM secrets WHERE id = ?')
      .bind(id)
      .first<Secret>();
    return result || null;
  }

  async getSecretsByProject(projectId: string, environment?: string): Promise<Secret[]> {
    let query = 'SELECT * FROM secrets WHERE project_id = ?';
    const params: any[] = [projectId];

    if (environment) {
      query += ' AND environment = ?';
      params.push(environment);
    }

    query += ' ORDER BY name ASC';

    const result = await this.db
      .prepare(query)
      .bind(...params)
      .all<Secret>();
    return result.results || [];
  }

  async getSecretByNameAndProject(
    name: string,
    projectId: string,
    environment: string
  ): Promise<Secret | null> {
    const result = await this.db
      .prepare('SELECT * FROM secrets WHERE name = ? AND project_id = ? AND environment = ?')
      .bind(name, projectId, environment)
      .first<Secret>();
    return result || null;
  }

  async updateSecret(id: string, updates: Partial<CreateSecretRequest>): Promise<Secret | null> {
    const now = new Date().toISOString();
    const setClauses: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.value !== undefined) {
      setClauses.push('value = ?');
      values.push(await encrypt(updates.value, this.encryptionKey));
    }
    if (updates.note !== undefined) {
      setClauses.push('note = ?');
      values.push(updates.note);
    }

    values.push(id);

    await this.db
      .prepare(`UPDATE secrets SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return this.getSecret(id);
  }

  async deleteSecret(id: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM secrets WHERE id = ?').bind(id).run();
    return result.meta.changes > 0;
  }

  // 解密 Secret 值
  async decryptSecretValue(encryptedValue: string): Promise<string> {
    return decrypt(encryptedValue, this.encryptionKey);
  }

  // ==================== Permissions ====================

  async grantProjectAccess(
    machineAccountId: string,
    projectId: string,
    permission: string = 'read',
    options?: {
      allowed_ip?: string[];
      allowed_hours?: { start: number; end: number };
      max_requests_per_minute?: number;
      expires_at?: string;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO machine_account_projects
         (machine_account_id, project_id, permission, allowed_ip, allowed_hours, max_requests_per_minute, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        machineAccountId,
        projectId,
        permission,
        options?.allowed_ip ? JSON.stringify(options.allowed_ip) : null,
        options?.allowed_hours ? JSON.stringify(options.allowed_hours) : null,
        options?.max_requests_per_minute || null,
        options?.expires_at || null,
        now
      )
      .run();
  }

  async validateProjectAccess(
    machineAccountId: string,
    projectId: string,
    clientIp?: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const result = await this.db
      .prepare(
        `SELECT * FROM machine_account_projects
         WHERE machine_account_id = ? AND project_id = ?`
      )
      .bind(machineAccountId, projectId)
      .first<{
        permission: string;
        allowed_ip: string | null;
        allowed_hours: string | null;
        max_requests_per_minute: number | null;
        expires_at: string | null;
      }>();

    if (!result) {
      return { allowed: false, reason: 'No access granted' };
    }

    // 检查过期
    if (result.expires_at && new Date(result.expires_at) < new Date()) {
      return { allowed: false, reason: 'Access expired' };
    }

    // 检查 IP 白名单
    if (result.allowed_ip && clientIp) {
      try {
        const allowedIps = JSON.parse(result.allowed_ip) as string[];
        if (!Array.isArray(allowedIps) || !allowedIps.includes(clientIp)) {
          return { allowed: false, reason: 'IP not whitelisted' };
        }
      } catch {
        return { allowed: false, reason: 'Invalid IP whitelist configuration' };
      }
    }

    // 检查时间窗口（使用 UTC）
    if (result.allowed_hours) {
      try {
        const hours = JSON.parse(result.allowed_hours) as { start: number; end: number };
        if (typeof hours.start !== 'number' || typeof hours.end !== 'number') {
          return { allowed: false, reason: 'Invalid hours configuration' };
        }
        const currentHour = new Date().getUTCHours();
        if (currentHour < hours.start || currentHour > hours.end) {
          return { allowed: false, reason: 'Outside allowed hours' };
        }
      } catch {
        return { allowed: false, reason: 'Invalid hours configuration' };
      }
    }

    // 检查请求频率限制
    if (result.max_requests_per_minute) {
      // TODO: 实现请求频率检查（需要缓存或数据库计数器）
      // 目前只记录限制值，实际检查需要集成到 RateLimitService
    }

    return { allowed: true };
  }

  async revokeProjectAccess(machineAccountId: string, projectId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        'DELETE FROM machine_account_projects WHERE machine_account_id = ? AND project_id = ?'
      )
      .bind(machineAccountId, projectId)
      .run();
    return result.meta.changes > 0;
  }

  async getProjectAccess(
    machineAccountId: string
  ): Promise<{ project_id: string; permission: string }[]> {
    const result = await this.db
      .prepare(
        'SELECT project_id, permission FROM machine_account_projects WHERE machine_account_id = ?'
      )
      .bind(machineAccountId)
      .all<{ project_id: string; permission: string }>();
    return result.results || [];
  }

  async hasProjectAccess(
    machineAccountId: string,
    projectId: string,
    clientIp?: string
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `SELECT * FROM machine_account_projects
         WHERE machine_account_id = ? AND project_id = ?`
      )
      .bind(machineAccountId, projectId)
      .first<{
        expires_at: string | null;
        allowed_ip: string | null;
      }>();

    if (!result) {
      return false;
    }

    // 检查过期
    if (result.expires_at && new Date(result.expires_at) < new Date()) {
      return false;
    }

    // 检查 IP 白名单
    if (result.allowed_ip && clientIp) {
      try {
        const allowedIps = JSON.parse(result.allowed_ip) as string[];
        if (!Array.isArray(allowedIps) || !allowedIps.includes(clientIp)) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  // ==================== Audit Logs ====================

  async logSecretAccess(
    machineAccountId: string | null,
    userId: string | null,
    secretId: string,
    action: string,
    ipAddress: string | null,
    userAgent: string | null,
    metadata?: Record<string, unknown>,
    projectId?: string,
    environment?: string
  ): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // 清理 IP（移除端口）
    const sanitizedIp = ipAddress?.split(':')[0] || null;

    // 截断 User-Agent 防止滥用
    const sanitizedUserAgent = userAgent?.substring(0, 255) || null;

    // 构建元数据，包含 project_id 和 environment
    const fullMetadata = {
      ...metadata,
      project_id: projectId,
      environment: environment,
    };

    await this.db
      .prepare(
        `INSERT INTO secret_access_logs
         (id, machine_account_id, user_id, secret_id, action, ip_address, user_agent, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        machineAccountId,
        userId,
        secretId,
        action,
        sanitizedIp,
        sanitizedUserAgent,
        JSON.stringify(fullMetadata),
        now
      )
      .run();
  }

  async getSecretAccessLogs(secretId: string, limit: number = 100): Promise<SecretAccessLog[]> {
    const result = await this.db
      .prepare(
        'SELECT * FROM secret_access_logs WHERE secret_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .bind(secretId, limit)
      .all<SecretAccessLog>();
    return result.results || [];
  }

  async cleanupOldAuditLogs(): Promise<number> {
    const retentionDays = 90;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const result = await this.db
      .prepare('DELETE FROM secret_access_logs WHERE created_at < ?')
      .bind(cutoff)
      .run();

    return result.meta.changes;
  }
}
