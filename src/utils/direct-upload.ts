import { LIMITS } from '../config/limits';
import type { Env } from '../types';
import { DEFAULT_DEV_SECRET } from '../types';
import { errorResponse } from './response';

/** 直接上传载荷 */
export interface DirectUploadPayload {
  body: ReadableStream;
  contentType: string;
  size: number;
}

/** 直接上传解析选项 */
interface ParseDirectUploadOptions {
  expectedSize?: number | null;
  expectedFileName?: string | null;
  maxFileSize: number;
  tooLargeMessage: string;
  missingBodyMessage?: string;
  contentLengthRequiredMessage?: string;
  sizeMismatchMessage?: string;
  fileNameMismatchMessage?: string;
}

/**
 * 构建直接上传的 SAS URL
 * @param request - HTTP 请求对象
 * @param path - 上传路径
 * @param token - SAS 令牌
 * @returns 完整的上传 URL
 */
export function buildDirectUploadUrl(request: Request, path: string, token: string): string {
  const version = '2023-11-03';
  const expiresAt = '2099-12-31T23:59:59Z';
  const origin = new URL(request.url).origin;
  return `${origin}${path}?sv=${encodeURIComponent(version)}&se=${encodeURIComponent(expiresAt)}&token=${encodeURIComponent(token)}`;
}

/**
 * 获取安全的 JWT 密钥，无效则返回 null
 */
export function getSafeJwtSecret(env: Env): string | null {
  const secret = (env.JWT_SECRET || '').trim();
  if (!secret || secret.length < LIMITS.auth.jwtSecretMinLength || secret === DEFAULT_DEV_SECRET) {
    return null;
  }
  return secret;
}

/**
 * 解析 Content-Length 请求头
 */
function parseContentLength(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/**
 * 解析直接上传载荷，支持 multipart/form-data 和流式上传
 * @param request - HTTP 请求对象
 * @param options - 解析选项
 * @returns 上传载荷或错误响应
 */
export async function parseDirectUploadPayload(
  request: Request,
  options: ParseDirectUploadOptions
): Promise<DirectUploadPayload | Response> {
  const {
    expectedSize = null,
    expectedFileName = null,
    maxFileSize,
    tooLargeMessage,
    missingBodyMessage = '未上传文件',
    contentLengthRequiredMessage = '直接上传需要 Content-Length',
    sizeMismatchMessage,
    fileNameMismatchMessage,
  } = options;
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('data') as File | null;
    if (!file) {
      return errorResponse(missingBodyMessage, 400);
    }
    if (file.size > maxFileSize) {
      return errorResponse(tooLargeMessage, 413);
    }
    if (expectedFileName && file.name !== expectedFileName) {
      return errorResponse(fileNameMismatchMessage || '文件名不匹配', 400);
    }
    if (expectedSize !== null && expectedSize !== undefined && file.size !== expectedSize) {
      return errorResponse(sizeMismatchMessage || '文件大小不匹配', 400);
    }
    return {
      body: file.stream(),
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    };
  }

  if (!request.body) {
    return errorResponse(missingBodyMessage, 400);
  }

  const declaredSize = parseContentLength(request);
  const uploadSize = declaredSize ?? (expectedSize && expectedSize > 0 ? expectedSize : null);
  if (uploadSize === null) {
    return errorResponse(contentLengthRequiredMessage, 400);
  }
  if (uploadSize > maxFileSize) {
    return errorResponse(tooLargeMessage, 413);
  }
  if (expectedSize !== null && expectedSize !== undefined && uploadSize !== expectedSize) {
    return errorResponse(sizeMismatchMessage || '文件大小不匹配', 400);
  }

  return {
    body: request.body,
    contentType: contentType || 'application/octet-stream',
    size: uploadSize,
  };
}
