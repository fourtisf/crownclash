import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    // Point at the source so `pnpm test` works on a clean checkout, before anything is built.
    alias: { '@crown/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // The load test runs 200 full 180-second match re-simulations; the default 5 s timeout is
    // nowhere near enough and a false failure there would be worse than no test.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // Serial by design: the load test measures CPU-bound p95, and parallel workers competing
    // for the same cores would make its numbers meaningless.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      RATE_LIMIT_ENABLED: 'false',
    },
  },
});
