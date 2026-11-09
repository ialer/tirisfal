import { describe, expect, it } from 'vitest';

import { readUpstreamLimited } from '../../src/handlers/sm-secrets';

describe('注入代理 · 上游响应限额', () => {
  it('小响应完整读取', async () => {
    const res = new Response('hello');
    const { bytes, truncated } = await readUpstreamLimited(res, 1024);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
    expect(truncated).toBe(false);
  });

  it('超过上限时截断并标记，不整体读入', async () => {
    const big = new Uint8Array(4096).fill(65);
    const { bytes, truncated } = await readUpstreamLimited(new Response(big), 1024);
    expect(bytes.byteLength).toBe(1024);
    expect(truncated).toBe(true);
  });

  it('Content-Length 声明超限时以实际流为准（不直接返回空体）', async () => {
    const res = new Response('tiny', { headers: { 'Content-Length': '999999' } });
    const { bytes, truncated } = await readUpstreamLimited(res, 1024);
    expect(truncated).toBe(false);
    expect(new TextDecoder().decode(bytes)).toBe('tiny');
  });
});
