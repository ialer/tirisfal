/**
 * 「必须由 worker 处理、不能被静态资源回退吞掉」的路径清单。
 *
 * 之前这份清单写在 index.ts 的私有函数里，router 里又各维护一份，
 * 结果 /health 被 SPA 回退成 index.html，监控假绿。
 * 现在收敛为单一来源，index 与需要判断路径的模块共用。
 */
const WORKER_HANDLED_PREFIXES = [
  '/api/',
  '/identity/',
  '/icons/',
  '/notifications/',
  '/two-factor/',
  '/.well-known/',
] as const;

const WORKER_HANDLED_EXACT = new Set(['/health', '/config', '/api/config', '/api/version']);

export function isWorkerHandledPath(path: string): boolean {
  if (WORKER_HANDLED_EXACT.has(path)) return true;
  return WORKER_HANDLED_PREFIXES.some((prefix) => path.startsWith(prefix));
}
