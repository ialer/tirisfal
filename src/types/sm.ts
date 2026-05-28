// Secrets Manager Types

export interface MachineAccount {
  id: string;
  name: string;
  user_id: string;
  status: 'active' | 'disabled';
  access_token_hash: string | null;
  access_token_expires_at: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmProject {
  id: string;
  name: string;
  description: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Secret {
  id: string;
  name: string;
  value: string; // 加密后的值
  project_id: string;
  environment: string;
  note: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface MachineAccountProject {
  machine_account_id: string;
  project_id: string;
  permission: 'read' | 'write';
  created_at: string;
}

export interface SecretAccessLog {
  id: string;
  machine_account_id: string | null;
  user_id: string | null;
  secret_id: string;
  action: 'read' | 'write' | 'create' | 'delete';
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// API 请求/响应类型
export interface CreateMachineAccountRequest {
  name: string;
  description?: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface CreateSecretRequest {
  name: string;
  value: string;
  project_id: string;
  environment?: string;
  note?: string;
}

export interface UpdateSecretRequest {
  value?: string;
  note?: string;
}

export interface SecretResponse {
  id: string;
  name: string;
  value: string;
  project_id: string;
  environment: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface MachineAccountTokenResponse {
  access_token: string;
  expires_at: string;
}
