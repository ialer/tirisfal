import { describe, expect, it, vi } from 'vitest';

import { isWorkerHandledPath } from '../../src/config/paths';

describe('worker 受管路径', () => {
  it('/health 必须由 worker 处理，不能被静态资源吞掉', () => {
    expect(isWorkerHandledPath('/health')).toBe(true);
    expect(isWorkerHandledPath('/api/health')).toBe(true);
  });

  it('业务 API 与 identity 路由仍走 worker', () => {
    expect(isWorkerHandledPath('/api/sync')).toBe(true);
    expect(isWorkerHandledPath('/identity/connect/token')).toBe(true);
    expect(isWorkerHandledPath('/icons/example.com/icon.png')).toBe(true);
  });

  it('前端路由交给 assets', () => {
    expect(isWorkerHandledPath('/vault')).toBe(false);
    expect(isWorkerHandledPath('/')).toBe(false);
  });
});
