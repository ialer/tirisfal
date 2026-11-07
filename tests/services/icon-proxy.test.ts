import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleWebsiteIcon } from '../../src/services/icon-proxy';

function res(body: BodyInit, contentType: string): Response {
  return new Response(body, { headers: { 'Content-Type': contentType } });
}

describe('icon-proxy 安全边界', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('上游返回 SVG 时丢弃，回退到内置图标', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(res('<svg><script>alert(1)</script></svg>', 'image/svg+xml')))
    );
    const response = await handleWebsiteIcon('example.com');
    expect(response.headers.get('Content-Type')).toContain('image/svg+xml');
    const text = await response.text();
    expect(text).not.toContain('<script>');
    expect(text).toContain('Globe icon');
  });

  it('只接受位图并加 nosniff', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(res(png, 'image/png')))
    );
    const response = await handleWebsiteIcon('example.com');
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await response.arrayBuffer()).byteLength).toBe(png.byteLength);
  });

  it('超过体积上限的图标回退默认值', async () => {
    const big = new Uint8Array(300 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(big, {
            headers: { 'Content-Type': 'image/png', 'Content-Length': String(big.byteLength) },
          })
        )
      )
    );
    const response = await handleWebsiteIcon('example.com');
    const text = await response.text();
    expect(text).toContain('Globe icon');
  });

  it('上游 404 时回退，不抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 })))
    );
    const response = await handleWebsiteIcon('example.com', 'not-found');
    expect(response.status).toBe(404);
  });
});
