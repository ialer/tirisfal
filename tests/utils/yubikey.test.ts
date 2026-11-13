import { createHmac, randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyYubikeyOtp } from '../../src/services/yubikey';

const SECRET = randomBytes(20).toString('base64');
const OTP = `ccccccbcgujh${'cbdefghijklnrtuv'.repeat(2)}`;
const ENV = {
  YUBICO_CLIENT_ID: '12345',
  YUBICO_SECRET: SECRET,
} as never;

function sign(params: Record<string, string>): string {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
  return createHmac('sha1', Buffer.from(SECRET, 'base64')).update(message).digest('base64');
}

function signedResponse(params: Record<string, string>): string {
  const h = sign(params);
  const lines = Object.keys(params).map((k) => `${k}=${params[k]}`);
  lines.push(`h=${h}`);
  return `${lines.join('\n')}\n`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('YubiKey OTP 校验', () => {
  it('签名、nonce、otp 全部匹配时通过', async () => {
    const fetchMock = vi.fn((url: string) => {
      const nonce = new URL(url).searchParams.get('nonce') || '';
      return new Response(
        signedResponse({
          status: 'OK',
          otp: OTP,
          nonce,
          t: '2026-11-14T00:00:00Z0000',
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await verifyYubikeyOtp(ENV, OTP);
    expect(result.ok).toBe(true);
    expect(result.publicId).toBe(OTP.slice(0, 12));
  });

  it('响应签名错误时拒绝', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const nonce = new URL(url).searchParams.get('nonce') || '';
        return new Response(`status=OK\notp=${OTP}\nnonce=${nonce}\nh=AAAA\n`, {
          status: 200,
        });
      })
    );
    expect((await verifyYubikeyOtp(ENV, OTP)).status).toBe('BAD_SIGNATURE');
  });

  it('nonce 不匹配时拒绝', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(signedResponse({ status: 'OK', otp: OTP, nonce: 'other' }), { status: 200 })
      )
    );
    expect((await verifyYubikeyOtp(ENV, OTP)).status).toBe('BAD_NONCE');
  });

  it('YubiCloud 返回非 OK 状态时透传', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const nonce = new URL(url).searchParams.get('nonce') || '';
        return new Response(signedResponse({ status: 'REPLAYED_OTP', otp: OTP, nonce }), {
          status: 200,
        });
      })
    );
    const result = await verifyYubikeyOtp(ENV, OTP);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REPLAYED_OTP');
  });

  it('未配置时返回 NOT_CONFIGURED', async () => {
    const result = await verifyYubikeyOtp({} as never, OTP);
    expect(result.status).toBe('NOT_CONFIGURED');
  });

  it('OTP 格式不合法时直接拒绝', async () => {
    const result = await verifyYubikeyOtp(ENV, 'short');
    expect(result.status).toBe('BAD_OTP');
    expect(result.publicId).toBeNull();
  });
});
