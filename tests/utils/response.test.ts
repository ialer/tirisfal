import { describe, expect, it } from 'vitest';

import { errorResponse } from '../../src/utils/response';

describe('errorResponse 语义', () => {
  it('4xx 透出调用方给的字段级文案', async () => {
    const res = errorResponse('Email, masterPasswordHash, and key are required', 400);
    const body = await res.json();
    expect(body.error).toBe('Email, masterPasswordHash, and key are required');
    expect(body.ErrorModel.Message).toBe('Email, masterPasswordHash, and key are required');
  });

  it('4xx 权限原因同样透出', async () => {
    const body = await errorResponse('Access denied: outside allowed hours', 403).json();
    expect(body.error_description).toBe('Access denied: outside allowed hours');
  });

  it('5xx 默认只给通用文案', async () => {
    const body = await errorResponse('D1_ERROR: no such table users', 500).json();
    expect(body.error).toBe('服务器内部错误');
    expect(JSON.stringify(body)).not.toContain('D1_ERROR');
  });

  it('5xx 显式 exposeInternals 才透出', async () => {
    const body = await errorResponse('storage unavailable: r2 timeout', 503, true).json();
    expect(body.error).toBe('storage unavailable: r2 timeout');
  });

  it('空文案回落到状态码默认值', async () => {
    expect((await errorResponse('', 400).json()).error).toBe('请求无效');
    expect((await errorResponse('', 500).json()).error).toBe('服务器内部错误');
  });
});
