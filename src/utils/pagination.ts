import { LIMITS } from '../config/limits';

const MAX_PAGE_SIZE = LIMITS.pagination.maxPageSize;

/** 分页请求参数 */
export interface PaginationRequest {
  limit: number;
  offset: number;
}

/**
 * 解析 URL 中的分页参数
 * @param url - 请求 URL
 * @returns 分页参数，无分页参数则返回 null
 */
export function parsePagination(url: URL): PaginationRequest | null {
  const pageSizeRaw = url.searchParams.get('pageSize');
  const continuationToken = url.searchParams.get('continuationToken');
  if (!pageSizeRaw && !continuationToken) return null;

  const pageSize = pageSizeRaw ? Number(pageSizeRaw) : LIMITS.pagination.defaultPageSize;
  if (!Number.isInteger(pageSize) || pageSize <= 0) return null;

  const limit = Math.min(pageSize, MAX_PAGE_SIZE);
  const offset = decodeContinuationToken(continuationToken);

  return { limit, offset };
}

/**
 * 将偏移量编码为 Base64 续传令牌
 */
export function encodeContinuationToken(offset: number): string {
  return btoa(String(offset));
}

/**
 * 解码 Base64 续传令牌为偏移量
 */
export function decodeContinuationToken(token: string | null): number {
  if (!token) return 0;
  try {
    const decoded = atob(token);
    const offset = Number(decoded);
    if (!Number.isInteger(offset) || offset < 0) return 0;
    return offset;
  } catch {
    return 0;
  }
}
