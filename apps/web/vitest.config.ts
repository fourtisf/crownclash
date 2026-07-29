import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    // The workspace link resolves to the package's src entry; alias it explicitly so unit
    // tests do not need a build step.
    alias: { '@crown/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  test: {
    // Playwright owns test/e2e; vitest must not try to run those specs.
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
