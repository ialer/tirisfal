import {
  handleChangePassword,
  handleGetApiKey,
  handleGetProfile,
  handleGetRevisionDate,
  handleGetTotpRecoveryCode,
  handleGetTotpStatus,
  handleRotateApiKey,
  handleSetKeys,
  handleSetTotpStatus,
  handleSetVerifyDevices,
  handleUpdateProfile,
  handleVerifyPassword,
} from './handlers/accounts';
import {
  handleCreateAttachment,
  handleDeleteAttachment,
  handleGetAttachment,
  handleUpdateAttachmentMetadata,
  handleUploadAttachment,
} from './handlers/attachments';
import {
  handleArchiveCipher,
  handleBulkArchiveCiphers,
  handleBulkDeleteCiphers,
  handleBulkMoveCiphers,
  handleBulkPermanentDeleteCiphers,
  handleBulkRestoreCiphers,
  handleBulkUnarchiveCiphers,
  handleCreateCipher,
  handleDeleteCipher,
  handleDeleteCipherCompat,
  handleGetCipher,
  handleGetCiphers,
  handlePartialUpdateCipher,
  handlePermanentDeleteCipher,
  handleRestoreCipher,
  handleUnarchiveCipher,
  handleUpdateCipher,
} from './handlers/ciphers';
import { handleGetDomains, handleUpdateDomains } from './handlers/domains';
import {
  handleBulkDeleteFolders,
  handleCreateFolder,
  handleDeleteFolder,
  handleGetFolder,
  handleGetFolders,
  handleUpdateFolder,
} from './handlers/folders';
import { handleCiphersImport } from './handlers/import';
import {
  handleBulkDeleteSends,
  handleCreateFileSendV2,
  handleCreateSend,
  handleDeleteSend,
  handleGetSend,
  handleGetSendFileUpload,
  handleGetSends,
  handleRemoveSendAuth,
  handleRemoveSendPassword,
  handleUpdateSend,
  handleUploadSendFile,
} from './handlers/sends';
import { handleSync } from './handlers/sync';
import { handleAdminRoute } from './router-admin';
import { handleAuthenticatedDeviceRoute } from './router-devices';
import type { Env, User } from './types';
import { errorResponse, jsonResponse } from './utils/response';

/**
 * 已认证路由处理
 * 处理密码项、文件夹、Send、同步等需要认证的 API 请求
 */
export async function handleAuthenticatedRoute(
  request: Request,
  env: Env,
  userId: string,
  currentUser: User,
  path: string,
  method: string
): Promise<Response | null> {
  // 已禁用的账户操作
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    const blockedAccountPaths = new Set([
      '/api/accounts/set-password',
      '/api/accounts/delete',
      '/api/accounts/delete-account',
      '/api/accounts/delete-vault',
    ]);
    if (blockedAccountPaths.has(path)) {
      return errorResponse('未实现', 501);
    }
  }

  // 用户配置接口
  if (path === '/api/accounts/profile') {
    if (method === 'GET') return handleGetProfile(request, env, userId);
    if (method === 'PUT') return handleUpdateProfile(request, env, userId);
    return errorResponse('方法不允许', 405);
  }

  // 修改密码
  if (
    (path === '/api/accounts/password' || path === '/api/accounts/change-password') &&
    (method === 'POST' || method === 'PUT')
  ) {
    return handleChangePassword(request, env, userId);
  }

  // 设置密钥
  if (path === '/api/accounts/keys' && method === 'POST') {
    return handleSetKeys(request, env, userId);
  }

  // TOTP 两步验证
  if (path === '/api/accounts/totp') {
    if (method === 'GET') return handleGetTotpStatus(request, env, userId);
    if (method === 'PUT' || method === 'POST') return handleSetTotpStatus(request, env, userId);
    return null;
  }

  // TOTP 恢复码
  if (
    (path === '/api/accounts/totp/recovery-code' || path === '/api/two-factor/get-recover') &&
    method === 'POST'
  ) {
    return handleGetTotpRecoveryCode(request, env, userId);
  }

  // 获取修订日期
  if (path === '/api/accounts/revision-date' && method === 'GET') {
    return handleGetRevisionDate(request, env, userId);
  }

  // 验证密码
  if (path === '/api/accounts/verify-password' && method === 'POST') {
    return handleVerifyPassword(request, env, userId);
  }

  // 设备验证设置
  if (path === '/api/accounts/verify-devices' && (method === 'PUT' || method === 'POST')) {
    return handleSetVerifyDevices(request, env, userId);
  }

  // API 密钥
  if ((path === '/api/accounts/api-key' || path === '/api/accounts/api_key') && method === 'POST') {
    return handleGetApiKey(request, env, userId);
  }

  // 轮换 API 密钥
  if (
    (path === '/api/accounts/rotate-api-key' || path === '/api/accounts/rotate_api_key') &&
    method === 'POST'
  ) {
    return handleRotateApiKey(request, env, userId);
  }

  // 数据同步
  if (path === '/api/sync' && method === 'GET') {
    return handleSync(request, env, userId);
  }

  // 通知路径（不支持）
  if (path.startsWith('/notifications/')) {
    return errorResponse('未找到', 404);
  }

  // 密码项管理
  if (path === '/api/ciphers' || path === '/api/ciphers/create') {
    if (method === 'GET') return handleGetCiphers(request, env, userId);
    if (method === 'POST') return handleCreateCipher(request, env, userId);
    return null;
  }

  // 批量导入密码项
  if (path === '/api/ciphers/import' && method === 'POST') {
    return handleCiphersImport(request, env, userId);
  }

  // 批量删除密码项
  if (path === '/api/ciphers/delete' && method === 'POST') {
    return handleBulkDeleteCiphers(request, env, userId);
  }

  // 批量永久删除密码项
  if (path === '/api/ciphers/delete-permanent' && method === 'POST') {
    return handleBulkPermanentDeleteCiphers(request, env, userId);
  }

  // 批量恢复密码项
  if (path === '/api/ciphers/restore' && method === 'POST') {
    return handleBulkRestoreCiphers(request, env, userId);
  }

  // 批量归档密码项
  if (path === '/api/ciphers/archive' && (method === 'PUT' || method === 'POST')) {
    return handleBulkArchiveCiphers(request, env, userId);
  }

  // 批量取消归档密码项
  if (path === '/api/ciphers/unarchive' && (method === 'PUT' || method === 'POST')) {
    return handleBulkUnarchiveCiphers(request, env, userId);
  }

  // 批量移动密码项
  if (path === '/api/ciphers/move' && (method === 'POST' || method === 'PUT')) {
    return handleBulkMoveCiphers(request, env, userId);
  }

  // 单个密码项操作
  const cipherMatch = path.match(/^\/api\/ciphers\/([a-f0-9-]+)(\/.*)?$/i);
  if (cipherMatch) {
    const cipherId = cipherMatch[1];
    const subPath = cipherMatch[2] || '';

    if (subPath === '' || subPath === '/') {
      if (method === 'GET') return handleGetCipher(request, env, userId, cipherId);
      if (method === 'PUT' || method === 'POST')
        return handleUpdateCipher(request, env, userId, cipherId);
      if (method === 'DELETE') return handleDeleteCipherCompat(request, env, userId, cipherId);
    }

    if (subPath === '/delete' && method === 'PUT')
      return handleDeleteCipher(request, env, userId, cipherId);
    if (subPath === '/delete' && method === 'DELETE')
      return handlePermanentDeleteCipher(request, env, userId, cipherId);
    if (subPath === '/restore' && method === 'PUT')
      return handleRestoreCipher(request, env, userId, cipherId);
    if (subPath === '/archive' && (method === 'PUT' || method === 'POST'))
      return handleArchiveCipher(request, env, userId, cipherId);
    if (subPath === '/unarchive' && (method === 'PUT' || method === 'POST'))
      return handleUnarchiveCipher(request, env, userId, cipherId);
    if (subPath === '/partial' && (method === 'PUT' || method === 'POST'))
      return handlePartialUpdateCipher(request, env, userId, cipherId);
    if (subPath === '/share' && method === 'POST')
      return handleGetCipher(request, env, userId, cipherId);
    if (subPath === '/details' && method === 'GET')
      return handleGetCipher(request, env, userId, cipherId);
    if (subPath === '/attachment/v2' && method === 'POST')
      return handleCreateAttachment(request, env, userId, cipherId);
    if (subPath === '/attachment' && method === 'POST')
      return handleCreateAttachment(request, env, userId, cipherId);

    // 附件操作
    const attachmentMatch = subPath.match(/^\/attachment\/([a-f0-9-]+)$/i);
    if (attachmentMatch) {
      const attachmentId = attachmentMatch[1];
      if (method === 'POST' || method === 'PUT')
        return handleUploadAttachment(request, env, userId, cipherId, attachmentId);
      if (method === 'GET')
        return handleGetAttachment(request, env, userId, cipherId, attachmentId);
      if (method === 'DELETE')
        return handleDeleteAttachment(request, env, userId, cipherId, attachmentId);
    }

    // 更新附件元数据
    const attachmentMetadataMatch = subPath.match(/^\/attachment\/([a-f0-9-]+)\/metadata$/i);
    if (attachmentMetadataMatch && (method === 'POST' || method === 'PUT')) {
      return handleUpdateAttachmentMetadata(
        request,
        env,
        userId,
        cipherId,
        attachmentMetadataMatch[1]
      );
    }

    // 删除附件
    const attachmentDeleteMatch = subPath.match(/^\/attachment\/([a-f0-9-]+)\/delete$/i);
    if (attachmentDeleteMatch && method === 'POST') {
      return handleDeleteAttachment(request, env, userId, cipherId, attachmentDeleteMatch[1]);
    }
  }

  // 文件夹管理
  if (path === '/api/folders') {
    if (method === 'GET') return handleGetFolders(request, env, userId);
    if (method === 'POST') return handleCreateFolder(request, env, userId);
    return null;
  }

  // 批量删除文件夹
  if (path === '/api/folders/delete' && method === 'POST') {
    return handleBulkDeleteFolders(request, env, userId);
  }

  // 单个文件夹操作
  const folderMatch = path.match(/^\/api\/folders\/([a-f0-9-]+)$/i);
  if (folderMatch) {
    const folderId = folderMatch[1];
    if (method === 'GET') return handleGetFolder(request, env, userId, folderId);
    if (method === 'PUT') return handleUpdateFolder(request, env, userId, folderId);
    if (method === 'DELETE') return handleDeleteFolder(request, env, userId, folderId);
  }

  // 认证请求（返回空列表）
  if (path.startsWith('/api/auth-requests')) {
    return jsonResponse({ data: [], object: 'list', continuationToken: null });
  }

  // 集合（返回空列表）
  if (path === '/api/collections' || path.startsWith('/api/collections/')) {
    if (method === 'GET') {
      return jsonResponse({ data: [], object: 'list', continuationToken: null });
    }
    return null;
  }

  // 组织（返回空列表）
  if (path === '/api/organizations' || path.startsWith('/api/organizations/')) {
    if (method === 'GET') {
      return jsonResponse({ data: [], object: 'list', continuationToken: null });
    }
    return null;
  }

  // Send 管理
  if (path === '/api/sends') {
    if (method === 'GET') return handleGetSends(request, env, userId);
    if (method === 'POST') return handleCreateSend(request, env, userId);
    return null;
  }

  // 创建文件类型 Send（V2）
  if (path === '/api/sends/file/v2' && method === 'POST') {
    return handleCreateFileSendV2(request, env, userId);
  }

  // 批量删除 Send
  if (path === '/api/sends/delete' && method === 'POST') {
    return handleBulkDeleteSends(request, env, userId);
  }

  // 单个 Send 操作
  const sendMatch = path.match(/^\/api\/sends\/([^/]+)(\/.*)?$/i);
  if (sendMatch) {
    const sendId = sendMatch[1];
    const subPath = sendMatch[2] || '';

    if (subPath === '' || subPath === '/') {
      if (method === 'GET') return handleGetSend(request, env, userId, sendId);
      if (method === 'PUT') return handleUpdateSend(request, env, userId, sendId);
      if (method === 'DELETE') return handleDeleteSend(request, env, userId, sendId);
    }

    if (subPath === '/remove-password' && (method === 'PUT' || method === 'POST')) {
      return handleRemoveSendPassword(request, env, userId, sendId);
    }

    if (subPath === '/remove-auth' && (method === 'PUT' || method === 'POST')) {
      return handleRemoveSendAuth(request, env, userId, sendId);
    }

    // Send 文件上传
    const sendFileUploadMatch = subPath.match(/^\/file\/([^/]+)\/?$/i);
    if (sendFileUploadMatch) {
      const fileId = sendFileUploadMatch[1];
      if (method === 'GET') return handleGetSendFileUpload(request, env, userId, sendId, fileId);
      if (method === 'POST' || method === 'PUT')
        return handleUploadSendFile(request, env, userId, sendId, fileId);
    }
  }

  // 策略（返回空列表）
  if (path === '/api/policies' || path.startsWith('/api/policies/')) {
    if (method === 'GET') {
      return jsonResponse({ data: [], object: 'list', continuationToken: null });
    }
    return null;
  }

  // 域名设置
  if (path === '/api/settings/domains' || path === '/settings/domains') {
    if (method === 'GET') return handleGetDomains(env, userId);
    if (method === 'PUT' || method === 'POST') return handleUpdateDomains(request, env, userId);
    return null;
  }

  // 设备管理路由
  const authenticatedDeviceResponse = await handleAuthenticatedDeviceRoute(
    request,
    env,
    userId,
    path,
    method
  );
  if (authenticatedDeviceResponse) return authenticatedDeviceResponse;

  // 管理员路由
  const adminResponse = await handleAdminRoute(request, env, currentUser, path, method);
  if (adminResponse) return adminResponse;

  return null;
}
