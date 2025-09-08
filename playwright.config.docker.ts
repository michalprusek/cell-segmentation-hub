import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Docker environment testing
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Global setup to verify services before testing */
  globalSetup: './tests/global.setup.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions - using blue-frontend container */
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4000',

    /* API URL for backend tests */
    extraHTTPHeaders: {
      Accept: 'application/json',
    },

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Record video on failure */
    video: 'retain-on-failure',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Global timeout for each action */
    actionTimeout: 30000,

    /* Global timeout for navigation */
    navigationTimeout: 30000,
  },

  /* Configure projects for major browsers */
  projects: process.env.CI
    ? [
        // In CI, run only essential browsers for speed and reliability
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        // In development, test on multiple browsers
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'firefox',
          use: { ...devices['Desktop Firefox'] },
        },
        {
          name: 'webkit',
          use: { ...devices['Desktop Safari'] },
        },
      ],

  /* Configure timeout for all tests */
  timeout: process.env.CI ? 90000 : 60000,

  /* Configure global timeout for the entire test run */
  globalTimeout: process.env.CI ? 30 * 60 * 1000 : 20 * 60 * 1000, // 30 min in CI, 20 min locally

  /* Run your local dev server before starting the tests - NOT needed for Docker */
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
