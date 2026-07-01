import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**', 'packages/tools/src/**'],
      thresholds: { statements: 80, branches: 80, lines: 80, functions: 80 },
    },
  },
});
