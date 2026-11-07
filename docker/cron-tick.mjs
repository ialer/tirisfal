#!/usr/bin/env node
/**
 * 容器内 cron tick：wrangler dev 不执行 [triggers] crons，
 * 这里按 5 分钟边界调用 /__scheduled（需 --test-scheduled）。
 * 备份与审计清理自带「到期才执行」判断，重复触发安全。
 */
const PORT = process.env.PORT || '8787';
const INTERVAL_SECONDS = Number(process.env.CRON_INTERVAL_SECONDS || 300);
const URL = `http://127.0.0.1:${PORT}/__scheduled?cron=%2A%2F5%20%2A%20%2A%20%2A%20%2A`;

let stopped = false;
process.on('SIGTERM', () => {
  stopped = true;
});
process.on('SIGINT', () => {
  stopped = true;
});

async function tick() {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) console.error(`[cron] /__scheduled -> ${res.status}`);
  } catch (error) {
    console.error('[cron] tick failed:', error instanceof Error ? error.message : error);
  }
}

async function main() {
  // 对齐到整 5 分钟边界
  const now = Math.floor(Date.now() / 1000);
  const wait = INTERVAL_SECONDS - (now % INTERVAL_SECONDS);
  await new Promise((r) => setTimeout(r, wait * 1000));
  while (!stopped) {
    await tick();
    await new Promise((r) => setTimeout(r, INTERVAL_SECONDS * 1000));
  }
}

void main();
