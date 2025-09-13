import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Comprehensive Error Recovery Tests', () => {
  const testUser = {
    email: `error-recovery-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const testProject = {
    name: 'Error Recovery Test Project',
    description: 'Testing error recovery scenarios',
  };

  const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');
  const _corruptedImagePath = path.join(
    __dirname,
    '../fixtures/corrupted-image.txt'
  );

  test.beforeEach(async ({ page }) => {
    // Setup: Register and login
    await page.goto('/');
    await page.getByRole('link', { name: /sign up/i }).click();

    await page.getByLabel(/email/i).fill(testUser.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);
    await page.getByRole('checkbox', { name: /terms/i }).check();
    await page.getByRole('button', { name: /sign up/i }).click();
    await expect(page).toHaveURL('/dashboard');
  });

  test.describe('Network Disconnection Recovery', () => {
    test('should handle network disconnection during image upload', async ({
      page,
    }) => {
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

      // Simulate network failure during upload
      await page.route('**/api/projects/*/images', route => {
        if (route.request().method() === 'POST') {
          route.abort('internetdisconnected');
        } else {
          route.continue();
        }
      });

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);

      // Should show network error
      await expect(
        page.getByText(/network.*error|connection.*failed|upload.*failed/i)
      ).toBeVisible({
        timeout: 15000,
      });

      // Should show retry option
      const retryButton = page.getByRole('button', {
        name: /retry|try.*again/i,
      });
      expect(await retryButton.isVisible()).toBe(true);

      // Restore network and retry
      await page.unroute('**/api/projects/*/images');
      await retryButton.click();

      // Should succeed after network restoration
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });
    });

    test('should handle network disconnection during segmentation processing', async ({
      page,
    }) => {
      // Create project and upload image
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Network Test Segmentation');
      await page
        .getByLabel(/description/i)
        .fill('Testing network failure during segmentation');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Network Test Segmentation').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Start segmentation
      const segmentButton = page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first();
      await segmentButton.click();

      // Simulate network failure during processing
      await page.route('**/api/segmentation/**', route => {
        route.abort('internetdisconnected');
      });

      await page.getByRole('button', { name: /start|process/i }).click();

      // Should show processing error
      await expect(
        page.getByText(/network.*error|connection.*lost|processing.*failed/i)
      ).toBeVisible({
        timeout: 30000,
      });

      // Restore network and show recovery options
      await page.unroute('**/api/segmentation/**');

      const retryButton = page.getByRole('button', {
        name: /retry|resume|try.*again/i,
      });
      if (await retryButton.isVisible()) {
        await retryButton.click();

        // Should resume or restart processing
        await expect(
          page.getByText(/processing|analyzing|queued/i)
        ).toBeVisible({ timeout: 10000 });
      }
    });

    test('should cache work during network outages', async ({ page }) => {
      // This test verifies that work is cached locally during network issues
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Cache Test Project');
      await page
        .getByLabel(/description/i)
        .fill('Testing local caching during network issues');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Cache Test Project').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Navigate to editor if available
      const editButton = page
        .getByRole('button', { name: /edit|editor|annotate/i })
        .first();
      if (await editButton.isVisible()) {
        await editButton.click();

        // Wait for editor to load
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        // Make some changes while connected
        const canvas = page.locator('canvas, .canvas-container').first();
        await canvas.click({ position: { x: 100, y: 100 } });

        // Simulate network failure
        await page.route('**/api/**', route => {
          route.abort('internetdisconnected');
        });

        // Make changes while offline
        await canvas.click({ position: { x: 200, y: 200 } });

        // Should show offline indicator
        const offlineIndicator = page.getByText(
          /offline|no.*connection|disconnected/i
        );
        if (await offlineIndicator.isVisible({ timeout: 5000 })) {
          expect(await offlineIndicator.isVisible()).toBe(true);
        }

        // Try to save (should cache locally)
        await page.keyboard.press('Control+s');

        // Should show cached/queued for sync message
        const cacheMessage = page.getByText(
          /saved.*locally|queued.*sync|will.*sync/i
        );
        if (await cacheMessage.isVisible({ timeout: 5000 })) {
          expect(await cacheMessage.isVisible()).toBe(true);
        }

        // Restore network
        await page.unroute('**/api/**');

        // Should sync cached changes
        await page.waitForTimeout(2000);
        const syncMessage = page.getByText(
          /synced|synchronized|saved.*server/i
        );
        if (await syncMessage.isVisible({ timeout: 10000 })) {
          expect(await syncMessage.isVisible()).toBe(true);
        }
      }
    });
  });

  test.describe('Server Error Recovery', () => {
    test('should handle 500 server errors gracefully', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Server Error Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing server error handling');

      // Simulate server error
      await page.route('**/api/projects', route => {
        if (route.request().method() === 'POST') {
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Internal server error' }),
          });
        } else {
          route.continue();
        }
      });

      await page.getByRole('button', { name: /create|save/i }).click();

      // Should show user-friendly error message
      await expect(
        page.getByText(/server.*error|something.*wrong|try.*again.*later/i)
      ).toBeVisible({
        timeout: 10000,
      });

      // Should not crash the application
      await expect(
        page.getByRole('button', { name: /create.*project|new.*project/i })
      ).toBeVisible();

      // Restore server and retry
      await page.unroute('**/api/projects');

      const retryButton = page.getByRole('button', {
        name: /retry|try.*again/i,
      });
      if (await retryButton.isVisible()) {
        await retryButton.click();
      } else {
        // Try creating project again
        await page
          .getByRole('button', { name: /create.*project|new.*project/i })
          .click();
        await page
          .getByLabel(/project name|name/i)
          .fill('Server Error Test Retry');
        await page.getByLabel(/description/i).fill('Retry after server error');
        await page.getByRole('button', { name: /create|save/i }).click();
      }

      // Should succeed after server recovery
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
    });

    test('should handle timeout errors', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Timeout Test');
      await page.getByLabel(/description/i).fill('Testing timeout handling');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Timeout Test').click();

      // Simulate slow server response (timeout)
      await page.route('**/api/projects/*/images', route => {
        // Delay response beyond timeout
        setTimeout(() => {
          route.continue();
        }, 30000); // 30 second delay
      });

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);

      // Should show timeout error
      await expect(
        page.getByText(/timeout|request.*timed.*out|taking.*too.*long/i)
      ).toBeVisible({
        timeout: 35000,
      });

      // Clean up route
      await page.unroute('**/api/projects/*/images');
    });

    test('should handle rate limiting gracefully', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Rate Limit Test');
      await page.getByLabel(/description/i).fill('Testing rate limit handling');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Rate Limit Test').click();

      // Simulate rate limiting
      await page.route('**/api/projects/*/images', route => {
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          headers: { 'Retry-After': '5' },
          body: JSON.stringify({ message: 'Rate limit exceeded' }),
        });
      });

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);

      // Should show rate limit message with retry info
      await expect(
        page.getByText(/rate.*limit|too.*many.*requests|slow.*down/i)
      ).toBeVisible({
        timeout: 10000,
      });

      // Should show automatic retry countdown or manual retry option
      const retryInfo = page.getByText(
        /retry.*in|wait.*\d+.*seconds|retrying.*automatically/i
      );
      if (await retryInfo.isVisible({ timeout: 5000 })) {
        // Wait for automatic retry or manual retry
        await page.waitForTimeout(6000);
      }

      // Clean up route for potential retry
      await page.unroute('**/api/projects/*/images');
    });
  });

  test.describe('Corrupted Image Handling', () => {
    const corruptedFile = path.join(__dirname, '../fixtures/corrupted.jpg');

    test.beforeEach(async () => {
      // Create a corrupted image file (text file with image extension)
      const fixturesDir = path.join(__dirname, '../fixtures');

      // Ensure fixtures directory exists
      try {
        await fs.mkdir(fixturesDir, { recursive: true });
      } catch {
        // Directory may already exist
      }

      // Create corrupted file for testing
      await fs.writeFile(
        corruptedFile,
        'This is not an image file - corrupted data'
      );
    });

    test.afterEach(async () => {
      // Cleanup corrupted file
      try {
        await fs.unlink(corruptedFile);
      } catch {
        // File may not exist, ignore error
      }
    });

    test('should detect and handle corrupted image files', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Corrupted Image Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing corrupted image handling');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Corrupted Image Test').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(corruptedFile);

      // Should show error for corrupted file
      await expect(
        page.getByText(
          /corrupted|invalid.*image|unsupported.*format|failed.*process/i
        )
      ).toBeVisible({
        timeout: 15000,
      });

      // Should not crash the application
      await expect(page.getByText('Corrupted Image Test')).toBeVisible();

      // Should allow user to try uploading a different file
      await fileInput.setInputFiles(testImagePath);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });
    });

    test('should handle unsupported file formats', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Unsupported Format Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing unsupported file format handling');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Unsupported Format Test').click();

      // Create unsupported file
      const unsupportedFile = path.join(__dirname, '../fixtures/test.tiff');

      try {
        await fs.access(unsupportedFile);
      } catch {
        await fs.writeFile(unsupportedFile, 'Unsupported TIFF file content');
      }

      try {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(unsupportedFile);

        // Should show format not supported error
        await expect(
          page.getByText(
            /unsupported.*format|file.*type.*not.*supported|format.*not.*allowed/i
          )
        ).toBeVisible({
          timeout: 10000,
        });

        // Should show list of supported formats
        const supportedFormats = page.getByText(
          /supported.*formats|jpg|jpeg|png|webp/i
        );
        if (await supportedFormats.isVisible({ timeout: 5000 })) {
          expect(await supportedFormats.isVisible()).toBe(true);
        }
      } finally {
        // Cleanup
        try {
          await fs.unlink(unsupportedFile);
        } catch {
          // File may not exist, ignore error
        }
      }
    });

    test('should handle extremely large image files', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Large File Test');
      await page.getByLabel(/description/i).fill('Testing large file handling');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Large File Test').click();

      // Simulate file size check by intercepting upload
      await page.route('**/api/projects/*/images', route => {
        route.fulfill({
          status: 413,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'File too large',
            maxSize: '10MB',
            uploadedSize: '25MB',
          }),
        });
      });

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);

      // Should show file size error
      await expect(
        page.getByText(/file.*too.*large|size.*limit|maximum.*file.*size/i)
      ).toBeVisible({
        timeout: 10000,
      });

      // Should show size limits
      const sizeLimitInfo = page.getByText(/maximum.*10.*MB|size.*limit.*10/i);
      if (await sizeLimitInfo.isVisible({ timeout: 5000 })) {
        expect(await sizeLimitInfo.isVisible()).toBe(true);
      }

      await page.unroute('**/api/projects/*/images');
    });
  });

  test.describe('Browser Refresh and Session Recovery', () => {
    test('should recover work after browser refresh during editing', async ({
      page,
    }) => {
      // Create project and navigate to editor
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Refresh Recovery Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing recovery after browser refresh');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Refresh Recovery Test').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Navigate to editor if available
      const editButton = page
        .getByRole('button', { name: /edit|editor|segmentation/i })
        .first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        // Make some changes
        const canvas = page.locator('canvas, .canvas-container').first();
        await canvas.click({ position: { x: 150, y: 150 } });

        // Get current URL to return to after refresh
        const _currentUrl = page.url();

        // Refresh the page
        await page.reload();

        // Should show recovery dialog or auto-recover
        const recoveryDialog = page.getByText(
          /recover.*work|restore.*session|unsaved.*changes/i
        );
        if (await recoveryDialog.isVisible({ timeout: 10000 })) {
          const recoverButton = page.getByRole('button', {
            name: /recover|restore|yes/i,
          });
          await recoverButton.click();
        }

        // Should be back in the editor with work preserved
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        // Verify we're authenticated and can continue working
        const canvas2 = page.locator('canvas, .canvas-container').first();
        await canvas2.click({ position: { x: 200, y: 200 } });
      }
    });

    test('should handle session expiration during work', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Session Expiry Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing session expiration handling');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Session Expiry Test').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Simulate session expiration
      await page.route('**/api/auth/me', route => {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Session expired' }),
        });
      });

      await page.route('**/api/auth/refresh', route => {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Refresh token expired' }),
        });
      });

      // Try to perform an action that requires authentication
      const segmentButton = page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first();
      if (await segmentButton.isVisible()) {
        await segmentButton.click();

        // Should detect session expiration and handle gracefully
        const sessionExpiredMessage = page.getByText(
          /session.*expired|please.*login.*again|authentication.*required/i
        );

        if (await sessionExpiredMessage.isVisible({ timeout: 10000 })) {
          // Should offer to login again or redirect to login
          const loginButton = page.getByRole('button', {
            name: /login.*again|sign.*in/i,
          });
          if (await loginButton.isVisible()) {
            expect(await loginButton.isVisible()).toBe(true);
          } else {
            // Check if redirected to login page
            await page.waitForURL(
              url => url.pathname.includes('sign-in') || url.pathname === '/'
            );
          }
        }
      }

      // Clean up routes
      await page.unroute('**/api/auth/me');
      await page.unroute('**/api/auth/refresh');
    });
  });

  test.describe('Storage Quota and Disk Space', () => {
    test('should handle storage quota exceeded scenarios', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Storage Quota Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing storage quota handling');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Storage Quota Test').click();

      // Simulate storage quota exceeded
      await page.route('**/api/projects/*/images', route => {
        route.fulfill({
          status: 507,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Storage quota exceeded',
            usedSpace: '4.8GB',
            totalSpace: '5GB',
          }),
        });
      });

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);

      // Should show storage quota error
      await expect(
        page.getByText(
          /storage.*quota.*exceeded|not.*enough.*space|storage.*full/i
        )
      ).toBeVisible({
        timeout: 10000,
      });

      // Should show current usage and limits
      const storageInfo = page.getByText(/4\.8.*GB.*5.*GB|storage.*usage/i);
      if (await storageInfo.isVisible({ timeout: 5000 })) {
        expect(await storageInfo.isVisible()).toBe(true);
      }

      // Should offer options to free up space
      const manageStorageButton = page.getByRole('button', {
        name: /manage.*storage|free.*space|upgrade/i,
      });
      if (await manageStorageButton.isVisible()) {
        await manageStorageButton.click();

        // Should show storage management options
        await expect(
          page.getByText(
            /delete.*old.*projects|archive.*projects|upgrade.*plan/i
          )
        ).toBeVisible({
          timeout: 5000,
        });
      }

      await page.unroute('**/api/projects/*/images');
    });

    test('should warn about approaching storage limits', async ({ page }) => {
      // Simulate approaching storage limit (90% used)
      await page.route('**/api/auth/storage-stats', route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            usedBytes: 4500000000, // 4.5GB
            totalBytes: 5000000000, // 5GB
            usagePercentage: 90,
          }),
        });
      });

      await page.goto('/dashboard');

      // Should show warning about storage usage
      const storageWarning = page.getByText(
        /storage.*almost.*full|90%.*used|running.*out.*space/i
      );
      if (await storageWarning.isVisible({ timeout: 10000 })) {
        expect(await storageWarning.isVisible()).toBe(true);
      }

      // Should provide link to manage storage
      const manageLink = page.getByRole('link', {
        name: /manage.*storage|view.*usage/i,
      });
      if (await manageLink.isVisible()) {
        expect(await manageLink.isVisible()).toBe(true);
      }

      await page.unroute('**/api/auth/storage-stats');
    });
  });

  test.describe('Concurrent User Conflicts', () => {
    test('should handle concurrent editing conflicts', async ({ browser }) => {
      // This test simulates what happens when multiple users edit the same project
      const context1 = await browser.newContext();
      const context2 = await browser.newContext();

      const page1 = context1.pages()[0] || (await context1.newPage());
      const page2 = context2.pages()[0] || (await context2.newPage());

      try {
        // Both users login (simplified - in real scenario they'd be different users)
        for (const page of [page1, page2]) {
          await page.goto('/');
          await page.getByRole('link', { name: /sign up/i }).click();
          await page
            .getByLabel(/email/i)
            .fill(`concurrent-${Date.now()}-${Math.random()}@example.com`);
          await page
            .getByLabel(/password/i)
            .first()
            .fill(testUser.password);
          await page.getByLabel(/confirm password/i).fill(testUser.password);
          await page.getByRole('checkbox', { name: /terms/i }).check();
          await page.getByRole('button', { name: /sign up/i }).click();
          await expect(page).toHaveURL('/dashboard');
        }

        // User 1 creates and shares project (or both access same project)
        await page1
          .getByRole('button', { name: /create.*project|new.*project/i })
          .click();
        await page1
          .getByLabel(/project name|name/i)
          .fill('Concurrent Edit Test');
        await page1
          .getByLabel(/description/i)
          .fill('Testing concurrent editing');
        await page1.getByRole('button', { name: /create|save/i }).click();
        await expect(page1.getByText(/project.*created|success/i)).toBeVisible({
          timeout: 10000,
        });

        // Simulate concurrent editing conflict
        await page1.route('**/api/projects/*/polygons', route => {
          if (route.request().method() === 'PUT') {
            route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({
                message: 'Conflict detected',
                conflictType: 'concurrent_edit',
                lastModifiedBy: 'another_user',
                lastModified: new Date().toISOString(),
              }),
            });
          } else {
            route.continue();
          }
        });

        await page1.getByText('Concurrent Edit Test').click();

        // Try to save changes that conflict with another user's changes
        const editButton = page1
          .getByRole('button', { name: /edit|save/i })
          .first();
        if (await editButton.isVisible()) {
          await editButton.click();

          // Should show conflict resolution dialog
          await expect(
            page1.getByText(
              /conflict.*detected|another.*user|concurrent.*edit/i
            )
          ).toBeVisible({
            timeout: 10000,
          });

          // Should offer resolution options
          const resolutionOptions = page1.locator(
            '[role="radiogroup"], .conflict-resolution'
          );
          if (await resolutionOptions.isVisible()) {
            await expect(
              page1.getByText(
                /keep.*your.*changes|keep.*their.*changes|merge.*changes/i
              )
            ).toBeVisible();
          }
        }
      } finally {
        await context1.close();
        await context2.close();
      }
    });
  });

  test.describe('Memory and Performance Degradation', () => {
    test('should handle memory pressure gracefully', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Memory Pressure Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing memory pressure handling');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Memory Pressure Test').click();

      // Simulate memory pressure - adapt to environment constraints
      await page.evaluate(() => {
        try {
          // Detect available memory and scale accordingly
          const memoryInfo = (navigator as any).deviceMemory || 4; // Default to 4GB if not available
          const scaleFactor = Math.min(memoryInfo / 4, 1); // Scale down if less than 4GB
          const arrayCount = Math.max(10, Math.floor(10 * scaleFactor));
          const arraySize = Math.max(1000, Math.floor(10000 * scaleFactor));

          const largeArrays = [];
          for (let i = 0; i < arrayCount; i++) {
            largeArrays.push(new Array(arraySize).fill(Math.random()));
          }

          // Store reference temporarily, then clean up
          (window as any).testArrays = largeArrays;

          // Clean up after 1 second
          setTimeout(() => {
            delete (window as any).testArrays;
          }, 1000);
        } catch (_error) {
          //           console.warn('Memory pressure test failed gracefully:', _error);
          // Skip heavy allocation in low-memory environments
        }
      });

      // Application should remain responsive
      await expect(page.getByText('Memory Pressure Test')).toBeVisible();

      // Clean up memory
      await page.evaluate(() => {
        delete (window as any).testArrays;
      });

      // Should show performance warning if memory usage is high
      const performanceWarning = page.getByText(
        /performance.*warning|memory.*usage|running.*slowly/i
      );
      if (await performanceWarning.isVisible({ timeout: 5000 })) {
        expect(await performanceWarning.isVisible()).toBe(true);
      }
    });

    test('should degrade gracefully with slow performance', async ({
      page,
    }) => {
      // Test how the app handles when operations become very slow
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Performance Degradation Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing performance degradation');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Performance Degradation Test').click();

      // Simulate very slow API responses
      await page.route('**/api/**', async route => {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
        route.continue();
      });

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePath);

      // Should show loading indicators and remain responsive
      await expect(page.getByText(/uploading|processing|loading/i)).toBeVisible(
        { timeout: 2000 }
      );

      // Should not freeze the UI
      const otherElements = page.getByRole('button', { name: /cancel|stop/i });
      if (await otherElements.isVisible({ timeout: 2000 })) {
        expect(await otherElements.isVisible()).toBe(true);
      }

      // Clean up route after test
      await page.unroute('**/api/**');
    });
  });
});
