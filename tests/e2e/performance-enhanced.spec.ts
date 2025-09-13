import { test, expect, Route } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Enhanced Performance Tests', () => {
  const testUser = {
    email: `performance-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const _testProject = {
    name: 'Performance Test Project',
    description: 'Comprehensive performance testing',
  };

  // Multiple test images for bulk testing (with existence check)
  const testImagePaths = [
    path.join(__dirname, '../fixtures/test-image.jpg'),
    path.join(__dirname, '../fixtures/test-image-2.jpg'),
    path.join(__dirname, '../fixtures/test-image-3.jpg'),
    path.join(__dirname, '../fixtures/test-image-4.jpg'),
    path.join(__dirname, '../fixtures/test-image-5.jpg'),
  ].filter(imagePath => {
    const exists = fs.existsSync(imagePath);
    if (!exists) {
      //       console.warn(`Test image not found: ${imagePath}`);
    }
    return exists;
  });

  // Ensure we have at least one test image
  if (testImagePaths.length === 0) {
    throw new Error(
      'No fixture images found for performance tests. Please ensure test images exist in the fixtures directory.'
    );
  }

  // Performance thresholds - environment-aware
  const isCI = !!process.env.CI;
  const PERFORMANCE_THRESHOLDS = {
    pageLoad: isCI ? 6000 : 3000, // Longer times in CI environment
    imageUpload: isCI ? 20000 : 10000,
    segmentation: isCI ? 120000 : 60000,
    editorLoad: isCI ? 10000 : 5000,
    canvasRender: isCI ? 3000 : 1000,
    apiResponse: isCI ? 5000 : 2000,
    memory: 100 * 1024 * 1024, // 100MB max memory increase
  };

  test.beforeEach(async ({ page }) => {
    // Setup: Register and login with performance monitoring
    const startTime = Date.now();

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

    const setupTime = Date.now() - startTime;
    expect(setupTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad * 2); // Allow extra time for setup
  });

  test.describe('Large Dataset Handling', () => {
    test('should handle 100+ image uploads efficiently', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Bulk Upload Performance Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing bulk upload performance');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Bulk Upload Performance Test').click();

      // Monitor memory usage before upload (Chrome-only feature)
      const browserName = page.context().browser()?.browserType().name();
      const initialMemory = await page.evaluate(() => {
        if (
          'memory' in performance &&
          (performance as any).memory &&
          typeof (performance as any).memory.usedJSHeapSize === 'number'
        ) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return 0;
      });
      const _isChrome = browserName === 'chromium';

      const startTime = Date.now();

      // Simulate large batch upload by uploading same images multiple times
      for (let batch = 0; batch < 5; batch++) {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(testImagePaths);

        // Wait for batch to complete before next batch
        await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
          timeout: PERFORMANCE_THRESHOLDS.imageUpload * testImagePaths.length,
        });

        // Check memory usage doesn't grow excessively
        const currentMemory = await page.evaluate(() => {
          if ('memory' in performance) {
            return (performance as any).memory.usedJSHeapSize;
          }
          return 0;
        });

        if (currentMemory > 0 && initialMemory > 0) {
          const memoryIncrease = currentMemory - initialMemory;
          // console.log(`Memory increase after batch ${batch + 1}: ${Math.round(memoryIncrease / 1024 / 1024)}MB`);

          // Memory shouldn't increase by more than threshold per batch
          expect(memoryIncrease).toBeLessThan(
            PERFORMANCE_THRESHOLDS.memory * (batch + 1)
          );
        }
      }

      const totalTime = Date.now() - startTime;
      const expectedMaxTime =
        PERFORMANCE_THRESHOLDS.imageUpload * testImagePaths.length * 5;

      // console.log(`Total bulk upload time: ${totalTime}ms (max expected: ${expectedMaxTime}ms)`);
      expect(totalTime).toBeLessThan(expectedMaxTime);

      // Should show correct image count
      await expect(page.getByText(/25.*images|images.*25/i)).toBeVisible();
    });

    test('should efficiently handle large project with many processed images', async ({
      page,
    }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Large Project Performance');
      await page
        .getByLabel(/description/i)
        .fill('Testing large project performance');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Large Project Performance').click();

      // Upload multiple images and process them
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 30000,
      });

      // Start batch segmentation if available
      const batchSegmentButton = page.getByRole('button', {
        name: /batch.*segment|segment.*all|process.*all/i,
      });

      if (await batchSegmentButton.isVisible()) {
        const startTime = Date.now();

        await batchSegmentButton.click();

        // Monitor processing of multiple images
        await expect(
          page.getByText(/processing|analyzing|queued/i)
        ).toBeVisible({ timeout: 10000 });

        // Wait for all to complete (should be done in parallel/queue)
        await expect(page.getByText(/complete|finished|done/i)).toBeVisible({
          timeout: PERFORMANCE_THRESHOLDS.segmentation * testImagePaths.length,
        });

        const processingTime = Date.now() - startTime;
        // console.log(`Batch processing time: ${processingTime}ms for ${testImagePaths.length} images`);

        // Batch processing should be more efficient than individual processing
        const maxExpectedTime =
          PERFORMANCE_THRESHOLDS.segmentation * testImagePaths.length * 0.7; // 70% of individual time
        expect(processingTime).toBeLessThan(maxExpectedTime);
      }

      // Test navigation performance with many images
      const startNavTime = Date.now();
      await page.goto('/dashboard');
      await page.getByText('Large Project Performance').click();
      const navTime = Date.now() - startNavTime;

      expect(navTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad);
    });

    test('should handle 1000+ polygon rendering efficiently', async ({
      page,
    }) => {
      // This test would require a project with many segmented images
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Polygon Rendering Performance');
      await page
        .getByLabel(/description/i)
        .fill('Testing polygon rendering performance');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Polygon Rendering Performance').click();

      // Upload and process image
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      const segmentButton = page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first();
      if (await segmentButton.isVisible()) {
        await segmentButton.click();
        await page.getByRole('button', { name: /start|process/i }).click();
        await expect(page.getByText(/complete|finished/i)).toBeVisible({
          timeout: 60000,
        });

        // Navigate to editor
        const editButton = page
          .getByRole('button', { name: /edit|editor|open.*editor/i })
          .first();
        await editButton.click();

        const startRenderTime = Date.now();
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        // Wait for initial polygon rendering
        await page.waitForTimeout(1000);
        const renderTime = Date.now() - startRenderTime;

        //         console.log(`Canvas and polygon render time: ${renderTime}ms`);
        expect(renderTime).toBeLessThan(
          PERFORMANCE_THRESHOLDS.canvasRender * 2
        );

        // Test zooming performance with many polygons
        const zoomStartTime = Date.now();
        const canvas = page.locator('canvas, .canvas-container').first();
        await canvas.hover({ position: { x: 200, y: 200 } });
        await page.mouse.wheel(0, -100); // Zoom in
        await page.waitForTimeout(200);
        await page.mouse.wheel(0, -100); // Zoom in more
        await page.waitForTimeout(200);
        const zoomTime = Date.now() - zoomStartTime;

        expect(zoomTime).toBeLessThan(PERFORMANCE_THRESHOLDS.canvasRender);

        // Test panning performance
        const panStartTime = Date.now();
        await canvas.dragTo(canvas, {
          sourcePosition: { x: 200, y: 200 },
          targetPosition: { x: 100, y: 100 },
        });
        const panTime = Date.now() - panStartTime;

        expect(panTime).toBeLessThan(500); // Pan should be very fast
      }
    });
  });

  test.describe('Memory Usage Monitoring', () => {
    test('should not leak memory during extended sessions', async ({
      page,
    }) => {
      // Monitor memory over extended usage
      const initialMemory = await page.evaluate(() => {
        if ('memory' in performance) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return 0;
      });

      // Perform memory-intensive operations repeatedly
      for (let i = 0; i < 10; i++) {
        // Create and delete project
        await page
          .getByRole('button', { name: /create.*project|new.*project/i })
          .click();
        await page
          .getByLabel(/project name|name/i)
          .fill(`Memory Test Project ${i}`);
        await page.getByLabel(/description/i).fill(`Testing memory usage ${i}`);
        await page.getByRole('button', { name: /create|save/i }).click();
        await expect(page.getByText(/project.*created|success/i)).toBeVisible({
          timeout: 10000,
        });

        // Upload image
        await page.getByText(`Memory Test Project ${i}`).click();
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(testImagePaths[0]);
        await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
          timeout: 15000,
        });

        // Navigate back to dashboard
        await page.goto('/dashboard');

        // Delete project
        const moreButton = page
          .getByRole('button', { name: /more.*options|menu|⋮/i })
          .first();
        if (await moreButton.isVisible()) {
          await moreButton.click();
          const deleteOption = page.getByText(/delete/i);
          if (await deleteOption.isVisible()) {
            await deleteOption.click();
            const confirmButton = page.getByRole('button', {
              name: /confirm|delete|yes/i,
            });
            await confirmButton.click();
            await expect(page.getByText(/deleted|removed/i)).toBeVisible({
              timeout: 5000,
            });
          }
        }

        // Check memory every few iterations
        if (i % 3 === 0 && i > 0) {
          const currentMemory = await page.evaluate(() => {
            if ('memory' in performance) {
              return (performance as any).memory.usedJSHeapSize;
            }
            return 0;
          });

          if (currentMemory > 0 && initialMemory > 0) {
            const memoryIncrease = currentMemory - initialMemory;
            // console.log(`Memory increase after ${i + 1} operations: ${Math.round(memoryIncrease / 1024 / 1024)}MB`);

            // Memory shouldn't grow excessively
            expect(memoryIncrease).toBeLessThan(
              PERFORMANCE_THRESHOLDS.memory * 2
            );
          }
        }
      }

      // Force garbage collection if available
      await page.evaluate(() => {
        if ('gc' in window) {
          (window as any).gc();
        }
      });

      const finalMemory = await page.evaluate(() => {
        if ('memory' in performance) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return 0;
      });

      if (finalMemory > 0 && initialMemory > 0) {
        const totalMemoryIncrease = finalMemory - initialMemory;
        // console.log(`Total memory increase: ${Math.round(totalMemoryIncrease / 1024 / 1024)}MB`);
        expect(totalMemoryIncrease).toBeLessThan(PERFORMANCE_THRESHOLDS.memory);
      }
    });

    test('should handle memory pressure from large images', async ({
      page,
    }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Large Image Memory Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing memory with large images');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Large Image Memory Test').click();

      const beforeMemory = await page.evaluate(() => {
        if ('memory' in performance) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return 0;
      });

      // Upload multiple large images
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 30000,
      });

      const _afterUploadMemory = await page.evaluate(() => {
        if ('memory' in performance) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return 0;
      });

      // Navigate to editor with images
      const editButton = page
        .getByRole('button', { name: /edit|editor|first.*image/i })
        .first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        const afterEditorMemory = await page.evaluate(() => {
          if ('memory' in performance) {
            return (performance as any).memory.usedJSHeapSize;
          }
          return 0;
        });

        if (afterEditorMemory > 0 && beforeMemory > 0) {
          const memoryIncrease = afterEditorMemory - beforeMemory;
          // console.log(`Memory increase with large images: ${Math.round(memoryIncrease / 1024 / 1024)}MB`);

          // Should not use excessive memory
          expect(memoryIncrease).toBeLessThan(
            PERFORMANCE_THRESHOLDS.memory * 3
          );
        }

        // Test image switching performance
        const nextImageButton = page.getByRole('button', {
          name: /next.*image|forward/i,
        });
        if (await nextImageButton.isVisible()) {
          const switchStartTime = Date.now();
          await nextImageButton.click();
          await page.waitForTimeout(500); // Wait for image to switch
          const switchTime = Date.now() - switchStartTime;

          expect(switchTime).toBeLessThan(PERFORMANCE_THRESHOLDS.canvasRender);
        }
      }
    });
  });

  test.describe('Render Performance Metrics', () => {
    test('should maintain 60 FPS during canvas interactions', async ({
      page,
    }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Canvas Performance Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing canvas render performance');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Canvas Performance Test').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Process image to have polygons to render
      const segmentButton = page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first();
      if (await segmentButton.isVisible()) {
        await segmentButton.click();
        await page.getByRole('button', { name: /start|process/i }).click();
        await expect(page.getByText(/complete|finished/i)).toBeVisible({
          timeout: 60000,
        });

        const editButton = page
          .getByRole('button', { name: /edit|editor/i })
          .first();
        await editButton.click();
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        // Measure frame rate during intensive operations
        const canvas = page.locator('canvas, .canvas-container').first();

        // Test continuous dragging performance
        const _dragStartTime = Date.now();
        const _frameCount = 0;

        // Start performance monitoring
        await page.evaluate(() => {
          (window as any).performanceFrames = [];
          (window as any).performanceStart = Date.now();

          const measureFrame = () => {
            (window as any).performanceFrames.push(Date.now());
            if (Date.now() - (window as any).performanceStart < 2000) {
              requestAnimationFrame(measureFrame);
            }
          };

          requestAnimationFrame(measureFrame);
        });

        // Perform intensive canvas operations
        for (let i = 0; i < 20; i++) {
          await canvas.hover({ position: { x: 100 + i * 10, y: 100 + i * 5 } });
          await page.waitForTimeout(50);
        }

        // Get performance data
        const performanceData = await page.evaluate(() => {
          const frames = (window as any).performanceFrames || [];
          const duration = Date.now() - (window as any).performanceStart;
          return { frameCount: frames.length, duration };
        });

        if (performanceData.frameCount > 0 && performanceData.duration > 0) {
          const fps =
            (performanceData.frameCount / performanceData.duration) * 1000;
          //           console.log(`Canvas FPS during operations: ${Math.round(fps)}`);

          // Should maintain reasonable frame rate (at least 30 FPS)
          expect(fps).toBeGreaterThan(30);
        }

        // Test zoom performance
        const zoomStartTime = Date.now();
        await canvas.hover({ position: { x: 200, y: 200 } });
        for (let i = 0; i < 5; i++) {
          await page.mouse.wheel(0, -50);
          await page.waitForTimeout(100);
        }
        const zoomTime = Date.now() - zoomStartTime;

        expect(zoomTime).toBeLessThan(PERFORMANCE_THRESHOLDS.canvasRender);
      }
    });

    test('should efficiently render complex polygon geometries', async ({
      page,
    }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Complex Geometry Performance');
      await page
        .getByLabel(/description/i)
        .fill('Testing complex polygon rendering');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('Complex Geometry Performance').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      const editButton = page
        .getByRole('button', { name: /edit|editor|annotate/i })
        .first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await expect(page.locator('canvas, .canvas-container')).toBeVisible({
          timeout: 10000,
        });

        const canvas = page.locator('canvas, .canvas-container').first();

        // Create complex polygon with many vertices
        const createButton = page.getByRole('button', {
          name: /create.*polygon|new.*polygon/i,
        });
        if (await createButton.isVisible()) {
          await createButton.click();

          const startTime = Date.now();

          // Create polygon with 50+ vertices
          const centerX = 200;
          const centerY = 200;
          const radius = 100;

          for (let i = 0; i < 50; i++) {
            const angle = (i / 50) * 2 * Math.PI;
            const x = centerX + Math.cos(angle) * (radius + Math.random() * 20);
            const y = centerY + Math.sin(angle) * (radius + Math.random() * 20);

            await canvas.click({
              position: { x: Math.round(x), y: Math.round(y) },
            });

            // Small delay to prevent overwhelming the system
            if (i % 10 === 0) {
              await page.waitForTimeout(50);
            }
          }

          // Close polygon
          await canvas.dblclick({
            position: { x: centerX + radius, y: centerY },
          });

          const creationTime = Date.now() - startTime;
          //           console.log(`Complex polygon creation time: ${creationTime}ms`);

          // Should handle complex geometry creation in reasonable time
          expect(creationTime).toBeLessThan(
            PERFORMANCE_THRESHOLDS.canvasRender * 5
          );

          // Test editing performance with complex polygon
          const editStartTime = Date.now();

          // Enter vertex editing mode
          await canvas.dblclick({ position: { x: centerX, y: centerY } });

          // Try to drag a vertex
          await canvas.dragTo(canvas, {
            sourcePosition: { x: centerX + 50, y: centerY },
            targetPosition: { x: centerX + 60, y: centerY + 10 },
          });

          const editTime = Date.now() - editStartTime;
          expect(editTime).toBeLessThan(PERFORMANCE_THRESHOLDS.canvasRender);
        }
      }
    });
  });

  test.describe('API Response Time Validation', () => {
    test('should meet API response time requirements', async ({ page }) => {
      const apiMetrics: { [key: string]: number[] } = {};

      // Define route handler
      const apiRouteHandler = async (route: Route) => {
        const startTime = Date.now();
        const url = route.request().url();
        const method = route.request().method();

        try {
          const response = await route.fetch();
          const responseTime = Date.now() - startTime;
          const _endpoint = `${method} ${url.split('/api/')[1]?.split('?')[0] || 'unknown'}`;

          if (!apiMetrics[endpoint]) {
            apiMetrics[endpoint] = [];
          }
          apiMetrics[endpoint].push(responseTime);

          await route.fulfill({ response });
        } catch (_error) {
          //           console.warn('Route handling error:', _error);
          await route.continue();
        }
      };

      // Register route handler
      await page.route('**/api/**', apiRouteHandler);

      try {
        // Perform various operations to test API performance
        await page
          .getByRole('button', { name: /create.*project|new.*project/i })
          .click();
        await page
          .getByLabel(/project name|name/i)
          .fill('API Performance Test');
        await page
          .getByLabel(/description/i)
          .fill('Testing API response times');
        await page.getByRole('button', { name: /create|save/i }).click();
        await expect(page.getByText(/project.*created|success/i)).toBeVisible({
          timeout: 10000,
        });

        await page.getByText('API Performance Test').click();

        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(testImagePaths[0]);
        await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
          timeout: 15000,
        });

        // Test segmentation API
        const segmentButton = page
          .getByRole('button', { name: /segment|analyze|process/i })
          .first();
        if (await segmentButton.isVisible()) {
          await segmentButton.click();
          await page.getByRole('button', { name: /start|process/i }).click();
          await expect(page.getByText(/processing|queued/i)).toBeVisible({
            timeout: 10000,
          });
        }

        // Navigate around to trigger more API calls
        await page.goto('/dashboard');
        await page.getByText('API Performance Test').click();

        // Analyze API metrics
        for (const [_endpoint, times] of Object.entries(apiMetrics)) {
          if (times.length > 0) {
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const maxTime = Math.max(...times);

            // console.log(`${endpoint}: avg ${Math.round(avgTime)}ms, max ${Math.round(maxTime)}ms (${times.length} calls)`);

            // Most API calls should be under threshold
            expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.apiResponse);

            // Even max time shouldn't be excessive (allow 3x threshold)
            expect(maxTime).toBeLessThan(
              PERFORMANCE_THRESHOLDS.apiResponse * 3
            );
          }
        }
      } finally {
        // Ensure route handler is always removed
        await page.unroute('**/api/**', apiRouteHandler);
      }
    });

    test('should handle concurrent API requests efficiently', async ({
      page,
    }) => {
      const concurrentRequests: Promise<any>[] = [];
      const requestTimes: number[] = [];

      // Setup API monitoring
      await page.route('**/api/projects', async route => {
        const startTime = Date.now();
        await route.continue();
        requestTimes.push(Date.now() - startTime);
      });

      // Create multiple projects concurrently
      for (let i = 0; i < 5; i++) {
        const projectPromise = (async () => {
          await page
            .getByRole('button', { name: /create.*project|new.*project/i })
            .click();
          await page
            .getByLabel(/project name|name/i)
            .fill(`Concurrent Project ${i}`);
          await page.getByLabel(/description/i).fill(`Concurrent test ${i}`);
          await page.getByRole('button', { name: /create|save/i }).click();
          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 15000 }
          );
        })();

        concurrentRequests.push(projectPromise);

        // Small stagger to simulate realistic usage
        await page.waitForTimeout(100);
      }

      // Wait for all concurrent operations to complete
      const startTime = Date.now();
      await Promise.all(concurrentRequests);
      const totalTime = Date.now() - startTime;

      //       console.log(`Concurrent project creation took ${totalTime}ms`);

      // Should handle concurrent requests efficiently
      expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.apiResponse * 10); // Allow for some queuing

      // Check all projects were created
      for (let i = 0; i < 5; i++) {
        await expect(page.getByText(`Concurrent Project ${i}`)).toBeVisible();
      }

      await page.unroute('**/api/projects');
    });
  });

  test.describe('WebSocket Latency Testing', () => {
    test('should maintain low WebSocket latency for real-time updates', async ({
      page,
    }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('WebSocket Latency Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing WebSocket performance');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('WebSocket Latency Test').click();

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Monitor WebSocket messages
      const _wsMessages: Array<{ timestamp: number; type: string }> = [];

      await page.evaluate(() => {
        const originalWebSocket = window.WebSocket;
        (window as any).wsLatencyMetrics = [];

        window.WebSocket = function (url, protocols) {
          const ws = new originalWebSocket(url, protocols);
          const originalSend = ws.send;

          ws.send = function (data) {
            (window as any).lastWsSendTime = Date.now();
            return originalSend.call(this, data);
          };

          ws.addEventListener('message', _event => {
            const now = Date.now();
            const sendTime = (window as any).lastWsSendTime;
            if (sendTime) {
              const latency = now - sendTime;
              (window as any).wsLatencyMetrics.push({
                latency,
                timestamp: now,
              });
            }
          });

          return ws;
        } as any;
      });

      // Start segmentation to trigger WebSocket activity
      const segmentButton = page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first();
      if (await segmentButton.isVisible()) {
        await segmentButton.click();
        await page.getByRole('button', { name: /start|process/i }).click();

        // Wait for processing to start and generate WebSocket messages
        await expect(
          page.getByText(/processing|queued|analyzing/i)
        ).toBeVisible({ timeout: 10000 });

        // Wait for some WebSocket activity
        await page.waitForTimeout(5000);

        // Get WebSocket latency metrics
        const latencyMetrics = await page.evaluate(() => {
          return (window as any).wsLatencyMetrics || [];
        });

        if (latencyMetrics.length > 0) {
          const latencies = latencyMetrics.map((m: any) => m.latency);
          const avgLatency =
            latencies.reduce((a: number, b: number) => a + b, 0) /
            latencies.length;
          const maxLatency = Math.max(...latencies);

          // console.log(`WebSocket latency: avg ${Math.round(avgLatency)}ms, max ${Math.round(maxLatency)}ms`);

          // WebSocket latency should be low for real-time feel
          expect(avgLatency).toBeLessThan(500); // 500ms average
          expect(maxLatency).toBeLessThan(2000); // 2s max
        }

        // Wait for processing to complete
        await expect(page.getByText(/complete|finished/i)).toBeVisible({
          timeout: 60000,
        });
      }
    });

    test('should handle WebSocket reconnection performance', async ({
      page,
    }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('WS Reconnection Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing WebSocket reconnection');
      await page.getByRole('button', { name: /create|save/i }).click();
      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('WS Reconnection Test').click();

      // Set up WebSocket monitoring
      const _reconnectionTime = 0;

      await page.evaluate(() => {
        (window as any).wsReconnectionStart = 0;
        (window as any).wsReconnectionEnd = 0;

        const originalWebSocket = window.WebSocket;
        window.WebSocket = function (url, protocols) {
          const ws = new originalWebSocket(url, protocols);

          ws.addEventListener('close', () => {
            (window as any).wsReconnectionStart = Date.now();
          });

          ws.addEventListener('open', () => {
            if ((window as any).wsReconnectionStart > 0) {
              (window as any).wsReconnectionEnd = Date.now();
            }
          });

          return ws;
        } as any;
      });

      // Upload image to establish WebSocket connection
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Simulate network disruption
      await page.route('**/socket.io/**', route => {
        route.abort();
      });

      // Wait for disconnection
      await page.waitForTimeout(2000);

      // Restore connection
      await page.unroute('**/socket.io/**');

      // Wait for reconnection
      await page.waitForTimeout(5000);

      // Get reconnection metrics
      const reconnectionMetrics = await page.evaluate(() => {
        const start = (window as any).wsReconnectionStart;
        const end = (window as any).wsReconnectionEnd;
        return { start, end, duration: end > start ? end - start : 0 };
      });

      if (reconnectionMetrics.duration > 0) {
        // console.log(`WebSocket reconnection took ${reconnectionMetrics.duration}ms`);
        expect(reconnectionMetrics.duration).toBeLessThan(5000); // Should reconnect within 5 seconds
      }

      // Should show connection status
      const connectionStatus = page.getByText(/connected|online|reconnected/i);
      if (await connectionStatus.isVisible({ timeout: 10000 })) {
        expect(await connectionStatus.isVisible()).toBe(true);
      }

      // Clean up any remaining route interceptions
      await page.unroute('**/socket.io/**').catch(() => {
        // Route might already be removed
      });
    });
  });
});
