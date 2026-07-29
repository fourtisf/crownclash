import { defineConfig, devices } from '@playwright/test';

/**
 * E2E harness — handoff §8.4.
 *
 * Boots the real server and the real client and drives the full first-session journey in a
 * mobile viewport, because mobile is the primary target (§6: 480px frame, test at 380×740).
 *
 * The server runs with `PERSISTENCE=memory`, which swaps Postgres and Redis for in-process
 * fakes. That is deliberate: this suite exists to prove the *game* works end to end, and
 * making it depend on a provisioned database would mean it never runs in CI and therefore
 * never catches anything. Database-backed behaviour is covered by apps/server/test.
 */
export default defineConfig({
  testDir: './test/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...devices['Pixel 5'],
    viewport: { width: 380, height: 740 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @crown/server dev',
      port: 8080,
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        PERSISTENCE: 'memory',
        NODE_ENV: 'test',
        PORT: '8080',
        JWT_SECRET: 'e2e-test-secret-not-used-in-production-0123456789',
        COOKIE_SECRET: 'e2e-cookie-secret-not-used-in-production-0123',
        WEB_ORIGIN: 'http://127.0.0.1:5173',
      },
    },
    {
      command: 'pnpm --filter @crown/web dev',
      port: 5173,
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
});
