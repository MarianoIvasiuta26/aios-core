import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['hooks/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
  },
});
