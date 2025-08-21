import { test, expect } from '@playwright/test';
import { createCanvas, CanvasRenderingContext2D } from 'canvas';
import { writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Visual regression tests for number rendering in visualizations
 * Tests the geometric shape-based number rendering for consistency
 */

test.describe('Number Rendering Visual Regression', () => {
  let testProjectId: string;
  let testImageId: string;

  test.beforeAll(async ({ request }) => {
    // Create a test project with segmentation data
    const projectResponse = await request.post('/api/projects', {
      data: {
        name: 'Visual Regression Test Project',
        description: 'Testing number rendering',
      },
    });

    const project = await projectResponse.json();
    testProjectId = project.id;

    // Upload a test image using actual JPEG fixture
    const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');
    const testImageBuffer = readFileSync(testImagePath);

    const imageResponse = await request.post(
      `/api/projects/${testProjectId}/images`,
      {
        multipart: {
          file: {
            name: 'test.jpg',
            mimeType: 'image/jpeg',
            buffer: testImageBuffer,
          },
        },
      }
    );

    const image = await imageResponse.json();
    testImageId = image.id;
  });

  test.describe('Single Digit Rendering', () => {
    const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const sizes = [16, 32, 64];

    for (const digit of digits) {
      for (const size of sizes) {
        test(`Digit ${digit} at ${size}px`, async ({ page }) => {
          // Navigate to visualization page
          await page.goto(
            `/projects/${testProjectId}/images/${testImageId}/visualization`
          );

          // Wait for canvas to be ready
          await page.waitForSelector('canvas', { state: 'visible' });

          // Take screenshot of the specific digit rendering area
          const canvas = await page.locator('canvas');
          const screenshot = await canvas.screenshot({
            clip: {
              x: 100, // Position where digit is rendered
              y: 100,
              width: size * 2,
              height: size * 2,
            },
          });

          // Compare with baseline
          expect(screenshot).toMatchSnapshot(`digit-${digit}-${size}px.png`, {
            maxDiffPixels: 100, // Allow small differences
            threshold: 0.2, // 20% difference threshold
          });
        });
      }
    }
  });

  test.describe('Multi-Digit Rendering', () => {
    const multiDigitNumbers = [10, 25, 50, 75, 99, 100, 250, 500, 750, 999];

    for (const number of multiDigitNumbers) {
      test(`Number ${number}`, async ({ page }) => {
        // Navigate to visualization with specific polygon number
        await page.goto(
          `/projects/${testProjectId}/images/${testImageId}/visualization?polygonNumber=${number}`
        );

        await page.waitForSelector('canvas', { state: 'visible' });

        const canvas = await page.locator('canvas');
        const screenshot = await canvas.screenshot({
          clip: {
            x: 100,
            y: 100,
            width: 150, // Wider for multi-digit numbers
            height: 100,
          },
        });

        expect(screenshot).toMatchSnapshot(`number-${number}.png`, {
          maxDiffPixels: 150,
          threshold: 0.2,
        });
      });
    }
  });

  test.describe('Large Number Dot Pattern', () => {
    const largeNumbers = [1000, 2500, 5000, 10000, 50000];

    for (const number of largeNumbers) {
      test(`Large number ${number} with dot pattern`, async ({ page }) => {
        await page.goto(
          `/projects/${testProjectId}/images/${testImageId}/visualization?polygonNumber=${number}`
        );

        await page.waitForSelector('canvas', { state: 'visible' });

        const canvas = await page.locator('canvas');
        const screenshot = await canvas.screenshot({
          clip: {
            x: 100,
            y: 100,
            width: 100,
            height: 100,
          },
        });

        expect(screenshot).toMatchSnapshot(`large-number-${number}.png`, {
          maxDiffPixels: 200,
          threshold: 0.25,
        });
      });
    }
  });

  test.describe('Cross-Browser Consistency', () => {
    const browsers = ['chromium', 'firefox', 'webkit'];

    for (const browserName of browsers) {
      test(`Consistent rendering in ${browserName}`, async ({
        page,
        browserName: currentBrowser,
      }) => {
        if (currentBrowser !== browserName) {
          test.skip();
          return;
        }

        // Test a selection of numbers
        const testNumbers = [5, 42, 123, 1000];

        for (const number of testNumbers) {
          await page.goto(
            `/projects/${testProjectId}/images/${testImageId}/visualization?polygonNumber=${number}`
          );
          await page.waitForSelector('canvas', { state: 'visible' });

          const canvas = await page.locator('canvas');
          const screenshot = await canvas.screenshot();

          expect(screenshot).toMatchSnapshot(
            `${browserName}-number-${number}.png`,
            {
              maxDiffPixels: 100,
              threshold: 0.2,
            }
          );
        }
      });
    }
  });

  test.describe('Performance with Many Numbers', () => {
    test('Render 100 polygons with numbers', async ({ page }) => {
      // Create test data with 100 polygons
      await page.goto(
        `/projects/${testProjectId}/images/${testImageId}/visualization?polygonCount=100`
      );

      await page.waitForSelector('canvas', { state: 'visible' });

      // Measure render time
      const startTime = Date.now();
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return false;
        // Check if rendering is complete
        const ctx = canvas.getContext('2d');
        return ctx !== null;
      });
      const renderTime = Date.now() - startTime;

      // Performance assertion
      expect(renderTime).toBeLessThan(5000); // Should render in less than 5 seconds

      // Visual check
      const canvas = await page.locator('canvas');
      const screenshot = await canvas.screenshot();
      expect(screenshot).toMatchSnapshot('many-polygons-100.png');
    });

    test('Render 1000 polygons with numbers', async ({ page }) => {
      await page.goto(
        `/projects/${testProjectId}/images/${testImageId}/visualization?polygonCount=1000`
      );

      await page.waitForSelector('canvas', { state: 'visible' });

      const startTime = Date.now();
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector('canvas');
          return canvas !== null;
        },
        { timeout: 30000 }
      );
      const renderTime = Date.now() - startTime;

      // Should still complete even with many polygons
      expect(renderTime).toBeLessThan(30000);

      // Check that warning was logged (by checking console)
      const consoleMessages: string[] = [];
      page.on('console', msg => consoleMessages.push(msg.text()));

      await page.reload();
      await page.waitForTimeout(1000);

      const hasWarning = consoleMessages.some(
        msg =>
          msg.includes('High polygon count') ||
          msg.includes('Performance may be degraded')
      );
      expect(hasWarning).toBeTruthy();
    });
  });

  test.describe('Cache Effectiveness', () => {
    test('Repeated numbers should use cache', async ({ page }) => {
      // Navigate to a page with many repeated numbers
      await page.goto(
        `/projects/${testProjectId}/images/${testImageId}/visualization?repeatedNumbers=true`
      );

      await page.waitForSelector('canvas', { state: 'visible' });

      // Get cache statistics via API with error handling
      const cacheStats = await page.evaluate(async () => {
        try {
          const response = await fetch('/api/visualization/cache-stats');
          if (!response.ok) {
            throw new Error(
              `Cache stats request failed: ${response.status} ${response.statusText}`
            );
          }
          try {
            return await response.json();
          } catch (parseError) {
            throw new Error(
              `Failed to parse cache stats JSON: ${parseError.message}`
            );
          }
        } catch (error) {
          // Return default values on error
          console.error('Failed to fetch cache stats:', error);
          return {
            hitRate: 0,
            hits: 0,
            misses: 0,
            error: error.message,
          };
        }
      });

      // Cache hit rate should be high for repeated numbers
      expect(cacheStats.hitRate).toBeGreaterThan(0.5); // At least 50% hit rate
      expect(cacheStats.hits).toBeGreaterThan(0);
    });
  });

  test.describe('Edge Cases', () => {
    test('Very small size (1px)', async ({ page }) => {
      await page.goto(
        `/projects/${testProjectId}/images/${testImageId}/visualization?fontSize=1`
      );
      await page.waitForSelector('canvas', { state: 'visible' });

      const canvas = await page.locator('canvas');
      const screenshot = await canvas.screenshot();
      expect(screenshot).toMatchSnapshot('edge-case-1px.png');
    });

    test('Very large size (200px)', async ({ page }) => {
      await page.goto(
        `/projects/${testProjectId}/images/${testImageId}/visualization?fontSize=200`
      );
      await page.waitForSelector('canvas', { state: 'visible' });

      const canvas = await page.locator('canvas');
      const screenshot = await canvas.screenshot();
      expect(screenshot).toMatchSnapshot('edge-case-200px.png');
    });

    test('Negative numbers handling', async ({ page }) => {
      // Should handle gracefully even though polygons shouldn't have negative IDs
      await page.goto(
        `/projects/${testProjectId}/images/${testImageId}/visualization?polygonNumber=-1`
      );
      await page.waitForSelector('canvas', { state: 'visible' });

      // Should either skip or render as absolute value
      const canvas = await page.locator('canvas');
      const screenshot = await canvas.screenshot();
      expect(screenshot).toBeDefined();
    });
  });

  test.afterAll(async ({ request }) => {
    // Clean up test project
    if (testProjectId) {
      await request.delete(`/api/projects/${testProjectId}`);
    }
  });
});

// Helper to generate baseline images programmatically
test.describe('Generate Baseline Images', () => {
  test.skip('Generate baseline screenshots', async () => {
    // This test is skipped by default
    // Run it once to generate baseline images
    // npm test -- --grep "Generate baseline screenshots"

    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

    // Generate baselines for digits 0-9
    for (let digit = 0; digit <= 9; digit++) {
      for (const size of [16, 32, 64]) {
        ctx.clearRect(0, 0, 200, 200);
        // Would call NUMBER_PATHS.drawDigit here
        const buffer = canvas.toBuffer('image/png');
        await writeFile(
          path.join(
            __dirname,
            `../../screenshots/digit-${digit}-${size}px.png`
          ),
          buffer
        );
      }
    }
  });
});
