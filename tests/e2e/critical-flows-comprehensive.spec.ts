import { test, expect, Page } from '@playwright/test';
import { login, createProject, uploadImage } from './page-objects/helpers';

// Test data
const TEST_USER = {
  email: 'test-critical@example.com',
  password: 'TestPassword123!',
  name: 'Critical Test User',
};

const TEST_PROJECT = {
  name: 'Critical Flow Test Project',
  description: 'Testing critical application flows',
};

test.describe('Critical User Flows - Comprehensive', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');

    // Set up viewport for consistent testing
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.afterEach(async () => {
    await page.close();
  });

  test.describe('Complete User Journey', () => {
    test('should complete full user journey from registration to segmentation export', async () => {
      // Step 1: Register new user
      await page.click('text=Get Started');
      await page.waitForURL('**/register');

      await page.fill('input[name="name"]', TEST_USER.name);
      await page.fill('input[name="email"]', TEST_USER.email);
      await page.fill('input[name="password"]', TEST_USER.password);
      await page.fill('input[name="confirmPassword"]', TEST_USER.password);

      await page.click('button[type="submit"]');

      // Verify registration success
      await page.waitForURL('**/dashboard');
      await expect(page.locator('text=Welcome')).toBeVisible();

      // Step 2: Create a new project
      await page.click('text=Create Project');
      await page.waitForSelector('[data-testid="create-project-dialog"]');

      await page.fill('input[name="name"]', TEST_PROJECT.name);
      await page.fill('textarea[name="description"]', TEST_PROJECT.description);
      await page.click('button:has-text("Create")');

      // Verify project creation
      await page.waitForSelector(`text=${TEST_PROJECT.name}`);

      // Step 3: Navigate to project detail
      await page.click(`text=${TEST_PROJECT.name}`);
      await page.waitForURL('**/projects/*');

      // Step 4: Upload an image
      const fileInput = await page.locator('input[type="file"]');
      await fileInput.setInputFiles('tests/fixtures/sample-cell-image.jpg');

      // Wait for upload completion
      await page.waitForSelector('[data-testid="image-card"]');

      // Step 5: Start segmentation
      await page.click('[data-testid="image-card"]');
      await page.click('button:has-text("Segment")');

      // Select model
      await page.waitForSelector('[data-testid="model-selector"]');
      await page.selectOption('[data-testid="model-selector"]', 'hrnet');

      await page.click('button:has-text("Start Segmentation")');

      // Wait for segmentation to complete (with timeout)
      await page.waitForSelector('[data-testid="segmentation-complete"]', {
        timeout: 60000,
      });

      // Step 6: Navigate to segmentation editor
      await page.click('button:has-text("Edit Segmentation")');
      await page.waitForURL('**/segmentation/*');

      // Verify canvas is loaded
      await expect(page.locator('canvas')).toBeVisible();

      // Step 7: Perform polygon editing
      const canvas = await page.locator('canvas');
      const box = await canvas.boundingBox();

      if (box) {
        // Add a new point to polygon
        await page.click('[data-testid="edit-mode-button"]');
        await canvas.click({
          position: { x: box.width / 2, y: box.height / 2 },
        });

        // Save changes
        await page.click('button:has-text("Save")');
        await page.waitForSelector('[data-testid="save-success"]');
      }

      // Step 8: Export results
      await page.click('button:has-text("Export")');
      await page.waitForSelector('[data-testid="export-dialog"]');

      // Select COCO format
      await page.click('input[value="coco"]');

      // Download export
      const downloadPromise = page.waitForEvent('download');
      await page.click('button:has-text("Download")');
      const download = await downloadPromise;

      // Verify download
      expect(download.suggestedFilename()).toContain('.json');

      // Step 9: Return to dashboard
      await page.click('[data-testid="nav-logo"]');
      await page.waitForURL('**/dashboard');

      // Verify project appears in dashboard
      await expect(page.locator(`text=${TEST_PROJECT.name}`)).toBeVisible();

      // Step 10: Logout
      await page.click('[data-testid="user-menu"]');
      await page.click('text=Logout');

      // Verify logged out
      await page.waitForURL('/');
      await expect(page.locator('text=Get Started')).toBeVisible();
    });
  });

  test.describe('Error Handling and Recovery', () => {
    test('should handle network failures gracefully', async () => {
      // Login first
      await login(page, 'test@example.com', 'password123');

      // Simulate network failure
      await page.route('**/api/**', route => route.abort());

      // Try to create a project
      await page.click('text=Create Project');
      await page.fill('input[name="name"]', 'Test Project');
      await page.click('button:has-text("Create")');

      // Should show error message
      await expect(page.locator('[data-testid="error-toast"]')).toBeVisible();
      await expect(page.locator('text=/network|connection/i')).toBeVisible();

      // Restore network
      await page.unroute('**/api/**');

      // Retry operation
      await page.click('button:has-text("Retry")');

      // Should succeed now
      await page.waitForSelector('[data-testid="success-toast"]');
    });

    test('should handle session expiration', async () => {
      // Login
      await login(page, 'test@example.com', 'password123');

      // Clear auth token to simulate expiration
      await page.evaluate(() => {
        localStorage.removeItem('accessToken');
        sessionStorage.clear();
      });

      // Try to access protected route
      await page.goto('/dashboard');

      // Should redirect to login
      await page.waitForURL('**/login');
      await expect(page.locator('text=Session expired')).toBeVisible();

      // Re-login
      await page.fill('input[name="email"]', 'test@example.com');
      await page.fill('input[name="password"]', 'password123');
      await page.click('button[type="submit"]');

      // Should return to dashboard
      await page.waitForURL('**/dashboard');
    });

    test('should handle concurrent operations correctly', async () => {
      await login(page, 'test@example.com', 'password123');

      // Create project
      await createProject(page, 'Concurrent Test Project');

      // Start multiple uploads simultaneously
      const uploadPromises = [];
      for (let i = 0; i < 3; i++) {
        uploadPromises.push(
          uploadImage(page, `tests/fixtures/sample-${i}.jpg`)
        );
      }

      // Wait for all uploads
      await Promise.all(uploadPromises);

      // Verify all images uploaded
      const imageCards = await page
        .locator('[data-testid="image-card"]')
        .count();
      expect(imageCards).toBe(3);

      // Start segmentation on all images
      for (let i = 0; i < 3; i++) {
        await page.locator('[data-testid="image-card"]').nth(i).click();
        await page.click('button:has-text("Segment")');
        await page.selectOption('[data-testid="model-selector"]', 'hrnet');
        await page.click('button:has-text("Start Segmentation")');
      }

      // Verify queue status shows for all
      await expect(page.locator('[data-testid="queue-status"]')).toHaveCount(3);
    });
  });

  test.describe('Performance Critical Paths', () => {
    test('should handle large dataset efficiently', async () => {
      await login(page, 'test@example.com', 'password123');

      // Measure initial load time
      const startTime = Date.now();
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;

      // Should load within 3 seconds
      expect(loadTime).toBeLessThan(3000);

      // Create project with many images
      await createProject(page, 'Performance Test Project');

      // Upload multiple images
      const files = Array(10).fill('tests/fixtures/sample-cell-image.jpg');
      await page.locator('input[type="file"]').setInputFiles(files);

      // Measure grid rendering time
      const gridStartTime = Date.now();
      await page.waitForSelector('[data-testid="image-grid"]');
      const gridLoadTime = Date.now() - gridStartTime;

      // Should render grid within 2 seconds
      expect(gridLoadTime).toBeLessThan(2000);

      // Test pagination
      if (await page.locator('[data-testid="pagination"]').isVisible()) {
        await page.click('[data-testid="next-page"]');
        await page.waitForLoadState('networkidle');

        // Verify page changed
        await expect(
          page.locator('[data-testid="page-indicator"]')
        ).toContainText('2');
      }
    });

    test('should handle large polygons efficiently in editor', async () => {
      await login(page, 'test@example.com', 'password123');

      // Navigate to segmentation editor with complex data
      await page.goto('/segmentation/test-project/test-image');

      // Mock complex polygon data
      await page.evaluate(() => {
        // Create polygon with many points
        const complexPolygon = {
          id: 'complex-1',
          points: Array(1000)
            .fill(null)
            .map((_, i) => ({
              x: Math.sin(i / 100) * 200 + 400,
              y: Math.cos(i / 100) * 200 + 300,
            })),
        };

        // Inject into application state
        window.dispatchEvent(
          new CustomEvent('test-load-polygon', {
            detail: complexPolygon,
          })
        );
      });

      // Measure rendering performance
      const renderStartTime = Date.now();
      await page.waitForSelector('canvas');
      const renderTime = Date.now() - renderStartTime;

      // Should render within 1 second
      expect(renderTime).toBeLessThan(1000);

      // Test zoom performance
      await page.keyboard.press('Control+Plus');
      await page.waitForTimeout(100);
      await page.keyboard.press('Control+Plus');

      // Should remain responsive
      const canvas = await page.locator('canvas');
      await expect(canvas).toBeVisible();
    });
  });

  test.describe('Accessibility and Internationalization', () => {
    test('should be navigable with keyboard only', async () => {
      await page.goto('/');

      // Tab through main navigation
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toHaveAttribute(
        'data-testid',
        'nav-logo'
      );

      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toContainText('Features');

      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toContainText('About');

      // Navigate to login with Enter
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');

      await page.waitForURL('**/login');

      // Fill form with keyboard
      await page.keyboard.press('Tab');
      await page.keyboard.type('test@example.com');

      await page.keyboard.press('Tab');
      await page.keyboard.type('password123');

      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');

      // Should submit form
      await page.waitForURL('**/dashboard');
    });

    test('should support multiple languages', async () => {
      await page.goto('/');

      // Open language selector
      await page.click('[data-testid="language-selector"]');

      // Test German
      await page.click('text=Deutsch');
      await page.waitForTimeout(500);
      await expect(page.locator('h1')).toContainText(
        /Willkommen|Segmentierung/
      );

      // Test Spanish
      await page.click('[data-testid="language-selector"]');
      await page.click('text=Español');
      await page.waitForTimeout(500);
      await expect(page.locator('h1')).toContainText(/Bienvenido|Segmentación/);

      // Test Chinese
      await page.click('[data-testid="language-selector"]');
      await page.click('text=中文');
      await page.waitForTimeout(500);
      await expect(page.locator('h1')).toContainText(/欢迎|分割/);

      // Return to English
      await page.click('[data-testid="language-selector"]');
      await page.click('text=English');
    });

    test('should maintain proper contrast ratios', async () => {
      await page.goto('/');

      // Check text contrast
      const backgroundColor = await page.evaluate(() => {
        const body = document.body;
        return window.getComputedStyle(body).backgroundColor;
      });

      const textColor = await page.evaluate(() => {
        const heading = document.querySelector('h1');
        return window.getComputedStyle(heading!).color;
      });

      // Basic contrast check (simplified)
      expect(backgroundColor).not.toBe(textColor);

      // Test dark mode contrast
      await page.click('[data-testid="theme-toggle"]');
      await page.waitForTimeout(500);

      const darkBackgroundColor = await page.evaluate(() => {
        const body = document.body;
        return window.getComputedStyle(body).backgroundColor;
      });

      const darkTextColor = await page.evaluate(() => {
        const heading = document.querySelector('h1');
        return window.getComputedStyle(heading!).color;
      });

      expect(darkBackgroundColor).not.toBe(darkTextColor);
    });
  });

  test.describe('Data Integrity and Security', () => {
    test('should validate all form inputs', async () => {
      await page.goto('/register');

      // Test empty submission
      await page.click('button[type="submit"]');
      await expect(page.locator('text=required')).toBeVisible();

      // Test invalid email
      await page.fill('input[name="email"]', 'invalid-email');
      await page.click('button[type="submit"]');
      await expect(page.locator('text=/invalid|email/i')).toBeVisible();

      // Test weak password
      await page.fill('input[name="email"]', 'test@example.com');
      await page.fill('input[name="password"]', '123');
      await page.click('button[type="submit"]');
      await expect(
        page.locator('text=/password|weak|characters/i')
      ).toBeVisible();

      // Test password mismatch
      await page.fill('input[name="password"]', 'StrongPassword123!');
      await page.fill('input[name="confirmPassword"]', 'DifferentPassword123!');
      await page.click('button[type="submit"]');
      await expect(page.locator('text=/match|same/i')).toBeVisible();
    });

    test('should prevent XSS attacks', async () => {
      await login(page, 'test@example.com', 'password123');

      // Try to inject script in project name
      await page.click('text=Create Project');
      await page.fill('input[name="name"]', '<script>alert("XSS")</script>');
      await page.fill('textarea[name="description"]', 'Test description');
      await page.click('button:has-text("Create")');

      // Script should be escaped, not executed
      const alerts = [];
      page.on('dialog', dialog => {
        alerts.push(dialog.message());
        dialog.dismiss();
      });

      await page.waitForTimeout(1000);
      expect(alerts).toHaveLength(0);

      // Verify text is displayed safely
      await expect(page.locator('text=<script>')).toBeVisible();
    });

    test('should handle file upload validation', async () => {
      await login(page, 'test@example.com', 'password123');
      await createProject(page, 'Upload Test Project');

      // Try to upload non-image file
      const fileInput = await page.locator('input[type="file"]');
      await fileInput.setInputFiles('tests/fixtures/test-document.pdf');

      // Should show error
      await expect(
        page.locator('text=/invalid|supported|image/i')
      ).toBeVisible();

      // Try to upload oversized file using DataTransfer API
      await page.evaluate(() => {
        const input = document.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement;

        // Create a large file using Blob
        const largeContent = new Uint8Array(100 * 1024 * 1024); // 100MB
        const largeBlob = new Blob([largeContent], { type: 'image/jpeg' });
        const largeFile = new File([largeBlob], 'large-image.jpg', {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });

        // Use DataTransfer to set the file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(largeFile);
        input.files = dataTransfer.files;

        // Dispatch change event
        const changeEvent = new Event('change', { bubbles: true });
        input.dispatchEvent(changeEvent);
      });

      await expect(page.locator('text=/size|large|limit/i')).toBeVisible();
    });
  });

  test.describe('Real-time Features', () => {
    test('should receive WebSocket updates', async () => {
      await login(page, 'test@example.com', 'password123');

      // Check WebSocket connection status
      await page.waitForSelector('[data-testid="ws-status-connected"]', {
        timeout: 5000,
      });

      // Start segmentation
      await page.goto('/projects/test-project');
      await page.click('[data-testid="image-card"]');
      await page.click('button:has-text("Segment")');
      await page.selectOption('[data-testid="model-selector"]', 'hrnet');
      await page.click('button:has-text("Start Segmentation")');

      // Should show queue position
      await expect(
        page.locator('[data-testid="queue-position"]')
      ).toBeVisible();

      // Should update status in real-time
      await page.waitForSelector('[data-testid="status-processing"]', {
        timeout: 10000,
      });

      // Should show completion notification
      await page.waitForSelector('[data-testid="segmentation-complete"]', {
        timeout: 60000,
      });
    });

    test('should handle WebSocket reconnection', async () => {
      await login(page, 'test@example.com', 'password123');

      // Simulate disconnect
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'));
      });

      // Should show disconnected status
      await expect(
        page.locator('[data-testid="ws-status-disconnected"]')
      ).toBeVisible();

      // Simulate reconnect
      await page.evaluate(() => {
        window.dispatchEvent(new Event('online'));
      });

      // Should reconnect automatically
      await page.waitForSelector('[data-testid="ws-status-connected"]', {
        timeout: 10000,
      });
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should work on mobile viewport', async () => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto('/');

      // Mobile menu should be visible
      await expect(
        page.locator('[data-testid="mobile-menu-button"]')
      ).toBeVisible();

      // Open mobile menu
      await page.click('[data-testid="mobile-menu-button"]');
      await expect(page.locator('[data-testid="mobile-menu"]')).toBeVisible();

      // Navigate to login
      await page.click('text=Login');
      await page.waitForURL('**/login');

      // Login form should be responsive
      const formWidth = await page
        .locator('form')
        .evaluate(el => el.clientWidth);
      expect(formWidth).toBeLessThanOrEqual(375);

      // Login
      await page.fill('input[name="email"]', 'test@example.com');
      await page.fill('input[name="password"]', 'password123');
      await page.click('button[type="submit"]');

      await page.waitForURL('**/dashboard');

      // Dashboard should be responsive
      const cards = await page.locator('[data-testid="project-card"]');
      const firstCardWidth = await cards.first().evaluate(el => el.clientWidth);
      expect(firstCardWidth).toBeLessThanOrEqual(375);
    });

    test('should handle touch interactions', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      await login(page, 'test@example.com', 'password123');

      // Navigate to segmentation editor
      await page.goto('/segmentation/test-project/test-image');

      const canvas = await page.locator('canvas');
      const box = await canvas.boundingBox();

      if (box) {
        // Simulate touch drag
        await page.touchscreen.tap(box.x + 50, box.y + 50);
        await page.waitForTimeout(100);

        // Simulate pinch zoom with proper touch events
        await page.evaluate(_boxCoords => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return;

          const rect = canvas.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          // Create two touch points
          const touch1 = new Touch({
            identifier: 0,
            target: canvas,
            clientX: centerX - 50,
            clientY: centerY,
            pageX: centerX - 50,
            pageY: centerY,
          });

          const touch2 = new Touch({
            identifier: 1,
            target: canvas,
            clientX: centerX + 50,
            clientY: centerY,
            pageX: centerX + 50,
            pageY: centerY,
          });

          // Start touch
          const touchStart = new TouchEvent('touchstart', {
            touches: [touch1, touch2],
            targetTouches: [touch1, touch2],
            changedTouches: [touch1, touch2],
            bubbles: true,
            cancelable: true,
          });
          canvas.dispatchEvent(touchStart);

          // Move touches apart (pinch out to zoom in)
          const touch1Moved = new Touch({
            identifier: 0,
            target: canvas,
            clientX: centerX - 100,
            clientY: centerY,
            pageX: centerX - 100,
            pageY: centerY,
          });

          const touch2Moved = new Touch({
            identifier: 1,
            target: canvas,
            clientX: centerX + 100,
            clientY: centerY,
            pageX: centerX + 100,
            pageY: centerY,
          });

          const touchMove = new TouchEvent('touchmove', {
            touches: [touch1Moved, touch2Moved],
            targetTouches: [touch1Moved, touch2Moved],
            changedTouches: [touch1Moved, touch2Moved],
            bubbles: true,
            cancelable: true,
          });
          canvas.dispatchEvent(touchMove);

          // End touch
          const touchEnd = new TouchEvent('touchend', {
            touches: [],
            targetTouches: [],
            changedTouches: [touch1Moved, touch2Moved],
            bubbles: true,
            cancelable: true,
          });
          canvas.dispatchEvent(touchEnd);
        }, box);

        await page.waitForTimeout(100);

        // Canvas should still be visible and functional
        await expect(canvas).toBeVisible();
      }
    });
  });
});
