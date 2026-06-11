/**
 * Tirisfal Secrets Manager Node.js SDK - TypeScript Definitions
 */

export interface Secret {
  id: string;
  name: string;
  value: string;
  projectId: string;
  environment: string;
  note: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  userId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ClientOptions {
  server: string;
  token: string;
}

export interface GetSecretOptions {
  projectId: string;
  environment?: string;
}

export interface CreateSecretOptions {
  environment?: string;
  note?: string;
}

export interface UpdateSecretOptions {
  value?: string;
  note?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  services: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error' | 'disabled';
  };
}

export declare class TirisfalError extends Error {
  statusCode: number;
  constructor(message: string, statusCode?: number);
}

export declare class TirisfalClient {
  constructor(options: ClientOptions);

  getSecret(name: string, options: GetSecretOptions): Promise<Secret>;
  getSecrets(projectId: string, environment?: string): Promise<Secret[]>;
  createSecret(name: string, value: string, projectId: string, options?: CreateSecretOptions): Promise<Secret>;
  updateSecret(secretId: string, updates: UpdateSecretOptions): Promise<Secret>;
  deleteSecret(secretId: string): Promise<boolean>;

  getProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project>;

  healthCheck(detailed?: boolean): Promise<HealthStatus>;
}

export declare function getSecret(
  server: string,
  token: string,
  name: string,
  projectId: string,
  environment?: string
): Promise<string>;
