import { defineConfig, devices } from '@playwright/test';

/**
 * E2E harness — handoff §8.4.
 *
 * Boots the real server and the real client and drives the full first-session journey in a
 * mobile viewport, because mobile is the primary target (§6: 480px frame, test at 380×740).
 *
 * The server is booted by `test/e2e/server.mjs`, which builds the real Fastify app with the
 * in-memory store adapter instead of Postgres. Every route, validator and the whole
 * re-simulation path are production code — only persistence differs. That is deliberate:
 * making this suite depend on a provisioned database would mean it never runs in CI and
 * therefore never catches anything. Database-backed behaviour is covered by apps/server/test.
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
    launchOptions: {
      // Some sandboxes ship a Chromium that does not match the revision this @playwright/test
      // pins. PLAYWRIGHT_CHROMIUM_EXECUTABLE lets those environments point at the one they
      // have instead of downloading a second copy; unset, Playwright resolves as normal.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
  },
  webServer: [
    {
      command: 'node --import tsx test/e2e/server.ts',
      port: 8080,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: '8080',
        // Dev-only secrets. Real ones come from the environment on the VPS (see docs/DEPLOY.md).
        AUTH_SECRET: 'e2e-auth-secret-not-used-in-production-0123456789',
        COOKIE_SECRET: 'e2e-cookie-secret-not-used-in-production-0123456',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
        // Off in E2E: the suite deliberately fires bursts (chest taps, tab switches) that a
        // human never would, and 429s would make it flaky without testing anything real.
        RATE_LIMIT_ENABLED: 'false',
        LOG_LEVEL: 'warn',
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
