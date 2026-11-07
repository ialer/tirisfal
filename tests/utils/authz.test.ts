import { describe, expect, it } from 'vitest';

import { isAdminUser } from '../../src/utils/authz';

describe('isAdminUser', () => {
  it('active admin 才是管理员', () => {
    expect(isAdminUser({ role: 'admin', status: 'active' })).toBe(true);
  });

  it('非 admin 或被封禁都不是', () => {
    expect(isAdminUser({ role: 'user', status: 'active' })).toBe(false);
    expect(isAdminUser({ role: 'admin', status: 'banned' })).toBe(false);
  });

  it('空值安全', () => {
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
  });
});
