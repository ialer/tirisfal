// Secrets Manager Service
// 核心业务逻辑

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

  constructor(db: D1Database) {
    this.db = db;
  }

  // ==================== Machine Accounts ====================

  async createMachineAccount(
    userId: string,
    request: CreateMachineAccountRequest
  ): Promise<MachineAccount> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        'INSERT INTO machine_accounts (id, name, user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id, request.name, userId, 'active', now, now)
      .run();

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

  async generateAccessToken(machineAccountId: string): Promise<MachineAccountTokenResponse> {
    // 生成随机 token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = btoa(String.fromCharCode(...tokenBytes));

    // 计算 token 哈希
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // 设置过期时间 (30天)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

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

    // 加密值 (使用简单的 base64 编码，实际应用中应使用 AES-GCM)
    const encryptedValue = btoa(request.value);

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
      values.push(btoa(updates.value));
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
  decryptSecretValue(encryptedValue: string): string {
    return atob(encryptedValue);
  }

  // ==================== Permissions ====================

  async grantProjectAccess(
    machineAccountId: string,
    projectId: string,
    permission: string = 'read'
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        'INSERT OR REPLACE INTO machine_account_projects (machine_account_id, project_id, permission, created_at) VALUES (?, ?, ?, ?)'
      )
      .bind(machineAccountId, projectId, permission, now)
      .run();
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

  async hasProjectAccess(machineAccountId: string, projectId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        'SELECT COUNT(*) as count FROM machine_account_projects WHERE machine_account_id = ? AND project_id = ?'
      )
      .bind(machineAccountId, projectId)
      .first<{ count: number }>();
    return (result?.count || 0) > 0;
  }

  // ==================== Audit Logs ====================

  async logSecretAccess(
    machineAccountId: string | null,
    userId: string | null,
    secretId: string,
    action: string,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        'INSERT INTO secret_access_logs (id, machine_account_id, user_id, secret_id, action, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(id, machineAccountId, userId, secretId, action, ipAddress, userAgent, now)
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
}
