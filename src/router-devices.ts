import {
  handleClearDeviceToken,
  handleDeactivateDevice,
  handleDeleteAllDevices,
  handleDeleteDevice,
  handleGetAuthorizedDevices,
  handleGetDevice,
  handleGetDeviceByIdentifier,
  handleGetDevices,
  handleRetrieveDeviceKeys,
  handleRevokeAllTrustedDevices,
  handleRevokeTrustedDevice,
  handleUntrustDevices,
  handleUpdateDeviceKeys,
  handleUpdateDeviceName,
  handleUpdateDeviceToken,
  handleUpdateDeviceTrust,
  handleUpdateDeviceWebPushAuth,
} from './handlers/devices';
import type { Env } from './types';

/**
 * 已认证设备路由处理
 * 处理设备管理、信任设备、设备密钥等操作
 */
export async function handleAuthenticatedDeviceRoute(
  request: Request,
  env: Env,
  userId: string,
  path: string,
  method: string
): Promise<Response | null> {
  // 设备列表和批量删除
  if (path === '/api/devices') {
    if (method === 'GET') return handleGetDevices(request, env, userId);
    if (method === 'DELETE') return handleDeleteAllDevices(request, env, userId);
    return null;
  }

  // 已授权设备列表和批量撤销
  if (path === '/api/devices/authorized') {
    if (method === 'GET') return handleGetAuthorizedDevices(request, env, userId);
    if (method === 'DELETE') return handleRevokeAllTrustedDevices(request, env, userId);
    return null;
  }

  // 撤销单个已授权设备
  const authorizedDeviceMatch = path.match(/^\/api\/devices\/authorized\/([^/]+)$/i);
  if (authorizedDeviceMatch && method === 'DELETE') {
    const deviceIdentifier = decodeURIComponent(authorizedDeviceMatch[1]);
    return handleRevokeTrustedDevice(request, env, userId, deviceIdentifier);
  }

  // 获取/删除单个设备
  const deleteDeviceMatch = path.match(/^\/api\/devices\/([^/]+)$/i);
  if (deleteDeviceMatch && method === 'GET') {
    const deviceIdentifier = decodeURIComponent(deleteDeviceMatch[1]);
    return handleGetDevice(request, env, userId, deviceIdentifier);
  }
  if (deleteDeviceMatch && method === 'DELETE') {
    const deviceIdentifier = decodeURIComponent(deleteDeviceMatch[1]);
    return handleDeleteDevice(request, env, userId, deviceIdentifier);
  }

  // 更新设备名称
  const updateDeviceNameMatch = path.match(/^\/api\/devices\/([^/]+)\/name$/i);
  if (updateDeviceNameMatch && method === 'PUT') {
    const deviceIdentifier = decodeURIComponent(updateDeviceNameMatch[1]);
    return handleUpdateDeviceName(request, env, userId, deviceIdentifier);
  }

  // 通过标识符获取设备
  const identifierMatch = path.match(/^\/api\/devices\/identifier\/([^/]+)$/i);
  if (identifierMatch && method === 'GET') {
    const deviceIdentifier = decodeURIComponent(identifierMatch[1]);
    return handleGetDeviceByIdentifier(request, env, userId, deviceIdentifier);
  }

  // 更新设备密钥
  const deviceKeysMatch =
    path.match(/^\/api\/devices\/([^/]+)\/keys$/i) ||
    path.match(/^\/api\/devices\/identifier\/([^/]+)\/keys$/i);
  if (deviceKeysMatch && (method === 'PUT' || method === 'POST')) {
    const deviceIdentifier = decodeURIComponent(deviceKeysMatch[1]);
    return handleUpdateDeviceKeys(request, env, userId, deviceIdentifier);
  }

  // 更新设备令牌
  const identifierTokenMatch = path.match(/^\/api\/devices\/identifier\/([^/]+)\/token$/i);
  if (identifierTokenMatch && (method === 'PUT' || method === 'POST')) {
    const deviceIdentifier = decodeURIComponent(identifierTokenMatch[1]);
    return handleUpdateDeviceToken(request, env, userId, deviceIdentifier);
  }

  // 更新 Web Push 认证
  const identifierWebPushMatch = path.match(
    /^\/api\/devices\/identifier\/([^/]+)\/web-push-auth$/i
  );
  if (identifierWebPushMatch && (method === 'PUT' || method === 'POST')) {
    const deviceIdentifier = decodeURIComponent(identifierWebPushMatch[1]);
    return handleUpdateDeviceWebPushAuth(request, env, userId, deviceIdentifier);
  }

  // 清除设备令牌
  const identifierClearTokenMatch = path.match(
    /^\/api\/devices\/identifier\/([^/]+)\/clear-token$/i
  );
  if (identifierClearTokenMatch && (method === 'PUT' || method === 'POST')) {
    const deviceIdentifier = decodeURIComponent(identifierClearTokenMatch[1]);
    return handleClearDeviceToken(request, env, userId, deviceIdentifier);
  }

  // 检索设备密钥
  const identifierRetrieveKeysMatch = path.match(/^\/api\/devices\/([^/]+)\/retrieve-keys$/i);
  if (identifierRetrieveKeysMatch && method === 'POST') {
    const deviceIdentifier = decodeURIComponent(identifierRetrieveKeysMatch[1]);
    return handleRetrieveDeviceKeys(request, env, userId, deviceIdentifier);
  }

  // 停用设备
  const identifierDeactivateMatch = path.match(/^\/api\/devices\/([^/]+)\/deactivate$/i);
  if (identifierDeactivateMatch && (method === 'POST' || method === 'DELETE')) {
    const deviceIdentifier = decodeURIComponent(identifierDeactivateMatch[1]);
    return handleDeactivateDevice(request, env, userId, deviceIdentifier);
  }

  // 更新设备信任状态
  if (path === '/api/devices/update-trust' && method === 'POST') {
    return handleUpdateDeviceTrust(request, env, userId);
  }

  // 取消设备信任
  if (path === '/api/devices/untrust' && method === 'POST') {
    return handleUntrustDevices(request, env, userId);
  }

  return null;
}
