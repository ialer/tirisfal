import { describe, expect, it } from 'vitest';

import { buildFileDownloadResponse } from '../../src/utils/file-download';

describe('文件下载响应契约', () => {
  it('强制 octet-stream + attachment，杜绝同源内联渲染', () => {
    const res = buildFileDownloadResponse({ body: 'hello', size: 5 });
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(res.headers.get('Content-Length')).toBe('5');
  });
});
