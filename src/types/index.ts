/** 环境变量绑定 */
export interface Env {
  DB: D1Database;
  NOTIFICATIONS_HUB: DurableObjectNamespace;
  ASSETS?: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  /** 优先使用 R2 存储附件，可选以支持仅 KV 部署 */
  ATTACHMENTS?: R2Bucket;
  /** 附件/Send 文件存储的可选回退方案（无需信用卡） */
  ATTACHMENTS_KV?: KVNamespace;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  TOTP_SECRET?: string;
}

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'banned';

/** `.dev.vars.example` 中使用的示例 JWT 密钥，运行时若等于此值则视为不安全 */
export const DEFAULT_DEV_SECRET = 'Enter-your-JWT-key-here-at-least-32-characters';

/** 附件模型 */
export interface Attachment {
  id: string;
  cipherId: string;
  fileName: string; // 加密后的文件名
  size: number;
  sizeName: string;
  key: string | null; // 加密后的附件密钥
}

/** 用户模型 */
export interface User {
  id: string;
  email: string;
  name: string | null;
  masterPasswordHint: string | null;
  masterPasswordHash: string;
  key: string;
  privateKey: string | null;
  publicKey: string | null;
  kdfType: number;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  securityStamp: string;
  role: UserRole;
  status: UserStatus;
  verifyDevices?: boolean;
  totpSecret: string | null;
  totpRecoveryCode: string | null;
  apiKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserDomainSettings {
  userId: string;
  equivalentDomains: string[][];
  customEquivalentDomains: CustomEquivalentDomain[];
  excludedGlobalEquivalentDomains: number[];
  updatedAt: string | null;
}

export interface CustomEquivalentDomain {
  id: string;
  domains: string[];
  excluded: boolean;
}

export interface GlobalEquivalentDomain {
  type: number;
  domains: string[];
  excluded: boolean;
  [key: string]: unknown;
}

export interface DomainRulesResponse {
  equivalentDomains: string[][];
  customEquivalentDomains: CustomEquivalentDomain[];
  globalEquivalentDomains: GlobalEquivalentDomain[];
  object: 'domains';
}

export interface Invite {
  code: string;
  createdBy: string;
  usedBy: string | null;
  expiresAt: string;
  status: 'active' | 'used' | 'revoked' | 'expired';
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: string | null;
  createdAt: string;
}

/** 密码项类型枚举 */
export enum CipherType {
  Login = 1,
  SecureNote = 2,
  Card = 3,
  Identity = 4,
}

export interface CipherLoginUri {
  uri: string | null;
  uriChecksum: string | null;
  match: number | null;
}

export interface CipherLogin {
  username: string | null;
  password: string | null;
  uris: CipherLoginUri[] | null;
  totp: string | null;
  autofillOnPageLoad: boolean | null;
  fido2Credentials: any[] | null;
  uri: string | null;
  passwordRevisionDate: string | null;
}

export interface CipherCard {
  cardholderName: string | null;
  brand: string | null;
  number: string | null;
  expMonth: string | null;
  expYear: string | null;
  code: string | null;
}

export interface CipherSshKey {
  publicKey: string;
  privateKey: string;
  keyFingerprint: string;
}

export interface CipherIdentity {
  title: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  ssn: string | null;
  username: string | null;
  passportNumber: string | null;
  licenseNumber: string | null;
}

export interface CipherSecureNote {
  type: number;
}

export interface CipherField {
  name: string | null;
  value: string | null;
  type: number;
  linkedId: number | null;
}

export interface PasswordHistory {
  password: string;
  lastUsedDate: string;
}

/** 密码项模型 */
export interface Cipher {
  id: string;
  userId: string;
  type: CipherType;
  folderId: string | null;
  name: string | null;
  notes: string | null;
  favorite: boolean;
  login: CipherLogin | null;
  card: CipherCard | null;
  identity: CipherIdentity | null;
  secureNote: CipherSecureNote | null;
  sshKey: CipherSshKey | null;
  fields: CipherField[] | null;
  passwordHistory: PasswordHistory[] | null;
  reprompt: number;
  key: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  /** 允许 Bitwarden 客户端的未知字段透传存储 */
  [key: string]: any;
}

/** 文件夹模型 */
export interface Folder {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  userId: string;
  deviceIdentifier: string;
  name: string;
  deviceNote: string | null;
  type: number;
  sessionStamp: string;
  encryptedUserKey: string | null;
  encryptedPublicKey: string | null;
  encryptedPrivateKey: string | null;
  devicePendingAuthRequest?: DevicePendingAuthRequest | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DevicePendingAuthRequest {
  id: string;
  creationDate: string;
}

export interface DeviceResponse {
  id: string;
  userId?: string | null;
  name: string;
  systemName?: string | null;
  deviceNote?: string | null;
  identifier: string;
  type: number;
  creationDate: string;
  revisionDate: string;
  lastSeenAt?: string | null;
  hasStoredDevice?: boolean;
  isTrusted: boolean;
  encryptedUserKey: string | null;
  encryptedPublicKey: string | null;
  devicePendingAuthRequest: DevicePendingAuthRequest | null;
  object: string;
  [key: string]: any;
}

export interface ProtectedDeviceResponse {
  id: string;
  name: string;
  identifier: string;
  type: number;
  creationDate: string;
  encryptedUserKey: string | null;
  encryptedPublicKey: string | null;
  object: string;
  [key: string]: any;
}

export interface RefreshTokenRecord {
  userId: string;
  expiresAt: number;
  deviceIdentifier: string | null;
  deviceSessionStamp: string | null;
}

export interface TrustedDeviceTokenSummary {
  deviceIdentifier: string;
  expiresAt: number;
  tokenCount: number;
}

/** Send 类型枚举 */
export enum SendType {
  Text = 0,
  File = 1,
}

/** Send 认证类型枚举 */
export enum SendAuthType {
  Email = 0,
  Password = 1,
  None = 2,
}

export interface Send {
  id: string;
  userId: string;
  type: SendType;
  name: string;
  notes: string | null;
  data: string;
  key: string;
  passwordHash: string | null;
  passwordSalt: string | null;
  passwordIterations: number | null;
  authType: SendAuthType;
  emails: string | null;
  maxAccessCount: number | null;
  accessCount: number;
  disabled: boolean;
  hideEmail: boolean | null;
  createdAt: string;
  updatedAt: string;
  expirationDate: string | null;
  deletionDate: string;
}

export interface SendResponse {
  id: string;
  accessId: string;
  type: number;
  name: string;
  notes: string | null;
  text: any | null;
  file: any | null;
  key: string;
  maxAccessCount: number | null;
  accessCount: number;
  password: string | null;
  emails: string | null;
  authType: SendAuthType;
  disabled: boolean;
  hideEmail: boolean | null;
  revisionDate: string;
  expirationDate: string | null;
  deletionDate: string;
  object: string;
}

/** JWT 载荷 */
export interface JWTPayload {
  sub: string; // 用户 ID
  email: string;
  name: string | null;
  email_verified: boolean; // 移动客户端必需
  amr: string[]; // 认证方法引用 - 移动客户端必需
  sstamp: string; // 安全戳，用户修改密码时使令牌失效
  did?: string; // 设备标识符，用于设备级会话失效
  dstamp?: string; // 设备会话戳
  iat: number;
  exp: number;
  iss: string;
  premium: boolean;
}

/** 用户解密选项类型（用于移动客户端兼容性） */
export interface MasterPasswordUnlockKdf {
  KdfType: number;
  Iterations: number;
  Memory: number | null;
  Parallelism: number | null;
}

export interface MasterPasswordUnlock {
  Kdf: MasterPasswordUnlockKdf;
  MasterKeyEncryptedUserKey: string;
  MasterKeyWrappedUserKey: string;
  Salt: string;
  Object: string;
}

export interface UserDecryptionOptions {
  HasMasterPassword: boolean;
  Object: string;
  /** Bitwarden Android 2026.1.x 要求此字段存在，缺失会导致空保险库解锁失败 */
  MasterPasswordUnlock: MasterPasswordUnlock;
  TrustedDeviceOption: null;
  KeyConnectorOption: null;
}

/** API 响应类型 */
export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
  web_session?: boolean;
  TwoFactorToken?: string;
  Key: string;
  PrivateKey: string | null;
  Kdf: number;
  KdfIterations: number;
  KdfMemory?: number;
  KdfParallelism?: number;
  ForcePasswordReset: boolean;
  ResetMasterPassword: boolean;
  scope: string;
  unofficialServer: boolean;
  MasterPasswordPolicy?: {
    Object: string;
  } | null;
  ApiUseKeyConnector?: boolean;
  AccountKeys?: any | null;
  accountKeys?: any | null;
  UserDecryptionOptions: UserDecryptionOptions;
  userDecryptionOptions?: UserDecryptionOptions;
  VaultKeys?: {
    symEncKey: string;
    symMacKey: string;
  };
}

export interface ProfileResponse {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  premium: boolean;
  premiumFromOrganization: boolean;
  usesKeyConnector: boolean;
  masterPasswordHint: string | null;
  culture: string;
  twoFactorEnabled: boolean;
  key: string;
  privateKey: string | null;
  accountKeys: any | null;
  securityStamp: string;
  organizations: any[];
  providers: any[];
  providerOrganizations: any[];
  forcePasswordReset: boolean;
  avatarColor: string | null;
  creationDate: string;
  verifyDevices?: boolean;
  role?: UserRole;
  status?: UserStatus;
  object: string;
}

export interface CipherResponse {
  id: string;
  organizationId: string | null;
  folderId: string | null;
  type: number;
  name: string | null;
  notes: string | null;
  favorite: boolean;
  login: CipherLogin | null;
  card: CipherCard | null;
  identity: CipherIdentity | null;
  secureNote: CipherSecureNote | null;
  sshKey: CipherSshKey | null;
  fields: CipherField[] | null;
  passwordHistory: PasswordHistory[] | null;
  reprompt: number;
  organizationUseTotp: boolean;
  creationDate: string;
  revisionDate: string;
  deletedDate: string | null;
  archivedDate: string | null;
  edit: boolean;
  viewPassword: boolean;
  permissions: CipherPermissions | null;
  object: string;
  collectionIds: string[];
  attachments: any[] | null;
  key: string | null;
  encryptedFor: string | null;
  /** 允许未知字段透传到客户端 */
  [key: string]: any;
}

export interface CipherPermissions {
  delete: boolean;
  restore: boolean;
}

export interface FolderResponse {
  id: string;
  name: string;
  revisionDate: string;
  creationDate: string;
  object: string;
}

export interface SyncResponse {
  profile: ProfileResponse;
  folders: FolderResponse[];
  collections: any[];
  ciphers: CipherResponse[];
  domains: any;
  policies: any[];
  sends: SendResponse[];
  UserDecryption?: {
    MasterPasswordUnlock: MasterPasswordUnlock | null;
    TrustedDeviceOption?: null;
    KeyConnectorOption?: null;
    WebAuthnPrfOption?: null;
    Object?: string;
  } | null;
  /** PascalCase 格式，用于桌面/浏览器客户端 */
  UserDecryptionOptions: UserDecryptionOptions | null;
  /** camelCase 格式，用于 Android 客户端（SyncResponseJson 使用 @SerialName("userDecryption")） */
  userDecryption: {
    masterPasswordUnlock: {
      kdf: {
        kdfType: number;
        iterations: number;
        memory: number | null;
        parallelism: number | null;
      };
      masterKeyWrappedUserKey: string;
      masterKeyEncryptedUserKey: string;
      salt: string;
    } | null;
  } | null;
  object: string;
}
