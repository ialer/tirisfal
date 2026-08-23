/**
 * Tirisfal Secrets Manager Node.js SDK
 *
 * Simple client for accessing secrets from Tirisfal.
 *
 * Usage:
 *   const { TirisfalClient } = require('@tirisfal/sdk');
 *
 *   const client = new TirisfalClient({
 *     server: 'https://your-worker.workers.dev',
 *     token: 'your-machine-account-token'
 *   });
 *
 *   // Get a secret
 *   const secret = await client.getSecret('API_KEY', { projectId: 'xxx', environment: 'prod' });
 *   console.log(secret.value);
 */

/**
 * @typedef {Object} Secret
 * @property {string} id
 * @property {string} name
 * @property {string} value
 * @property {string} projectId
 * @property {string} environment
 * @property {string|null} note
 * @property {string|null} createdAt
 * @property {string|null} updatedAt
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {string|null} description
 * @property {string|null} userId
 * @property {string|null} createdAt
 * @property {string|null} updatedAt
 */

/**
 * @typedef {Object} ClientOptions
 * @property {string} server - Base URL of the Tirisfal server
 * @property {string} token - Machine account access token or user JWT token
 */

/**
 * @typedef {Object} GetSecretOptions
 * @property {string} projectId - Project ID
 * @property {string} [environment='prod'] - Environment
 */

class TirisfalError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   */
  constructor(message, statusCode = 0) {
    // 脱敏：避免异常消息/栈中携带凭证值或访问令牌
    super(TirisfalError.redact(message));
    this.name = 'TirisfalError';
    this.statusCode = statusCode;
  }

  /**
   * 遮蔽消息中的敏感片段（令牌、键值对形式的 value）。
   * @param {string} message
   * @returns {string}
   */
  static redact(message) {
    if (typeof message !== 'string') return message;
    return message
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
      .replace(/((?:value|password|secret|token)["'\\s=:]+)[^\s&",']{4,}/gi, '$1[REDACTED]');
  }
}

class TirisfalClient {
  /**
   * Create a new Tirisfal client.
   *
   * @param {ClientOptions} options - Client configuration
   */
  constructor(options) {
    this.server = options.server.replace(/\/$/, '');
    this.token = options.token;
    /** @type {number} 请求超时毫秒数，防止 Agent 调用永久挂起 */
    this.timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 15000;
  }

  /**
   * Make an HTTP request to the API.
   *
   * @param {string} method
   * @param {string} path
   * @param {Object} [data]
   * @param {Object} [params]
   * @returns {Promise<Object>}
   * @private
   */
  async _request(method, path, data = null, params = null) {
    let url = `${this.server}${path}`;

    if (params) {
      const queryString = Object.entries(params)
        .filter(([_, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    const options = {
      method,
      headers,
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      let errorMessage;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || response.statusText;
      } catch {
        errorMessage = response.statusText;
      }
      throw new TirisfalError(errorMessage, response.status);
    }

    return response.json();
  }

  // ==================== Secrets ====================

  /**
   * Get a secret by name.
   *
   * @param {string} name - Secret name
   * @param {GetSecretOptions} options - Options
   * @returns {Promise<Secret>}
   */
  async getSecret(name, options) {
    const { projectId, environment = 'prod' } = options;
    const data = await this._request('GET', `/api/secrets/by-name/${encodeURIComponent(name)}`, null, {
      project_id: projectId,
      environment,
    });

    return {
      id: data.id,
      name: data.name,
      value: data.value,
      projectId: data.project_id,
      environment: data.environment,
      note: data.note || null,
      createdAt: data.created_at || null,
      updatedAt: data.updated_at || null,
    };
  }

  /**
   * 批量获取凭证值，返回 { 名称: 值 } 映射；可选注入 process.env。
   * @param {string} projectId - Project ID
   * @param {Object} [options] - Options
   * @param {string} [options.environment='prod'] - Environment
   * @param {string[]} [options.names] - 只取指定名称（缺省=全部）
   * @param {boolean} [options.injectEnv=false] - 是否写入 process.env
   * @returns {Promise<Record<string, string>>}
   */
  async getSecretValues(projectId, options = {}) {
    const { environment = 'prod', names, injectEnv = false } = options;
    const data = await this._request('POST', '/api/secrets/batch', {
      project_id: projectId,
      environment,
      ...(names ? { names } : {}),
    });
    const values = {};
    for (const item of data.data || []) {
      values[item.name] = item.value;
      if (injectEnv && typeof process !== 'undefined' && process.env) {
        process.env[item.name] = item.value;
      }
    }
    return values;
  }

  /**
   * List secrets in a project.
   *
   * @param {string} projectId - Project ID
   * @param {string} [environment] - Filter by environment
   * @returns {Promise<Secret[]>}
   */
  async getSecrets(projectId, environment) {
    const params = { project_id: projectId };
    if (environment) {
      params.environment = environment;
    }

    const data = await this._request('GET', '/api/secrets', null, params);

    return (data.data || []).map(s => ({
      id: s.id,
      name: s.name,
      value: s.value || '',
      projectId: s.project_id,
      environment: s.environment,
      note: s.note || null,
      createdAt: s.created_at || null,
      updatedAt: s.updated_at || null,
    }));
  }

  /**
   * Create a new secret.
   *
   * @param {string} name - Secret name
   * @param {string} value - Secret value
   * @param {string} projectId - Project ID
   * @param {Object} [options] - Additional options
   * @param {string} [options.environment='prod'] - Environment
   * @param {string} [options.note] - Note
   * @returns {Promise<Secret>}
   */
  async createSecret(name, value, projectId, options = {}) {
    const { environment = 'prod', note } = options;

    const data = await this._request('POST', '/api/secrets', {
      name,
      value,
      project_id: projectId,
      environment,
      note,
    });

    return {
      id: data.id,
      name: data.name,
      value,
      projectId: data.project_id,
      environment: data.environment,
      note: data.note || null,
      createdAt: data.created_at || null,
      updatedAt: data.updated_at || null,
    };
  }

  /**
   * Update an existing secret.
   *
   * @param {string} secretId - Secret ID
   * @param {Object} updates - Fields to update
   * @param {string} [updates.value] - New value
   * @param {string} [updates.note] - New note
   * @returns {Promise<Secret>}
   */
  async updateSecret(secretId, updates) {
    const data = await this._request('PUT', `/api/secrets/${secretId}`, updates);

    return {
      id: data.id,
      name: data.name,
      value: updates.value || data.value || '',
      projectId: data.project_id,
      environment: data.environment,
      note: data.note || null,
      createdAt: data.created_at || null,
      updatedAt: data.updated_at || null,
    };
  }

  /**
   * Delete a secret.
   *
   * @param {string} secretId - Secret ID
   * @returns {Promise<boolean>}
   */
  async deleteSecret(secretId) {
    await this._request('DELETE', `/api/secrets/${secretId}`);
    return true;
  }

  // ==================== Projects ====================

  /**
   * List all projects.
   *
   * @returns {Promise<Project[]>}
   */
  async getProjects() {
    const data = await this._request('GET', '/api/projects');

    return (data.data || []).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description || null,
      userId: p.user_id || null,
      createdAt: p.created_at || null,
      updatedAt: p.updated_at || null,
    }));
  }

  /**
   * Get a project by ID.
   *
   * @param {string} projectId - Project ID
   * @returns {Promise<Project>}
   */
  async getProject(projectId) {
    const data = await this._request('GET', `/api/projects/${projectId}`);

    return {
      id: data.id,
      name: data.name,
      description: data.description || null,
      userId: data.user_id || null,
      createdAt: data.created_at || null,
      updatedAt: data.updated_at || null,
    };
  }

  // ==================== Health Check ====================

  /**
   * Check server health.
   *
   * @param {boolean} [detailed=false] - Include detailed service checks
   * @returns {Promise<Object>}
   */
  async healthCheck(detailed = false) {
    return this._request('GET', '/health', null, detailed ? { detailed: 'true' } : null);
  }
}

/**
 * Quick function to get a secret value.
 *
 * @param {string} server - Tirisfal server URL
 * @param {string} token - Access token
 * @param {string} name - Secret name
 * @param {string} projectId - Project ID
 * @param {string} [environment='prod'] - Environment
 * @returns {Promise<string>}
 */
async function getSecret(server, token, name, projectId, environment = 'prod') {
  const client = new TirisfalClient({ server, token });
  const secret = await client.getSecret(name, { projectId, environment });
  return secret.value;
}

module.exports = {
  TirisfalClient,
  TirisfalError,
  getSecret,
};
