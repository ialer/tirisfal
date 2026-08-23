import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      // 统计所有源文件（含未被测试 import 的），否则阈值形同虚设
      all: true,
      // 覆盖率范围限定为后端 src（webapp 有独立工具链，sdk 为独立发布单元）
      include: ['src/**'],
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',
        'src/types/**',
      ],
    },
  },
});
