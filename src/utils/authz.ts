import type { User } from '../types';

/**
 * 管理员判定（role=admin 且 status=active）。
 *
 * 之前在 admin.ts 与 backup.ts 各有一份，另有 14 处手写守卫；
 * 收敛到单点后，新增后台 handler 忘记写判断的问题由 router 层兜底处理。
 */
export function isAdminUser(user: Pick<User, 'role' | 'status'> | null | undefined): boolean {
  return Boolean(user && user.role === 'admin' && user.status === 'active');
}
