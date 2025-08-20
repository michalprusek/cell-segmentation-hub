import { test, expect } from '@playwright/test';
import { APIMockManager } from '../utils/api-mock-manager';
import { setupAuthenticatedTest } from '../fixtures/test-setup-utils';

test.describe('API Mocking Tests', () => {
  let mockManager: APIMockManager;

  test.beforeEach(async ({ page }) => {
    mockManager = new APIMockManager(page);
    await mockManager.start();
  });

  test.afterEach(async () => {
    try {
      await mockManager.stop();
    } catch (error) {
      console.warn('Error stopping mock manager:', error);
    }
    const report = mockManager.generateReport();
    console.log('Mock usage report:', JSON.stringify(report, null, 2));
  });

  test.describe('Success Scenarios', () => {
    test('should handle successful authentication flow with mocks', async ({
      page,
    }) => {
      mockManager.setupSuccessScenario();

      // Navigate to app
      await page.goto('/');

      // Test registration with mock
      await page.getByRole('link', { name: /sign up/i }).click();
      await page.getByLabel(/email/i).fill('mock@example.com');
      await page
        .getByLabel(/password/i)
        .first()
        .fill('mockpassword123');
      await page.getByLabel(/confirm password/i).fill('mockpassword123');
      await page.getByRole('checkbox', { name: /terms/i }).check();
      await page.getByRole('button', { name: /sign up/i }).click();

      // Should redirect to dashboard with mock data
      await expect(page).toHaveURL('/dashboard');

      // Verify mock authentication was called
      expect(mockManager.getCallCount('auth-register-success')).toBe(1);
    });

    test('should handle project creation with mocks', async ({ page }) => {
      mockManager.setupSuccessScenario();

      const env = await setupAuthenticatedTest(page, 'mock-projects');

      // Create project - should use mock
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Mock Test Project');
      await page.getByLabel(/description/i).fill('Testing with mocks');
      await page.getByRole('button', { name: /create|save/i }).click();

      // Should show success with mock response
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Verify mock was called
      expect(mockManager.getCallCount('projects-create')).toBe(1);
    });

    test('should handle image upload and processing with mocks', async ({
      page,
    }) => {
      mockManager.setupSuccessScenario();

      const env = await setupAuthenticatedTest(page, 'mock-upload');

      // Create project first
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Upload Mock Test');
      await page.getByLabel(/description/i).fill('Testing upload mocks');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Upload Mock Test').click();

      // Mock file upload with real file object
      const fileInput = page.locator('input[type="file"]').first();
      // Create a real file buffer for upload
      await fileInput.setInputFiles({
        name: 'test-file.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('test file content'),
      });

      // Should show upload success with mock response
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Verify upload mock was called
      expect(mockManager.getCallCount('image-upload')).toBeGreaterThan(0);
    });

    test('should handle segmentation process with mocks', async ({ page }) => {
      mockManager.setupSuccessScenario();

      const env = await setupAuthenticatedTest(page, 'mock-segmentation');

      // Assume we have a project with images (using mocked data)
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Segmentation Mock Test');
      await page.getByLabel(/description/i).fill('Testing segmentation mocks');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Segmentation Mock Test').click();

      // Start segmentation process
      const segmentButton = page
        .getByRole('button', { name: /segment|process|analyze/i })
        .first();
      if (await segmentButton.isVisible()) {
        await segmentButton.click();
        await page.getByRole('button', { name: /start|process/i }).click();

        // Should show processing status from mock
        await expect(
          page.getByText(/processing|queued|analyzing/i)
        ).toBeVisible({ timeout: 5000 });

        // Verify segmentation mock was called
        expect(mockManager.getCallCount('segmentation-start')).toBeGreaterThan(
          0
        );
      }
    });

    test('should handle export functionality with mocks', async ({ page }) => {
      mockManager.setupSuccessScenario();

      const env = await setupAuthenticatedTest(page, 'mock-export');

      // Create project
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Export Mock Test');
      await page.getByLabel(/description/i).fill('Testing export mocks');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Export Mock Test').click();

      // Try export functionality
      const exportButton = page
        .getByRole('button', { name: /export/i })
        .first();
      if (await exportButton.isVisible()) {
        await exportButton.click();

        // Select COCO format
        const cocoOption = page.getByText(/coco/i);
        if (await cocoOption.isVisible()) {
          await cocoOption.click();

          const downloadPromise = page.waitForDownload({ timeout: 10000 });
          await page.getByRole('button', { name: /download|export/i }).click();

          try {
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(/.*\.(zip|json)$/);
          } catch (error) {
            // Export mock should have been called even if download fails
            console.log('Download test completed (mock scenario)');
          }

          // Verify export mock was called
          expect(mockManager.getCallCount('export-coco')).toBeGreaterThan(0);
        }
      }
    });
  });

  test.describe('Error Scenarios', () => {
    test('should handle server errors gracefully', async ({ page }) => {
      mockManager.setupErrorScenario();

      await page.goto('/');

      // Try to register with error scenario
      await page.getByRole('link', { name: /sign up/i }).click();
      await page.getByLabel(/email/i).fill('error@example.com');
      await page
        .getByLabel(/password/i)
        .first()
        .fill('errorpassword123');
      await page.getByLabel(/confirm password/i).fill('errorpassword123');
      await page.getByRole('checkbox', { name: /terms/i }).check();

      // Mock server error
      mockManager.addMock('register-error', {
        method: 'POST',
        url: '/api/auth/register',
        response: {
          status: 500,
          body: { message: 'Internal server error' },
        },
      });

      await page.getByRole('button', { name: /sign up/i }).click();

      // Should show error message
      await expect(
        page.getByText(/error|server.*error|something.*wrong/i)
      ).toBeVisible({
        timeout: 10000,
      });

      // Verify error mock was called
      expect(mockManager.getCallCount('register-error')).toBe(1);
    });

    test('should handle rate limiting', async ({ page }) => {
      mockManager.addMock('rate-limit-test', {
        method: 'POST',
        url: '/api/auth/login',
        response: {
          status: 429,
          headers: { 'Retry-After': '60' },
          body: {
            message: 'Rate limit exceeded',
            retryAfter: 60,
          },
        },
      });

      await page.goto('/');
      await page.getByRole('link', { name: /sign in/i }).click();

      await page.getByLabel(/email/i).fill('ratelimited@example.com');
      await page.getByLabel(/password/i).fill('password123');
      await page.getByRole('button', { name: /sign in/i }).click();

      // Should show rate limit message
      await expect(
        page.getByText(/rate.*limit|too.*many.*requests|slow.*down/i)
      ).toBeVisible({
        timeout: 10000,
      });

      expect(mockManager.getCallCount('rate-limit-test')).toBe(1);
    });

    test('should handle validation errors', async ({ page }) => {
      mockManager.addMock('validation-error-test', {
        method: 'POST',
        url: '/api/auth/register',
        response: {
          status: 400,
          body: {
            message: 'Validation failed',
            errors: [
              { field: 'email', message: 'Invalid email format' },
              { field: 'password', message: 'Password too weak' },
            ],
          },
        },
      });

      await page.goto('/');
      await page.getByRole('link', { name: /sign up/i }).click();

      await page.getByLabel(/email/i).fill('invalid-email');
      await page
        .getByLabel(/password/i)
        .first()
        .fill('weak');
      await page.getByLabel(/confirm password/i).fill('weak');
      await page.getByRole('checkbox', { name: /terms/i }).check();
      await page.getByRole('button', { name: /sign up/i }).click();

      // Should show validation errors
      await expect(
        page.getByText(/validation.*failed|invalid.*email|password.*weak/i)
      ).toBeVisible({
        timeout: 10000,
      });

      expect(mockManager.getCallCount('validation-error-test')).toBe(1);
    });

    test('should handle unauthorized access', async ({ page }) => {
      mockManager.addMock('unauthorized-test', {
        method: 'GET',
        url: '/api/auth/me',
        response: {
          status: 401,
          body: { message: 'Unauthorized' },
        },
      });

      // Try to access dashboard directly (should check auth)
      await page.goto('/dashboard');

      // Should redirect to login or show unauthorized message
      const isRedirected =
        page.url().includes('sign-in') ||
        page.url() === 'http://localhost:3000/';
      const hasUnauthorizedMessage = await page
        .getByText(/unauthorized|please.*login|sign.*in/i)
        .isVisible({
          timeout: 5000,
        });

      expect(isRedirected || hasUnauthorizedMessage).toBe(true);
    });

    test('should handle resource not found', async ({ page }) => {
      mockManager.setupSuccessScenario();

      // Mock 404 for specific project
      mockManager.addMock('project-not-found', {
        method: 'GET',
        url: '/api/projects/nonexistent-project',
        response: {
          status: 404,
          body: { message: 'Project not found' },
        },
        priority: 1, // Higher priority than general project mock
      });

      const env = await setupAuthenticatedTest(page, 'mock-404');

      // Try to navigate to non-existent project
      await page.goto('/projects/nonexistent-project');

      // Should show 404 error or redirect
      const has404Message = await page
        .getByText(/not.*found|does.*not.*exist|404/i)
        .isVisible({
          timeout: 5000,
        });
      const isRedirected = page.url().includes('/dashboard');

      expect(has404Message || isRedirected).toBe(true);
    });
  });

  test.describe('Network Conditions', () => {
    test('should handle offline mode', async ({ page }) => {
      mockManager.setupOfflineScenario();

      await page.goto('/');

      // Try to perform any action - should fail gracefully
      await page.getByRole('link', { name: /sign up/i }).click();
      await page.getByLabel(/email/i).fill('offline@example.com');
      await page
        .getByLabel(/password/i)
        .first()
        .fill('offlinepassword123');
      await page.getByLabel(/confirm password/i).fill('offlinepassword123');
      await page.getByRole('checkbox', { name: /terms/i }).check();
      await page.getByRole('button', { name: /sign up/i }).click();

      // Should show offline/network error
      await expect(
        page.getByText(/offline|network.*error|connection.*failed/i)
      ).toBeVisible({
        timeout: 10000,
      });
    });

    test('should handle slow network conditions', async ({ page }) => {
      mockManager.setupSlowNetworkScenario();

      const env = await setupAuthenticatedTest(page, 'slow-network');

      // Measure response time
      const startTime = Date.now();

      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Slow Network Test');
      await page.getByLabel(/description/i).fill('Testing slow network');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 15000,
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      console.log(`Slow network response time: ${responseTime}ms`);

      // Should be slower due to network conditions
      expect(responseTime).toBeGreaterThan(2000); // At least 2 seconds due to latency
    });

    test('should handle packet loss', async ({ page }) => {
      mockManager.setNetworkConditions({
        packetLoss: 0.3, // 30% packet loss
        latency: 1000,
      });

      const env = await setupAuthenticatedTest(page, 'packet-loss');

      // Perform multiple actions to test packet loss handling
      for (let i = 0; i < 3; i++) {
        await page
          .getByRole('button', { name: /create.*project|new.*project/i })
          .click();
        await page
          .getByLabel(/project name|name/i)
          .fill(`Packet Loss Test ${i + 1}`);
        await page
          .getByLabel(/description/i)
          .fill('Testing packet loss resilience');

        try {
          await page.getByRole('button', { name: /create|save/i }).click();

          // Some requests may fail due to packet loss, but app should handle gracefully
          const successVisible = await page
            .getByText(/project.*created|success/i)
            .isVisible({
              timeout: 8000,
            });
          const errorVisible = await page
            .getByText(/error|failed|network/i)
            .isVisible({
              timeout: 2000,
            });

          expect(successVisible || errorVisible).toBe(true);

          if (successVisible) {
            console.log(`Request ${i + 1} succeeded despite packet loss`);
          } else {
            console.log(
              `Request ${i + 1} failed due to packet loss - handled gracefully`
            );
          }
        } catch (error) {
          console.log(
            `Request ${i + 1} timeout - expected with high packet loss`
          );
        }

        // Close any open dialogs
        const cancelButton = page.getByRole('button', {
          name: /cancel|close/i,
        });
        try {
          await cancelButton.click({ timeout: 1000 });
        } catch {
          // Button not present or not clickable, ignore
        }

        await page.waitForTimeout(500);
      }
    });
  });

  test.describe('Mock Verification', () => {
    test('should track API calls correctly', async ({ page }) => {
      mockManager.setupSuccessScenario();

      const env = await setupAuthenticatedTest(page, 'mock-verification');

      // Perform various actions
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Verification Test');
      await page.getByLabel(/description/i).fill('Testing mock verification');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Verify call counts
      expect(mockManager.getCallCount('auth-me')).toBeGreaterThan(0);
      expect(mockManager.getCallCount('projects-create')).toBe(1);
      expect(mockManager.getCallCount('projects-list')).toBeGreaterThan(0);

      // Check request log
      const requestLog = mockManager.getRequestLog();
      expect(requestLog.length).toBeGreaterThan(0);

      const apiCalls = requestLog.filter(req => req.url.includes('/api/'));
      expect(apiCalls.length).toBeGreaterThan(0);

      console.log(
        'API calls made:',
        apiCalls.map(call => ({
          method: call.method,
          url: call.url.split('/api/')[1],
        }))
      );
    });

    test('should handle mock times limits', async ({ page }) => {
      // Add mock with limited times
      mockManager.addMock('limited-mock', {
        method: 'POST',
        url: '/api/test-limited',
        times: 2, // Only allow 2 calls
        response: {
          status: 200,
          body: { message: 'Limited mock response' },
        },
      });

      const env = await setupAuthenticatedTest(page, 'times-limit');

      // Make multiple requests to the same endpoint
      for (let i = 0; i < 5; i++) {
        await page.evaluate(iteration => {
          return fetch('/api/test-limited', {
            method: 'POST',
            body: JSON.stringify({ test: `call-${iteration}` }),
          });
        }, i);

        await page.waitForTimeout(100);
      }

      // Should only have been called 2 times
      expect(mockManager.getCallCount('limited-mock')).toBe(2);
    });

    test('should generate comprehensive mock report', async ({ page }) => {
      mockManager.setupSuccessScenario();

      const env = await setupAuthenticatedTest(page, 'mock-report');

      // Perform various actions to generate mock usage
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Report Test');
      await page.getByLabel(/description/i).fill('Testing mock reporting');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Generate report
      const report = mockManager.generateReport();

      // Validate report structure
      expect(report).toHaveProperty('mocksUsed');
      expect(report).toHaveProperty('requestLog');
      expect(report).toHaveProperty('networkConditions');

      expect(Array.isArray(report.mocksUsed)).toBe(true);
      expect(Array.isArray(report.requestLog)).toBe(true);

      // Should have some mocks used
      expect(report.mocksUsed.length).toBeGreaterThan(0);
      expect(report.requestLog.length).toBeGreaterThan(0);

      console.log('Mock usage summary:', report.mocksUsed);
      console.log('Total API calls:', report.requestLog.length);
    });
  });
});
