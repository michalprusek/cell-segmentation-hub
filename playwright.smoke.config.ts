import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the *smoke gate*: fast bundle-mount checks
 * against the built frontend, with no backend dependency.
 *
 * Distinct from `playwright.config.ts` (full E2E with Docker stack)
 * because:
 *   - smoke must finish in ~60s on CI to be useful as an early gate.
 *   - smoke uses `vite preview` so it tests the production bundle
 *     (the bundle that ships) rather than the dev server.
 *   - smoke has no global setup, no auth fixtures, no database.
 */
export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Build then preview the production bundle. CI build can take ~30s,
  // first-run cold start; subsequent reuse via reuseExistingServer.
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  timeout: 30_000,
  expect: { timeout: 5_000 },

  outputDir: 'test-results-smoke/',
});
