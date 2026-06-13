import { notifyUserVaultSync } from '../durable/notifications-hub';
import { StorageService } from '../services/storage';
import type {
  Attachment,
  Cipher,
  CipherCard,
  CipherIdentity,
  CipherLogin,
  CipherResponse,
  CipherSecureNote,
  CipherSshKey,
  Env,
  PasswordHistory,
} from '../types';
import { readActingDeviceIdentifier } from '../utils/device';
import { encodeContinuationToken, parsePagination } from '../utils/pagination';
import { errorResponse, jsonResponse } from '../utils/response';
import { generateUUID } from '../utils/uuid';
import { deleteAllAttachmentsForCipher, deleteAllAttachmentsForCiphers } from './attachments';

// 约定：
// Cipher JSON 是 Bitwarden 兼容性风险最高的接口面。默认保留未知/未来的客户端字段，
// 仅覆盖服务端拥有的字段。cipher 响应结构的任何变更都必须检查 /api/sync、
// 附件、导入/导出以及当前官方客户端的兼容性。
function normalizeOptionalId(value: unknown): string | null {
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function notifyVaultSyncForRequest(
  request: Request,
  env: Env,
  userId: string,
  revisionDate: string
): void {
  notifyUserVaultSync(env, userId, revisionDate, readActingDeviceIdentifier(request));
}

function getAliasedProp(
  source: Record<string, unknown> | null | undefined,
  aliases: string[]
): { present: boolean; value: unknown } {
  if (!source || typeof source !== 'object') return { present: false, value: undefined };
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return { present: true, value: source[key] };
    }
  }
  return { present: false, value: undefined };
}

function readCipherProp<T = unknown>(
  source: Record<string, unknown> | null | undefined,
  aliases: string[]
): { present: boolean; value: T | undefined } {
  return getAliasedProp(source, aliases) as { present: boolean; value: T | undefined };
}

function normalizeCipherTimestamp(value: unknown): string | null {
  if (value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function readCipherArchivedAt(source: Record<string, unknown> | null | undefined, fallback: string | null = null): string | null {
  const archived = getAliasedProp(source, [
    'archivedAt',
    'ArchivedAt',
    'archivedDate',
    'ArchivedDate',
  ]);
  return archived.present ? normalizeCipherTimestamp(archived.value) : fallback;
}

function readCipherRevisionDate(source: Record<string, unknown> | null | undefined): string | null {
  const revision = getAliasedProp(source, ['lastKnownRevisionDate', 'LastKnownRevisionDate']);
  return revision.present ? normalizeCipherTimestamp(revision.value) : null;
}

function isStaleCipherUpdate(
  existingUpdatedAt: string,
  clientRevisionDate: string | null
): boolean {
  if (!clientRevisionDate) return false;
  const existingTs = Date.parse(existingUpdatedAt);
  const clientTs = Date.parse(clientRevisionDate);
  if (Number.isNaN(existingTs) || Number.isNaN(clientTs)) return false;
  return existingTs - clientTs > 1000;
}

function syncCipherComputedAliases(cipher: Cipher): Cipher {
  cipher.archivedDate = cipher.archivedAt ?? null;
  cipher.deletedDate = cipher.deletedAt ?? null;
  return cipher;
}

function isValidEncString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0) return false;
  const type = Number(trimmed.slice(0, dot));
  if (!Number.isInteger(type) || type < 0) return false;
  const parts = trimmed.slice(dot + 1).split('|');
  if (parts.some((part) => part.length === 0)) return false;

  // Bitwarden 旧版对称 EncString 变体需要 IV + 数据，
  // 而经过认证的 AES-CBC-HMAC 变体需要 IV + 数据 + MAC。
  if (type === 0 || type === 1 || type === 4) return parts.length >= 2;
  if (type === 2) return parts.length === 3;

  // 保持较新的单部分格式（如 COSE Encrypt0）的前向兼容性。
  return parts.length >= 1;
}

function optionalEncString(value: unknown): string | null {
  if (value === null || value === '') return null;
  return isValidEncString(value) ? value.trim() : null;
}

function sanitizeEncryptedObject<T extends Record<string, unknown>>(
  source: T | null | undefined,
  encryptedKeys: readonly string[]
): T | null {
  if (!source || typeof source !== 'object') return source ?? null;
  const next = { ...source } as Record<string, unknown>;
  for (const key of encryptedKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    next[key] = optionalEncString(next[key]);
  }
  return next as T;
}

function normalizeCipherForStorage(cipher: Cipher): Cipher {
  cipher.login = normalizeCipherLoginForStorage(cipher.login as Record<string, unknown>);
  cipher.sshKey = normalizeCipherSshKeyForCompatibility(cipher.sshKey as Record<string, unknown>);
  cipher.folderId = normalizeOptionalId(cipher.folderId);
  const hasArchivedAt = Object.prototype.hasOwnProperty.call(cipher as object, 'archivedAt');
  cipher.archivedAt = hasArchivedAt
    ? (normalizeCipherTimestamp(cipher.archivedAt) ?? null)
    : (normalizeCipherTimestamp(cipher.archivedDate) ?? null);
  return syncCipherComputedAliases(cipher);
}

export function normalizeCipherLoginForStorage(
  login: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!login || typeof login !== 'object') return login ?? null;
  return {
    ...login,
    fido2Credentials: Array.isArray(login.fido2Credentials) ? login.fido2Credentials : null,
  };
}

export function normalizeCipherLoginForCompatibility(
  login: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const normalized = normalizeCipherLoginForStorage(login);
  if (!normalized || typeof normalized !== 'object') return normalized ?? null;
  const next = sanitizeEncryptedObject(normalized, ['username', 'password', 'totp', 'uri']);
  if (!next) return null;
  next.uris = Array.isArray(next.uris)
    ? (next.uris as Record<string, unknown>[])
        .map((uri) => sanitizeEncryptedObject(uri, ['uri', 'uriChecksum']))
        .filter((uri) => !!uri && (uri.uri || uri.uriChecksum || uri.match !== null))
    : null;
  next.fido2Credentials = normalizeFido2CredentialsForCompatibility(next.fido2Credentials);
  return next;
}

function normalizeFido2CredentialsForCompatibility(
  credentials: unknown
): Record<string, unknown>[] | null {
  if (!Array.isArray(credentials) || credentials.length === 0) return null;
  const requiredEncryptedKeys = [
    'credentialId',
    'keyType',
    'keyAlgorithm',
    'keyCurve',
    'keyValue',
    'rpId',
    'counter',
    'discoverable',
  ];
  const optionalEncryptedKeys = ['userHandle', 'userName', 'rpName', 'userDisplayName'];
  const out: Record<string, unknown>[] = [];

  for (const credential of credentials) {
    if (!credential || typeof credential !== 'object') continue;
    const next = { ...credential } as Record<string, unknown>;
    let valid = true;
    for (const key of requiredEncryptedKeys) {
      if (!isValidEncString(next[key])) {
        valid = false;
        break;
      }
      next[key] = String(next[key]).trim();
    }
    if (!valid) continue;
    for (const key of optionalEncryptedKeys) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        next[key] = optionalEncString(next[key]);
      }
    }
    out.push(next);
  }

  return out.length ? out : null;
}

// Android 2026.2.0 要求同步载荷中包含 sshKey.keyFingerprint。
// 同时保留旧版别名 "fingerprint" 以兼容旧版 Web 载荷。
export function normalizeCipherSshKeyForCompatibility(
  sshKey: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!sshKey || typeof sshKey !== 'object') return sshKey ?? null;

  const candidate =
    sshKey.keyFingerprint !== undefined && sshKey.keyFingerprint !== null
      ? sshKey.keyFingerprint
      : sshKey.fingerprint;

  const normalizedFingerprint =
    candidate === undefined || candidate === null ? '' : String(candidate);

  if (
    !isValidEncString(sshKey.privateKey) ||
    !isValidEncString(sshKey.publicKey) ||
    !isValidEncString(normalizedFingerprint)
  ) {
    return null;
  }

  return {
    ...sshKey,
    privateKey: String(sshKey.privateKey).trim(),
    publicKey: String(sshKey.publicKey).trim(),
    keyFingerprint: normalizedFingerprint,
    fingerprint: normalizedFingerprint,
  };
}

// 为 API 响应格式化附件
export function formatAttachments(attachments: Attachment[]): any[] | null {
  if (attachments.length === 0) return null;
  const formatted = attachments
    .filter((a) => isValidEncString(a.fileName))
    .map((a) => ({
      id: a.id,
      fileName: a.fileName.trim(),
      // Bitwarden 客户端在 cipher 载荷中将附件大小解码为字符串。
      size: String(Number(a.size) || 0),
      sizeName: a.sizeName,
      key: optionalEncString(a.key),
      url: `/api/ciphers/${a.cipherId}/attachment/${a.id}`, // Android 要求 url 非空！
      object: 'attachment',
    }));
  return formatted.length ? formatted : null;
}

function normalizeCipherFieldsForCompatibility(
  fields: unknown
): Record<string, unknown>[] | null {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const out = fields
    .map((field) => {
      if (!field || typeof field !== 'object') return null;
      const f = field as Record<string, unknown>;
      return {
        ...f,
        name: optionalEncString(f.name),
        value: optionalEncString(f.value),
        type: Number(f.type) || 0,
        linkedId: f.linkedId ?? null,
      };
    })
    .filter(Boolean);
  return out.length ? (out as Record<string, unknown>[]) : null;
}

function normalizePasswordHistoryForCompatibility(
  passwordHistory: unknown
): PasswordHistory[] | null {
  if (!Array.isArray(passwordHistory) || passwordHistory.length === 0) return null;
  const out = passwordHistory
    .filter((entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && isValidEncString((entry as Record<string, unknown>).password)
    )
    .map((entry) => ({
      ...entry,
      password: String(entry.password).trim(),
      lastUsedDate: normalizeCipherTimestamp(entry.lastUsedDate) ?? new Date().toISOString(),
    }));
  return out.length ? out : null;
}

export function isCipherResponseSyncCompatible(cipher: CipherResponse): boolean {
  return isValidEncString(cipher.name);
}

// 将内部 cipher 转换为 API 响应格式。
// 使用不透明透传：展开所有存储字段（包括未知/未来字段），
// 然后覆盖服务端计算的字段。这确保新的 Bitwarden 客户端字段
// 在无需代码变更的情况下能完整往返。
export function cipherToResponse(cipher: Cipher, attachments: Attachment[] = []): CipherResponse {
  // 移除不应出现在 API 响应中的纯内部字段
  const { userId, createdAt, updatedAt, archivedAt, deletedAt, ...passthrough } = cipher;
  const normalizedLogin = normalizeCipherLoginForCompatibility((passthrough as Record<string, unknown>).login ?? null);
  const normalizedCard = sanitizeEncryptedObject((passthrough as Record<string, unknown>).card ?? null, [
    'cardholderName',
    'brand',
    'number',
    'expMonth',
    'expYear',
    'code',
  ]);
  const normalizedIdentity = sanitizeEncryptedObject((passthrough as Record<string, unknown>).identity ?? null, [
    'title',
    'firstName',
    'middleName',
    'lastName',
    'address1',
    'address2',
    'address3',
    'city',
    'state',
    'postalCode',
    'country',
    'company',
    'email',
    'phone',
    'ssn',
    'username',
    'passportNumber',
    'licenseNumber',
  ]);
  const normalizedSshKey = normalizeCipherSshKeyForCompatibility(
    (passthrough as Record<string, unknown>).sshKey ?? null
  );

  return {
    // 传递所有存储的 cipher 字段（已知 + 未知）
    ...passthrough,
    // 服务端计算/强制的字段（始终覆盖）
    folderId: normalizeOptionalId(cipher.folderId),
    type: Number(cipher.type) || 1,
    organizationId: normalizeOptionalId((passthrough as Record<string, unknown>).organizationId ?? null),
    organizationUseTotp: !!((passthrough as Record<string, unknown>).organizationUseTotp ?? false),
    creationDate: createdAt,
    revisionDate: updatedAt,
    deletedDate: deletedAt,
    archivedDate: archivedAt ?? null,
    edit: true,
    viewPassword: true,
    permissions: {
      delete: true,
      restore: true,
    },
    object: 'cipherDetails',
    collectionIds: Array.isArray((passthrough as Record<string, unknown>).collectionIds)
      ? (passthrough as Record<string, unknown>).collectionIds
      : [],
    attachments: formatAttachments(attachments),
    name: isValidEncString(cipher.name) ? cipher.name.trim() : cipher.name,
    notes: optionalEncString(cipher.notes),
    login: normalizedLogin,
    card: normalizedCard,
    identity: normalizedIdentity,
    fields: normalizeCipherFieldsForCompatibility((passthrough as Record<string, unknown>).fields),
    passwordHistory: normalizePasswordHistoryForCompatibility((passthrough as Record<string, unknown>).passwordHistory),
    sshKey: normalizedSshKey,
    key: optionalEncString(cipher.key),
    encryptedFor: (passthrough as Record<string, unknown>).encryptedFor ?? null,
  };
}

// [GET] /api/ciphers - 获取密码项列表
export async function handleGetCiphers(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('deleted') === 'true';
  const pagination = parsePagination(url);

  let filteredCiphers: Cipher[];
  let continuationToken: string | null = null;
  if (pagination) {
    const pageRows = await storage.getCiphersPage(
      userId,
      includeDeleted,
      pagination.limit + 1,
      pagination.offset
    );
    const hasNext = pageRows.length > pagination.limit;
    filteredCiphers = hasNext ? pageRows.slice(0, pagination.limit) : pageRows;
    continuationToken = hasNext
      ? encodeContinuationToken(pagination.offset + filteredCiphers.length)
      : null;
  } else {
    const ciphers = await storage.getAllCiphers(userId);
    filteredCiphers = includeDeleted ? ciphers : ciphers.filter((c) => !c.deletedAt);
  }

  const attachmentsByCipher = await storage.getAttachmentsByCipherIds(
    filteredCiphers.map((cipher) => cipher.id)
  );

  // 仅为当前页构建响应，保持分页效率。
  const cipherResponses: CipherResponse[] = [];
  for (const cipher of filteredCiphers) {
    const attachments = attachmentsByCipher.get(cipher.id) || [];
    cipherResponses.push(cipherToResponse(cipher, attachments));
  }

  return jsonResponse({
    data: cipherResponses,
    object: 'list',
    continuationToken: continuationToken,
  });
}

// [GET] /api/ciphers/:id - 获取单个密码项
export async function handleGetCipher(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || cipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }

  const attachments = await storage.getAttachmentsByCipher(cipher.id);
  return jsonResponse(cipherToResponse(cipher, attachments));
}

async function verifyFolderOwnership(
  storage: StorageService,
  folderId: string | null | undefined,
  userId: string
): Promise<boolean> {
  if (!folderId) return true;
  const folder = await storage.getFolder(folderId);
  return !!(folder && folder.userId === userId);
}

// [POST] /api/ciphers - 创建密码项
export async function handleCreateCipher(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  // 处理嵌套的 cipher 对象（部分客户端发送）
  // Android 客户端对组织 cipher 发送 PascalCase 格式的 "Cipher"
  const cipherData = (body.Cipher || body.cipher || body) as Record<string, unknown>;
  const createFolderId = readCipherProp<string | null>(cipherData, ['folderId', 'FolderId']);
  const createKey = readCipherProp<string | null>(cipherData, ['key', 'Key']);
  const createLogin = readCipherProp<CipherLogin | null>(cipherData, ['login', 'Login']);
  const createCard = readCipherProp<CipherCard | null>(cipherData, ['card', 'Card']);
  const createIdentity = readCipherProp<CipherIdentity | null>(cipherData, [
    'identity',
    'Identity',
  ]);
  const createSecureNote = readCipherProp<CipherSecureNote | null>(cipherData, [
    'secureNote',
    'SecureNote',
  ]);
  const createSshKey = readCipherProp<CipherSshKey | null>(cipherData, ['sshKey', 'SshKey']);
  const createPasswordHistory = readCipherProp<PasswordHistory[] | null>(cipherData, [
    'passwordHistory',
    'PasswordHistory',
  ]);

  const now = new Date().toISOString();
  // 不透明透传：展开所有客户端字段以保留未知/未来字段，
  // 然后仅覆盖服务端控制的字段。
  const cipher: Cipher = {
    ...cipherData,
    // 服务端控制的字段（始终覆盖客户端值）
    id: generateUUID(),
    userId: userId,
    type: Number(cipherData.type) || 1,
    favorite: !!cipherData.favorite,
    reprompt: cipherData.reprompt || 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: readCipherArchivedAt(cipherData, null),
    deletedAt: null,
  };
  cipher.folderId = createFolderId.present
    ? normalizeOptionalId(createFolderId.value)
    : normalizeOptionalId(cipher.folderId);
  cipher.key = createKey.present ? (createKey.value ?? null) : (cipher.key ?? null);
  cipher.login = createLogin.present ? (createLogin.value ?? null) : (cipher.login ?? null);
  cipher.card = createCard.present ? (createCard.value ?? null) : (cipher.card ?? null);
  cipher.identity = createIdentity.present
    ? (createIdentity.value ?? null)
    : (cipher.identity ?? null);
  cipher.secureNote = createSecureNote.present
    ? (createSecureNote.value ?? null)
    : (cipher.secureNote ?? null);
  cipher.sshKey = createSshKey.present ? (createSshKey.value ?? null) : (cipher.sshKey ?? null);
  cipher.passwordHistory = createPasswordHistory.present
    ? (createPasswordHistory.value ?? null)
    : (cipher.passwordHistory ?? null);
  const createFields = getAliasedProp(cipherData, ['fields', 'Fields']);
  cipher.fields = createFields.present ? (createFields.value ?? null) : (cipher.fields ?? null);
  normalizeCipherForStorage(cipher);

  // 防止引用其他用户拥有的文件夹。
  if (cipher.folderId) {
    const folderOk = await verifyFolderOwnership(storage, cipher.folderId, userId);
    if (!folderOk) return errorResponse('Folder not found', 404);
  }

  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);

  return jsonResponse(cipherToResponse(cipher, []), 200);
}

// [PUT] /api/ciphers/:id - 更新密码项
export async function handleUpdateCipher(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const existingCipher = await storage.getCipher(id);

  if (!existingCipher || existingCipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  // 处理嵌套的 cipher 对象
  // Android 客户端对组织 cipher 发送 PascalCase 格式的 "Cipher"
  const cipherData = (body.Cipher || body.cipher || body) as Record<string, unknown>;
  const incomingFolderId = readCipherProp<string | null>(cipherData, ['folderId', 'FolderId']);
  const incomingKey = readCipherProp<string | null>(cipherData, ['key', 'Key']);
  const incomingLogin = readCipherProp<CipherLogin | null>(cipherData, ['login', 'Login']);
  const incomingCard = readCipherProp<CipherCard | null>(cipherData, ['card', 'Card']);
  const incomingIdentity = readCipherProp<CipherIdentity | null>(cipherData, [
    'identity',
    'Identity',
  ]);
  const incomingSecureNote = readCipherProp<CipherSecureNote | null>(cipherData, [
    'secureNote',
    'SecureNote',
  ]);
  const incomingSshKey = readCipherProp<CipherSshKey | null>(cipherData, ['sshKey', 'SshKey']);
  const incomingPasswordHistory = readCipherProp<PasswordHistory[] | null>(cipherData, [
    'passwordHistory',
    'PasswordHistory',
  ]);
  const incomingRevisionDate = readCipherRevisionDate(cipherData);

  if (isStaleCipherUpdate(existingCipher.updatedAt, incomingRevisionDate)) {
    return errorResponse(
      'The client copy of this cipher is out of date. Resync the client and try again.',
      400
    );
  }

  const nextType = Number(cipherData.type) || existingCipher.type;

  // 不透明透传：合并现有存储数据与所有传入的客户端字段。
  // 客户端的未知/未来字段被保留；服务端控制的字段受到保护。
  const cipher: Cipher = {
    ...existingCipher, // start with all existing stored data (including unknowns)
    ...cipherData, // overlay all client data (including new/unknown fields)
    // 服务端控制的字段（不来自客户端）
    id: existingCipher.id,
    userId: existingCipher.userId,
    type: nextType,
    favorite: cipherData.favorite ?? existingCipher.favorite,
    reprompt: cipherData.reprompt ?? existingCipher.reprompt,
    createdAt: existingCipher.createdAt,
    updatedAt: new Date().toISOString(),
    archivedAt: readCipherArchivedAt(cipherData, existingCipher.archivedAt ?? null),
    deletedAt: existingCipher.deletedAt,
  };
  if (incomingFolderId.present) {
    cipher.folderId = normalizeOptionalId(incomingFolderId.value);
  }
  if (incomingKey.present) {
    cipher.key = incomingKey.value ?? null;
  }
  cipher.login =
    nextType === 1
      ? incomingLogin.present
        ? (incomingLogin.value ?? null)
        : (existingCipher.login ?? null)
      : null;
  cipher.secureNote =
    nextType === 2
      ? incomingSecureNote.present
        ? (incomingSecureNote.value ?? null)
        : (existingCipher.secureNote ?? null)
      : null;
  cipher.card =
    nextType === 3
      ? incomingCard.present
        ? (incomingCard.value ?? null)
        : (existingCipher.card ?? null)
      : null;
  cipher.identity =
    nextType === 4
      ? incomingIdentity.present
        ? (incomingIdentity.value ?? null)
        : (existingCipher.identity ?? null)
      : null;
  cipher.sshKey =
    nextType === 5
      ? incomingSshKey.present
        ? (incomingSshKey.value ?? null)
        : (existingCipher.sshKey ?? null)
      : null;
  if (incomingPasswordHistory.present) {
    cipher.passwordHistory = incomingPasswordHistory.value ?? null;
  }

  // 自定义字段删除兼容性：
  // - 接受 camelCase "fields" 和 PascalCase "Fields"。
  // - 对于完整更新（此端点的 PUT/POST），缺失字段意味着清空字段。
  //   这防止了陈旧的自定义字段通过合并回退被恢复。
  const incomingFields = getAliasedProp(cipherData, ['fields', 'Fields']);
  if (incomingFields.present) {
    cipher.fields = incomingFields.value ?? null;
  } else if (request.method === 'PUT' || request.method === 'POST') {
    cipher.fields = null;
  }
  normalizeCipherForStorage(cipher);

  // 防止引用其他用户拥有的文件夹。
  if (cipher.folderId) {
    const folderOk = await verifyFolderOwnership(storage, cipher.folderId, userId);
    if (!folderOk) return errorResponse('Folder not found', 404);
  }

  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);
  const attachments = await storage.getAttachmentsByCipher(cipher.id);

  return jsonResponse(cipherToResponse(cipher, attachments));
}

// [DELETE] /api/ciphers/:id - 软删除密码项
export async function handleDeleteCipher(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || cipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }

  // 软删除
  cipher.deletedAt = new Date().toISOString();
  cipher.updatedAt = cipher.deletedAt;
  syncCipherComputedAliases(cipher);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);

  return jsonResponse(cipherToResponse(cipher, []));
}

// [DELETE] /api/ciphers/:id（兼容模式）
// Bitwarden 客户端可能对已移至回收站的项目调用 DELETE 以永久清除。
// 兼容性处理：
// - 如果项目处于活动状态 -> 软删除。
// - 如果项目已被软删除 -> 硬删除。
export async function handleDeleteCipherCompat(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || cipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }

  if (cipher.deletedAt) {
    await deleteAllAttachmentsForCipher(env, id);
    await storage.deleteCipher(id, userId);
    const revisionDate = await storage.updateRevisionDate(userId);
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
    return new Response(null, { status: 204 });
  }

  return handleDeleteCipher(request, env, userId, id);
}

// [DELETE] /api/ciphers/:id（永久删除）
export async function handlePermanentDeleteCipher(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || cipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }

  // 首先删除所有附件
  await deleteAllAttachmentsForCipher(env, id);

  await storage.deleteCipher(id, userId);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);

  return new Response(null, { status: 204 });
}

// [PUT] /api/ciphers/:id/restore - 恢复密码项
export async function handleRestoreCipher(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || cipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }

  cipher.deletedAt = null;
  cipher.updatedAt = new Date().toISOString();
  syncCipherComputedAliases(cipher);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);

  return jsonResponse(cipherToResponse(cipher, []));
}

// [PUT] /api/ciphers/:id/partial - 仅更新收藏夹/文件夹
export async function handlePartialUpdateCipher(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || cipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }

  let body: { folderId?: string | null; favorite?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (body.folderId !== undefined) {
    const folderId = normalizeOptionalId(body.folderId);
    if (folderId) {
      const folderOk = await verifyFolderOwnership(storage, folderId, userId);
      if (!folderOk) return errorResponse('Folder not found', 404);
    }
    cipher.folderId = folderId;
  }
  if (body.favorite !== undefined) {
    cipher.favorite = body.favorite;
  }
  cipher.updatedAt = new Date().toISOString();
  syncCipherComputedAliases(cipher);

  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);

  return jsonResponse(cipherToResponse(cipher, []));
}

// [POST/PUT] /api/ciphers/move - 批量移动到文件夹
export async function handleBulkMoveCiphers(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: string[]; folderId?: string | null };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.ids || !Array.isArray(body.ids)) {
    return errorResponse('ids array is required', 400);
  }

  const folderId = normalizeOptionalId(body.folderId);
  if (folderId) {
    const folderOk = await verifyFolderOwnership(storage, folderId, userId);
    if (!folderOk) return errorResponse('Folder not found', 404);
  }

  const revisionDate = await storage.bulkMoveCiphers(body.ids, folderId, userId);
  if (revisionDate) {
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
  }

  return new Response(null, { status: 204 });
}

async function buildCipherListResponse(
  request: Request,
  storage: StorageService,
  userId: string,
  ids: string[]
): Promise<Response> {
  const ciphers = await storage.getCiphersByIds(ids, userId);
  const attachmentsByCipher = await storage.getAttachmentsByCipherIds(
    ciphers.map((cipher) => cipher.id)
  );

  return jsonResponse({
    data: ciphers.map((cipher) =>
      cipherToResponse(cipher, attachmentsByCipher.get(cipher.id) || [])
    ),
    object: 'list',
    continuationToken: null,
  });
}

function parseCipherIdList(body: { ids?: unknown }): string[] | null {
  if (!Array.isArray(body.ids)) return null;
  return Array.from(new Set(body.ids.map((id) => String(id || '').trim()).filter(Boolean)));
}

// [PUT/POST] /api/ciphers/:id/archive - 归档密码项
export async function handleArchiveCipher(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || cipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }
  if (cipher.deletedAt) {
    return errorResponse('Cannot archive a deleted cipher', 400);
  }

  cipher.archivedAt = new Date().toISOString();
  cipher.updatedAt = cipher.archivedAt;
  normalizeCipherForStorage(cipher);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);

  const attachments = await storage.getAttachmentsByCipher(cipher.id);
  return jsonResponse(cipherToResponse(cipher, attachments));
}

// [PUT/POST] /api/ciphers/:id/unarchive - 取消归档密码项
export async function handleUnarchiveCipher(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const cipher = await storage.getCipher(id);

  if (!cipher || cipher.userId !== userId) {
    return errorResponse('Cipher not found', 404);
  }

  cipher.archivedAt = null;
  cipher.updatedAt = new Date().toISOString();
  normalizeCipherForStorage(cipher);
  await storage.saveCipher(cipher);
  const revisionDate = await storage.updateRevisionDate(userId);
  notifyVaultSyncForRequest(request, env, userId, revisionDate);

  const attachments = await storage.getAttachmentsByCipher(cipher.id);
  return jsonResponse(cipherToResponse(cipher, attachments));
}

// [PUT/POST] /api/ciphers/archive - 批量归档
export async function handleBulkArchiveCiphers(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const ids = parseCipherIdList(body);
  if (!ids) {
    return errorResponse('ids array is required', 400);
  }

  const revisionDate = await storage.bulkArchiveCiphers(ids, userId);
  if (revisionDate) {
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
  }

  return buildCipherListResponse(request, storage, userId, ids);
}

// [PUT/POST] /api/ciphers/unarchive - 批量取消归档
export async function handleBulkUnarchiveCiphers(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const ids = parseCipherIdList(body);
  if (!ids) {
    return errorResponse('ids array is required', 400);
  }

  const revisionDate = await storage.bulkUnarchiveCiphers(ids, userId);
  if (revisionDate) {
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
  }

  return buildCipherListResponse(request, storage, userId, ids);
}

// [POST] /api/ciphers/delete - 批量软删除
export async function handleBulkDeleteCiphers(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.ids || !Array.isArray(body.ids)) {
    return errorResponse('ids array is required', 400);
  }

  const revisionDate = await storage.bulkSoftDeleteCiphers(body.ids, userId);
  if (revisionDate) {
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
  }

  return new Response(null, { status: 204 });
}

// [POST] /api/ciphers/restore - 批量恢复
export async function handleBulkRestoreCiphers(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.ids || !Array.isArray(body.ids)) {
    return errorResponse('ids array is required', 400);
  }

  const revisionDate = await storage.bulkRestoreCiphers(body.ids, userId);
  if (revisionDate) {
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
  }

  return new Response(null, { status: 204 });
}

// [POST] /api/ciphers/delete-permanent - 批量永久删除
export async function handleBulkPermanentDeleteCiphers(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);

  let body: { ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  if (!body.ids || !Array.isArray(body.ids)) {
    return errorResponse('ids array is required', 400);
  }

  const ids = Array.from(new Set(body.ids.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) {
    return new Response(null, { status: 204 });
  }

  const ownedCiphers = await storage.getCiphersByIds(ids, userId);
  const ownedIds = ownedCiphers.map((cipher) => cipher.id);
  if (!ownedIds.length) {
    return new Response(null, { status: 204 });
  }

  await deleteAllAttachmentsForCiphers(env, ownedIds);

  const revisionDate = await storage.bulkDeleteCiphers(ownedIds, userId);
  if (revisionDate) {
    notifyVaultSyncForRequest(request, env, userId, revisionDate);
  }

  return new Response(null, { status: 204 });
}
