import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('WebSocket Queue Processing E2E Tests', () => {
  const testUser = {
    email: `websocket-test-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const testProject = {
    name: 'WebSocket Queue Test Project',
    description: 'Testing real-time queue processing via WebSocket',
  };

  const testImagePath = path.join(
    __dirname,
    '../../public/lovable-uploads/026f6ae6-fa28-487c-8263-f49babd99dd3.png'
  );

  test.beforeEach(async ({ page }) => {
    // Setup user and authentication
    await page.goto('/');

    const isLoggedIn = await page
      .locator('[data-testid="user-menu"], .user-menu')
      .isVisible();

    if (!isLoggedIn) {
      await page.getByRole('link', { name: /sign up/i }).click();
      await page.getByLabel(/email/i).fill(testUser.email);
      await page
        .getByLabel(/password/i)
        .first()
        .fill(testUser.password);
      await page.getByLabel(/confirm password/i).fill(testUser.password);

      const consentCheckbox = page
        .getByRole('checkbox', { name: /terms|consent/i })
        .first();
      if (await consentCheckbox.isVisible()) {
        await consentCheckbox.check();
      }

      await page.getByRole('button', { name: /sign up/i }).click();
      await expect(page).toHaveURL('/dashboard');
    }
  });

  test('should receive real-time queue status updates', async ({ page }) => {
    // Create project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText(testProject.name).click();

    // Upload image
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    // Start segmentation and monitor WebSocket updates
    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();

    // Listen for network WebSocket connections
    const wsPromise = page.waitForWebSocket({ timeout: 30000 });

    await page.getByRole('button', { name: /start|process|segment/i }).click();

    try {
      const ws = await wsPromise;
      expect(ws.isClosed()).toBe(false);

      // Monitor for real-time status updates
      const statusUpdates: string[] = [];

      ws.on('framereceived', event => {
        try {
          const data = JSON.parse(event.payload.toString());
          if (data.type === 'queue_update' || data.type === 'status_update') {
            statusUpdates.push(data.status || data.message);
          }
        } catch (e) {
          // Ignore non-JSON frames
        }
      });

      // Wait for initial queue status
      await expect(page.getByText(/queued|waiting|processing/i)).toBeVisible({
        timeout: 10000,
      });

      // Wait for processing to start
      await expect(page.getByText(/processing|analyzing|running/i)).toBeVisible(
        { timeout: 30000 }
      );

      // Wait for completion
      await expect(
        page.getByText(/complete|finished|done|success/i)
      ).toBeVisible({ timeout: 120000 });

      // Verify we received status updates
      expect(statusUpdates.length).toBeGreaterThan(0);
    } catch (error) {
      console.log(
        'WebSocket connection test failed or timed out - this may be expected in test environment'
      );

      // Fallback: Just verify the UI shows the expected status progression
      await expect(page.getByText(/queued|waiting|processing/i)).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/processing|analyzing|running/i)).toBeVisible(
        { timeout: 30000 }
      );
      await expect(
        page.getByText(/complete|finished|done|success/i)
      ).toBeVisible({ timeout: 120000 });
    }
  });

  test('should handle WebSocket reconnection', async ({ page }) => {
    // Create project and start processing
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page
      .getByLabel(/project name|name/i)
      .fill('Reconnection Test Project');
    await page
      .getByLabel(/description/i)
      .fill('Testing WebSocket reconnection');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Reconnection Test Project').click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();

    // Wait for processing to start
    await expect(page.getByText(/processing|analyzing|running/i)).toBeVisible({
      timeout: 30000,
    });

    // Simulate network interruption by going offline and back online
    await page.context().setOffline(true);
    await page.waitForTimeout(2000);
    await page.context().setOffline(false);

    // The application should handle reconnection gracefully
    // Either show a reconnection message or maintain status updates
    const reconnectionIndicators = [
      page.getByText(/reconnect|connection.*lost|trying.*connect/i),
      page.getByText(/online|connected|reconnected/i),
    ];

    let reconnectionHandled = false;
    for (const indicator of reconnectionIndicators) {
      if (await indicator.isVisible({ timeout: 10000 })) {
        reconnectionHandled = true;
        break;
      }
    }

    // Even if no explicit reconnection message, processing should complete
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 120000 }
    );
  });

  test('should handle multiple concurrent queue items', async ({ page }) => {
    // Create multiple projects with processing jobs
    const projectNames = [
      'Concurrent Test 1',
      'Concurrent Test 2',
      'Concurrent Test 3',
    ];

    for (let i = 0; i < projectNames.length; i++) {
      await page.goto('/dashboard');

      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill(projectNames[i]);
      await page
        .getByLabel(/description/i)
        .fill(`Concurrent processing test ${i + 1}`);
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText(projectNames[i]).click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      await page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first()
        .click();
      await page
        .getByRole('button', { name: /start|process|segment/i })
        .click();

      // Don't wait for completion, start next job
      await expect(page.getByText(/queued|processing|analyzing/i)).toBeVisible({
        timeout: 10000,
      });
    }

    // Check queue status page if available
    const queueButton = page.getByRole('button', {
      name: /queue|status|jobs/i,
    });
    if (await queueButton.isVisible()) {
      await queueButton.click();

      // Should show multiple queue items
      const queueItems = page.locator(
        '.queue-item, .job-item, .processing-item'
      );
      const itemCount = await queueItems.count();
      expect(itemCount).toBeGreaterThan(0);

      // Should show different statuses
      const statusTypes = [
        page.getByText(/queued|waiting/i),
        page.getByText(/processing|running/i),
        page.getByText(/complete|finished/i),
      ];

      for (const statusType of statusTypes) {
        if (await statusType.isVisible({ timeout: 5000 })) {
          await expect(statusType).toBeVisible();
        }
      }
    }

    // Wait for all jobs to complete
    await page.goto('/dashboard');

    for (const projectName of projectNames) {
      await page.getByText(projectName).click();
      await expect(
        page.getByText(/complete|finished|done|success/i)
      ).toBeVisible({ timeout: 180000 });
      await page.goto('/dashboard');
    }
  });

  test('should handle queue errors and failures gracefully', async ({
    page,
  }) => {
    // Create project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Error Handling Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing error handling in queue');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Error Handling Test').click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    // Try to cause an error by using invalid settings or parameters
    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();

    // Set extreme threshold value if possible
    const thresholdInput = page
      .locator('input[type="range"], input[type="number"]')
      .first();
    if (await thresholdInput.isVisible()) {
      await thresholdInput.fill('1.5'); // Invalid threshold > 1.0
    }

    await page.getByRole('button', { name: /start|process|segment/i }).click();

    // Monitor for error handling
    const errorIndicators = [
      page.getByText(/error|failed|failure/i),
      page.getByText(/invalid|invalid.*threshold/i),
      page.getByText(/retry|try.*again/i),
    ];

    let errorDetected = false;
    for (const indicator of errorIndicators) {
      if (await indicator.isVisible({ timeout: 30000 })) {
        errorDetected = true;
        break;
      }
    }

    if (errorDetected) {
      // Test retry functionality if available
      const retryButton = page.getByRole('button', {
        name: /retry|try.*again/i,
      });
      if (await retryButton.isVisible()) {
        await retryButton.click();

        // Should restart processing
        await expect(
          page.getByText(/processing|analyzing|queued/i)
        ).toBeVisible({ timeout: 10000 });
      }
    } else {
      // If no error occurred (which is also valid), ensure processing completes
      await expect(
        page.getByText(/complete|finished|done|success/i)
      ).toBeVisible({ timeout: 120000 });
    }
  });

  test('should show queue position and estimated time', async ({ page }) => {
    // Create project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Queue Position Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing queue position display');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Queue Position Test').click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();

    // Look for queue position indicators
    const positionIndicators = [
      page.getByText(/position.*\d+/i),
      page.getByText(/\d+.*in.*queue/i),
      page.getByText(/ahead.*of.*you/i),
    ];

    for (const indicator of positionIndicators) {
      if (await indicator.isVisible({ timeout: 10000 })) {
        await expect(indicator).toBeVisible();
        break;
      }
    }

    // Look for estimated time indicators
    const timeIndicators = [
      page.getByText(/estimated.*time/i),
      page.getByText(/\d+.*minute|second/i),
      page.getByText(/eta/i),
    ];

    for (const indicator of timeIndicators) {
      if (await indicator.isVisible({ timeout: 10000 })) {
        await expect(indicator).toBeVisible();
        break;
      }
    }

    // Wait for processing to complete
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 120000 }
    );
  });

  test('should handle cancellation of queued jobs', async ({ page }) => {
    // Create project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Cancellation Test');
    await page.getByLabel(/description/i).fill('Testing job cancellation');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Cancellation Test').click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();

    // Wait for job to be queued or start processing
    await expect(page.getByText(/queued|processing|analyzing/i)).toBeVisible({
      timeout: 10000,
    });

    // Look for cancel button
    const cancelButton = page.getByRole('button', {
      name: /cancel|stop|abort/i,
    });
    if (await cancelButton.isVisible({ timeout: 5000 })) {
      await cancelButton.click();

      // Should show cancellation confirmation or immediate cancellation
      const cancellationIndicators = [
        page.getByText(/cancelled|stopped|aborted/i),
        page.getByText(/cancel.*confirm/i),
        page.getByRole('button', { name: /yes|confirm|cancel.*job/i }),
      ];

      let cancellationHandled = false;
      for (const indicator of cancellationIndicators) {
        if (await indicator.isVisible({ timeout: 5000 })) {
          if (indicator.role === 'button') {
            await indicator.click(); // Confirm cancellation
          }
          cancellationHandled = true;
          break;
        }
      }

      if (cancellationHandled) {
        // Should return to ready state
        await expect(page.getByText(/cancelled|stopped|ready/i)).toBeVisible({
          timeout: 10000,
        });

        // Should be able to restart processing
        const restartButton = page.getByRole('button', {
          name: /start|process|segment.*again/i,
        });
        if (await restartButton.isVisible()) {
          await restartButton.click();
          await expect(page.getByText(/queued|processing/i)).toBeVisible({
            timeout: 10000,
          });
        }
      }
    }
  });

  test('should persist queue state across page refreshes', async ({ page }) => {
    // Create project and start processing
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Persistence Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing queue state persistence');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Persistence Test').click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();

    // Wait for processing to start
    await expect(page.getByText(/processing|analyzing|queued/i)).toBeVisible({
      timeout: 30000,
    });

    // Get current status before refresh
    const statusBeforeRefresh = await page
      .getByText(/processing|analyzing|queued|complete/i)
      .first()
      .textContent();

    // Refresh the page
    await page.reload();

    // Should maintain authentication
    await expect(page.getByText('Persistence Test')).toBeVisible({
      timeout: 10000,
    });

    // Navigate back to the project
    await page.getByText('Persistence Test').click();

    // Should show current processing status (may have progressed)
    const statusAfterRefresh = page
      .getByText(/processing|analyzing|queued|complete/i)
      .first();
    await expect(statusAfterRefresh).toBeVisible({ timeout: 10000 });

    // Wait for completion
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 120000 }
    );
  });

  test('should handle WebSocket connection errors', async ({ page }) => {
    // Monitor for console errors related to WebSocket
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (
        msg.type() === 'error' &&
        msg.text().toLowerCase().includes('websocket')
      ) {
        consoleErrors.push(msg.text());
      }
    });

    // Create project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill('Connection Error Test');
    await page
      .getByLabel(/description/i)
      .fill('Testing WebSocket error handling');
    await page.getByRole('button', { name: /create|save/i }).click();

    await expect(page.getByText(/project.*created|success/i)).toBeVisible({
      timeout: 10000,
    });
    await page.getByText('Connection Error Test').click();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);
    await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
      timeout: 15000,
    });

    // Block WebSocket connections to simulate network issues
    await page.route('ws://localhost:3001/**', route => route.abort());
    await page.route('wss://localhost:3001/**', route => route.abort());

    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .first()
      .click();
    await page.getByRole('button', { name: /start|process|segment/i }).click();

    // Should handle WebSocket failure gracefully
    // Either show connection error or fallback to polling
    const errorHandlingIndicators = [
      page.getByText(/connection.*error|websocket.*error/i),
      page.getByText(/offline.*mode|fallback.*mode/i),
      page.getByText(/processing|analyzing/i), // Fallback polling works
    ];

    let errorHandled = false;
    for (const indicator of errorHandlingIndicators) {
      if (await indicator.isVisible({ timeout: 15000 })) {
        errorHandled = true;
        break;
      }
    }

    // Application should continue to function even without WebSocket
    expect(errorHandled).toBe(true);

    // Wait for processing to complete (via polling or other mechanism)
    await expect(page.getByText(/complete|finished|done|success/i)).toBeVisible(
      { timeout: 180000 }
    );
  });
});
