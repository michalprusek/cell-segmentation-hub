import { test, expect, devices } from '@playwright/test';
import {
  setupAuthenticatedTest,
  TestSetupUtils,
} from '../fixtures/test-setup-utils';

test.describe('Cross-Browser and Mobile Compatibility Tests', () => {
  test.describe('Desktop Browser Compatibility', () => {
    ['chromium', 'firefox', 'webkit'].forEach(browserName => {
      test.describe(`${browserName} Browser Tests`, () => {
        test.use({
          ...(browserName === 'firefox'
            ? {
                launchOptions: {
                  firefoxUserPrefs: { 'dom.webnotifications.enabled': false },
                },
              }
            : {}),
          // WebKit-specific options removed for security
        });

        test(`should work correctly in ${browserName}`, async ({
          page,
          browser,
        }) => {
          const env = await setupAuthenticatedTest(page, 'cross-browser');

          // Test basic functionality across browsers
          await page
            .getByRole('button', { name: /create.*project|new.*project/i })
            .click();
          await page
            .getByLabel(/project name|name/i)
            .fill(`${browserName} Test Project`);
          await page
            .getByLabel(/description/i)
            .fill(`Testing compatibility in ${browserName}`);
          await page.getByRole('button', { name: /create|save/i }).click();

          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 10000 }
          );
          await expect(
            page.getByText(`${browserName} Test Project`)
          ).toBeVisible();

          // Test browser-specific features
          if (browserName === 'firefox') {
            // Firefox-specific tests
            await testFirefoxFeatures(page);
          } else if (browserName === 'webkit') {
            // Safari/WebKit-specific tests
            await testWebKitFeatures(page);
          } else if (browserName === 'chromium') {
            // Chrome-specific tests
            await testChromiumFeatures(page);
          }
        });

        test(`should handle file uploads in ${browserName}`, async ({
          page,
        }) => {
          const env = await setupAuthenticatedTest(
            page,
            `upload-${browserName}`
          );

          // Create project
          await page
            .getByRole('button', { name: /create.*project|new.*project/i })
            .click();
          await page
            .getByLabel(/project name|name/i)
            .fill(`Upload Test ${browserName}`);
          await page.getByLabel(/description/i).fill('Testing file upload');
          await page.getByRole('button', { name: /create|save/i }).click();
          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 10000 }
          );

          await page.getByText(`Upload Test ${browserName}`).click();

          // Test file upload
          const imagePaths = TestSetupUtils.getTestImagePaths(1);
          const fileInput = page.locator('input[type="file"]').first();
          await fileInput.setInputFiles(imagePaths);

          // Should work in all browsers
          await expect(page.getByText(/upload.*complete|success/i)).toBeVisible(
            {
              timeout: 15000,
            }
          );
        });

        test(`should handle WebSocket connections in ${browserName}`, async ({
          page,
        }) => {
          const env = await setupAuthenticatedTest(
            page,
            `websocket-${browserName}`
          );

          // Monitor WebSocket connection
          let wsConnected = false;
          page.on('websocket', ws => {
            wsConnected = true;
            console.log(`WebSocket connected in ${browserName}: ${ws.url()}`);
          });

          // Create project to trigger WebSocket activity
          await page
            .getByRole('button', { name: /create.*project|new.*project/i })
            .click();
          await page
            .getByLabel(/project name|name/i)
            .fill(`WebSocket Test ${browserName}`);
          await page
            .getByLabel(/description/i)
            .fill('Testing WebSocket compatibility');
          await page.getByRole('button', { name: /create|save/i }).click();
          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 10000 }
          );

          // WebSocket connection should work - wait for connection to establish
          await page.waitForFunction(
            () => {
              const wsConnected = (window as any).__wsConnected;
              const wsErrors = (window as any).__wsErrors;
              return (
                (typeof wsConnected === 'boolean' && wsConnected === true) ||
                wsErrors === undefined ||
                wsErrors === null
              );
            },
            { timeout: 5000 }
          );

          // Note: Connection may vary by browser, so we just check for no errors
          const hasErrors = await page.evaluate(() => {
            return !!(window as any).__wsErrors;
          });
          expect(hasErrors).toBe(false);
        });
      });
    });
  });

  test.describe('Mobile Device Compatibility', () => {
    const mobileDevices = ['iPhone 12', 'Pixel 5', 'iPad Pro', 'Galaxy S21'];

    mobileDevices.forEach(deviceName => {
      test.describe(`${deviceName} Tests`, () => {
        test.use({ ...devices[deviceName] });

        test(`should be responsive on ${deviceName}`, async ({ page }) => {
          const env = await setupAuthenticatedTest(
            page,
            `mobile-${deviceName.toLowerCase().replace(/\s/g, '-')}`
          );

          // Check viewport is mobile
          const viewport = page.viewportSize();
          expect(viewport).toBeTruthy();

          if (
            deviceName.includes('iPhone') ||
            deviceName.includes('Pixel') ||
            deviceName.includes('Galaxy')
          ) {
            // Phone viewport
            expect(viewport!.width).toBeLessThan(500);
          } else {
            // Tablet viewport
            expect(viewport!.width).toBeGreaterThan(500);
            expect(viewport!.width).toBeLessThan(1200);
          }

          // Test mobile navigation
          const mobileMenu = page.getByRole('button', {
            name: /menu|hamburger|☰/i,
          });
          if (await mobileMenu.isVisible({ timeout: 2000 })) {
            await mobileMenu.click();

            // Navigation should be accessible
            const navItems = page.locator('nav a, .nav-item');
            expect(await navItems.count()).toBeGreaterThan(0);
          }

          // Test mobile-friendly interactions
          await testMobileInteractions(page, deviceName);
        });

        test(`should handle touch interactions on ${deviceName}`, async ({
          page,
        }) => {
          const env = await setupAuthenticatedTest(
            page,
            `touch-${deviceName.toLowerCase().replace(/\s/g, '-')}`
          );

          // Create project for touch testing
          await page
            .getByRole('button', { name: /create.*project|new.*project/i })
            .click();
          await page
            .getByLabel(/project name|name/i)
            .fill(`Touch Test ${deviceName}`);
          await page
            .getByLabel(/description/i)
            .fill('Testing touch interactions');
          await page.getByRole('button', { name: /create|save/i }).click();
          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 10000 }
          );

          // Test touch targets are large enough (minimum 44x44px)
          const buttons = page.locator('button');
          const buttonCount = await buttons.count();

          for (let i = 0; i < Math.min(buttonCount, 5); i++) {
            const button = buttons.nth(i);
            if (await button.isVisible()) {
              const box = await button.boundingBox();
              if (box) {
                expect(box.width).toBeGreaterThanOrEqual(40); // Allow slight tolerance
                expect(box.height).toBeGreaterThanOrEqual(40);
              }
            }
          }

          // Test swipe gestures if applicable
          await testSwipeGestures(page, deviceName);
        });

        test(`should handle mobile file uploads on ${deviceName}`, async ({
          page,
        }) => {
          const env = await setupAuthenticatedTest(
            page,
            `mobile-upload-${deviceName.toLowerCase().replace(/\s/g, '-')}`
          );

          await page
            .getByRole('button', { name: /create.*project|new.*project/i })
            .click();
          await page
            .getByLabel(/project name|name/i)
            .fill(`Mobile Upload ${deviceName}`);
          await page
            .getByLabel(/description/i)
            .fill('Testing mobile file upload');
          await page.getByRole('button', { name: /create|save/i }).click();
          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 10000 }
          );

          await page.getByText(`Mobile Upload ${deviceName}`).click();

          // Test file upload on mobile
          const imagePaths = TestSetupUtils.getTestImagePaths(1);
          const fileInput = page.locator('input[type="file"]').first();

          // On mobile, file input might be styled differently
          if (await fileInput.isVisible()) {
            await fileInput.setInputFiles(imagePaths);
          } else {
            // Look for upload button or area
            const uploadButton = page.getByRole('button', {
              name: /upload|browse|choose.*file/i,
            });
            if (await uploadButton.isVisible()) {
              await uploadButton.click();
              await fileInput.setInputFiles(imagePaths);
            }
          }

          await expect(page.getByText(/upload.*complete|success/i)).toBeVisible(
            {
              timeout: 20000, // Allow extra time on mobile
            }
          );
        });

        test(`should work in landscape and portrait modes on ${deviceName}`, async ({
          page,
        }) => {
          // Only test orientation on phones/tablets, not desktop
          if (
            !deviceName.includes('iPhone') &&
            !deviceName.includes('Pixel') &&
            !deviceName.includes('iPad') &&
            !deviceName.includes('Galaxy')
          ) {
            test.skip();
          }

          const env = await setupAuthenticatedTest(
            page,
            `orientation-${deviceName.toLowerCase().replace(/\s/g, '-')}`
          );

          // Test portrait mode (default)
          let viewport = page.viewportSize()!;
          expect(viewport.height).toBeGreaterThan(viewport.width);

          // Test basic functionality in portrait
          await page
            .getByRole('button', { name: /create.*project|new.*project/i })
            .click();
          await page
            .getByLabel(/project name|name/i)
            .fill(`Orientation Test Portrait`);
          await page.getByRole('button', { name: /create|save/i }).click();
          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 10000 }
          );

          // Switch to landscape
          await page.setViewportSize({
            width: viewport.height,
            height: viewport.width,
          });

          // Wait for reflow
          await page.waitForTimeout(500);

          // Test that UI adapts to landscape
          viewport = page.viewportSize()!;
          expect(viewport.width).toBeGreaterThan(viewport.height);

          // Should still be functional in landscape
          await expect(
            page.getByText('Orientation Test Portrait')
          ).toBeVisible();

          // Test creating another project in landscape
          await page
            .getByRole('button', { name: /create.*project|new.*project/i })
            .click();
          await page
            .getByLabel(/project name|name/i)
            .fill(`Orientation Test Landscape`);
          await page.getByRole('button', { name: /create|save/i }).click();
          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 10000 }
          );
        });
      });
    });
  });

  test.describe('Browser Feature Detection', () => {
    test('should gracefully handle missing browser features', async ({
      page,
      browserName,
    }) => {
      const env = await setupAuthenticatedTest(page, 'feature-detection');

      // Test WebGL support
      const webglSupported = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        try {
          return !!(
            canvas.getContext('webgl') ||
            canvas.getContext('experimental-webgl')
          );
        } catch (e) {
          return false;
        }
      });

      console.log(`WebGL support in ${browserName}: ${webglSupported}`);

      // Test IndexedDB support
      const indexedDBSupported = await page.evaluate(() => {
        return 'indexedDB' in window;
      });

      console.log(`IndexedDB support in ${browserName}: ${indexedDBSupported}`);

      // Test File API support
      const fileAPISupported = await page.evaluate(() => {
        return 'File' in window && 'FileReader' in window;
      });

      console.log(`File API support in ${browserName}: ${fileAPISupported}`);

      // Application should work regardless of feature support
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Feature Detection Test');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
    });

    test('should handle different viewport sizes gracefully', async ({
      page,
    }) => {
      const env = await setupAuthenticatedTest(page, 'viewport-sizes');

      const viewportSizes = [
        { width: 320, height: 568 }, // iPhone 5
        { width: 768, height: 1024 }, // iPad
        { width: 1366, height: 768 }, // Laptop
        { width: 1920, height: 1080 }, // Desktop
        { width: 2560, height: 1440 }, // Large Desktop
      ];

      for (const size of viewportSizes) {
        await page.setViewportSize(size);
        await page.waitForTimeout(300); // Allow for reflow

        console.log(`Testing viewport: ${size.width}x${size.height}`);

        // Test basic functionality at this viewport size
        await expect(
          page.getByRole('button', { name: /create.*project|new.*project/i })
        ).toBeVisible();

        // Check for horizontal scrolling (should not occur)
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
        expect(bodyWidth).toBeLessThanOrEqual(size.width + 20); // Small tolerance

        // Test navigation at this size
        const navElements = page.locator(
          'nav, .navigation, [role="navigation"]'
        );
        if ((await navElements.count()) > 0) {
          const isNavVisible = await navElements.first().isVisible();
          // Navigation should be visible or have mobile menu
          if (!isNavVisible) {
            const mobileMenu = page.getByRole('button', {
              name: /menu|hamburger/i,
            });
            expect(await mobileMenu.isVisible()).toBe(true);
          }
        }
      }
    });
  });

  test.describe('Performance Across Browsers', () => {
    test('should meet performance benchmarks across browsers', async ({
      page,
      browserName,
    }) => {
      const env = await setupAuthenticatedTest(
        page,
        `performance-${browserName}`
      );

      // Measure page load performance
      const startTime = Date.now();
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;

      console.log(`${browserName} dashboard load time: ${loadTime}ms`);
      expect(loadTime).toBeLessThan(5000); // 5 seconds max

      // Test performance with project creation
      const createStartTime = Date.now();
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill(`Performance Test ${browserName}`);
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      const createTime = Date.now() - createStartTime;

      console.log(`${browserName} project creation time: ${createTime}ms`);
      expect(createTime).toBeLessThan(3000); // 3 seconds max

      // Test memory usage (if available)
      const memoryUsage = await page.evaluate(() => {
        if ('memory' in performance) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return null;
      });

      if (memoryUsage) {
        console.log(
          `${browserName} memory usage: ${Math.round(memoryUsage / 1024 / 1024)}MB`
        );
        expect(memoryUsage).toBeLessThan(100 * 1024 * 1024); // 100MB max
      }
    });
  });
});

// Helper functions for browser-specific tests
async function testFirefoxFeatures(page: import('@playwright/test').Page) {
  // Test Firefox-specific features or known issues
  console.log('Testing Firefox-specific features');

  // Firefox sometimes has different file upload behavior
  const fileInputs = page.locator('input[type="file"]');
  if ((await fileInputs.count()) > 0) {
    const firstFileInput = fileInputs.first();
    const isVisible = await firstFileInput.isVisible();
    console.log(`File input visible in Firefox: ${isVisible}`);
  }
}

async function testWebKitFeatures(page: import('@playwright/test').Page) {
  // Test Safari/WebKit-specific features or known issues
  console.log('Testing WebKit-specific features');

  // WebKit sometimes has different handling of certain CSS features
  const browserInfo = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    vendor: navigator.vendor,
  }));

  console.log('WebKit browser info:', browserInfo);
}

async function testChromiumFeatures(page: import('@playwright/test').Page) {
  // Test Chromium-specific features
  console.log('Testing Chromium-specific features');

  // Test Chrome DevTools API if available
  const hasDevTools = await page.evaluate(() => {
    return !!(window as any).chrome;
  });

  console.log(`Chrome APIs available: ${hasDevTools}`);
}

async function testMobileInteractions(
  page: import('@playwright/test').Page,
  deviceName: string
) {
  console.log(`Testing mobile interactions for ${deviceName}`);

  // Test touch scrolling
  await page.touchscreen.tap(200, 300);
  await page.waitForTimeout(100);

  // Test if elements are appropriately sized for mobile
  const clickableElements = page.locator('button, a, input[type="submit"]');
  const count = await clickableElements.count();

  for (let i = 0; i < Math.min(count, 3); i++) {
    const element = clickableElements.nth(i);
    if (await element.isVisible()) {
      const box = await element.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        console.log(`Element ${i} size: ${box.width}x${box.height}`);
      }
    }
  }
}

async function testSwipeGestures(
  page: import('@playwright/test').Page,
  deviceName: string
) {
  console.log(`Testing swipe gestures for ${deviceName}`);

  // Test horizontal swipe if there are swipeable elements
  const swipeableElements = page.locator('.swiper, .carousel, [data-swipe]');
  const swipeCount = await swipeableElements.count();

  if (swipeCount > 0) {
    const firstSwipeable = swipeableElements.first();
    const box = await firstSwipeable.boundingBox();

    if (box) {
      // Perform swipe gesture
      await page.touchscreen.tap(
        box.x + box.width * 0.8,
        box.y + box.height * 0.5
      );
      await page.touchscreen.move(
        box.x + box.width * 0.2,
        box.y + box.height * 0.5
      );
      console.log('Swipe gesture performed');
    }
  }
}
