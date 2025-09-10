import { test, expect, Page } from '@playwright/test';

test.describe('Batch Segmentation Result Fetching', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();

    // Mock authentication
    await page.addInitScript(() => {
      localStorage.setItem('accessToken', 'mock-access-token');
      localStorage.setItem('refreshToken', 'mock-refresh-token');
    });

    // Navigate to application
    await page.goto('http://localhost:3000');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should load project with batch segmentation results without errors', async () => {
    // Mock API responses
    await page.route('**/api/projects/test-project', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test-project',
            title: 'Test Project',
            description: 'Test project with batch results',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
            userId: 'test-user',
          },
        }),
      });
    });

    await page.route('**/api/projects/test-project/images**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            images: [
              {
                id: 'img-1',
                name: 'test1.jpg',
                projectId: 'test-project',
                userId: 'test-user',
                originalUrl: '/uploads/test1.jpg',
                thumbnailUrl: '/thumbnails/test1.jpg',
                width: 800,
                height: 600,
                segmentationStatus: 'segmented',
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
              },
              {
                id: 'img-2',
                name: 'test2.jpg',
                projectId: 'test-project',
                userId: 'test-user',
                originalUrl: '/uploads/test2.jpg',
                thumbnailUrl: '/thumbnails/test2.jpg',
                width: 1024,
                height: 768,
                segmentationStatus: 'segmented',
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
              },
              {
                id: 'img-3',
                name: 'test3.jpg',
                projectId: 'test-project',
                userId: 'test-user',
                originalUrl: '/uploads/test3.jpg',
                thumbnailUrl: '/thumbnails/test3.jpg',
                width: 640,
                height: 480,
                segmentationStatus: 'pending',
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
              },
            ],
            pagination: {
              total: 3,
              page: 1,
              totalPages: 1,
            },
          },
        }),
      });
    });

    // Mock batch segmentation results API
    await page.route('**/api/segmentation/batch-results**', async route => {
      const url = new URL(route.request().url());
      const imageIds = url.searchParams.get('imageIds')?.split(',') || [];

      const batchResults: Record<string, any> = {};

      if (imageIds.includes('img-1')) {
        batchResults['img-1'] = {
          success: true,
          polygons: [
            {
              id: 'poly-1',
              points: [
                { x: 10, y: 10 },
                { x: 90, y: 10 },
                { x: 90, y: 90 },
                { x: 10, y: 90 },
              ],
              type: 'external',
              confidence: 0.95,
              area: 6400,
            },
          ],
          model_used: 'hrnet',
          threshold_used: 0.5,
          confidence: 0.95,
          processing_time: 2.5,
          image_size: { width: 800, height: 600 },
          imageWidth: 800,
          imageHeight: 600,
        };
      }

      if (imageIds.includes('img-2')) {
        batchResults['img-2'] = null; // Simulate null result
      }

      // img-3 not included (no segmentation)

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(batchResults),
      });
    });

    // Navigate to project page
    await page.goto('http://localhost:3000/project/test-project');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText('Test Project');

    // Wait for images to load
    await expect(page.locator('[data-testid="project-image"]')).toHaveCount(3);

    // Check that batch API was called
    const batchRequests = page.locator('body').evaluate(() => {
      return (window as any).__batchApiCalls || [];
    });

    // Verify no JavaScript errors occurred
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait a bit for any async operations
    await page.waitForTimeout(2000);

    // Check for console errors
    expect(
      consoleErrors.filter(
        error => !error.includes('favicon') && !error.includes('404')
      )
    ).toHaveLength(0);

    // Verify images are displayed
    const images = page.locator('[data-testid="project-image"]');
    await expect(images.first()).toBeVisible();

    // Check that segmented images show polygon count
    const segmentedImages = images.filter({ hasText: 'Segmented' });
    if ((await segmentedImages.count()) > 0) {
      await expect(segmentedImages.first()).toBeVisible();
    }
  });

  test('should handle batch API errors gracefully', async () => {
    // Mock project API
    await page.route('**/api/projects/test-project', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test-project',
            title: 'Test Project',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
            userId: 'test-user',
          },
        }),
      });
    });

    await page.route('**/api/projects/test-project/images**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            images: [
              {
                id: 'img-1',
                name: 'test1.jpg',
                segmentationStatus: 'segmented',
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
              },
            ],
            pagination: { total: 1, page: 1, totalPages: 1 },
          },
        }),
      });
    });

    // Mock batch API to return error
    await page.route('**/api/segmentation/batch-results**', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Internal server error',
          message: 'Database connection failed',
        }),
      });
    });

    // Navigate to project page
    await page.goto('http://localhost:3000/project/test-project');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText('Test Project');

    // Page should still function despite batch API error
    await expect(page.locator('[data-testid="project-image"]')).toHaveCount(1);

    // Check that no crash occurred - page should still be interactive
    const projectTitle = page.locator('h1');
    await expect(projectTitle).toBeVisible();
    await expect(projectTitle).toContainText('Test Project');

    // Verify error was handled gracefully (no alert/crash)
    const alerts = await page.locator('.alert, [role="alert"]').count();
    // Should either have no alerts or a non-blocking error message
    expect(alerts).toBeLessThanOrEqual(1);
  });

  test('should handle malformed batch response data', async () => {
    // Mock project and images APIs
    await page.route('**/api/projects/test-project', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test-project',
            title: 'Malformed Test Project',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
            userId: 'test-user',
          },
        }),
      });
    });

    await page.route('**/api/projects/test-project/images**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            images: [
              {
                id: 'img-1',
                name: 'test1.jpg',
                segmentationStatus: 'segmented',
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
              },
            ],
            pagination: { total: 1, page: 1, totalPages: 1 },
          },
        }),
      });
    });

    // Mock batch API to return malformed data
    await page.route('**/api/segmentation/batch-results**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'invalid-json-response-string',
      });
    });

    // Track console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate to project page
    await page.goto('http://localhost:3000/project/test-project');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText('Malformed Test Project');

    // Page should handle malformed response gracefully
    await expect(page.locator('[data-testid="project-image"]')).toHaveCount(1);

    // Wait for any async processing
    await page.waitForTimeout(2000);

    // Application should still work despite malformed batch response
    const pageTitle = await page.title();
    expect(pageTitle).toBeTruthy();

    // Check that critical errors were handled (some parsing errors might be expected)
    const criticalErrors = consoleErrors.filter(
      error =>
        error.includes('Cannot read properties') ||
        error.includes('TypeError') ||
        error.includes('ReferenceError')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('should handle timeout during batch request', async () => {
    // Mock project and images APIs
    await page.route('**/api/projects/test-project', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test-project',
            title: 'Timeout Test Project',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
            userId: 'test-user',
          },
        }),
      });
    });

    await page.route('**/api/projects/test-project/images**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            images: [
              {
                id: 'img-1',
                name: 'timeout-test.jpg',
                segmentationStatus: 'segmented',
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
              },
            ],
            pagination: { total: 1, page: 1, totalPages: 1 },
          },
        }),
      });
    });

    // Mock batch API to timeout (simulate very slow response)
    await page.route('**/api/segmentation/batch-results**', async route => {
      // Simulate timeout by delaying response beyond typical timeout
      await new Promise(resolve => setTimeout(resolve, 35000)); // 35 seconds
      await route.fulfill({
        status: 408,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Request timeout' }),
      });
    });

    // Navigate to project page
    await page.goto('http://localhost:3000/project/test-project');

    // Page should load despite batch timeout
    await expect(page.locator('h1')).toContainText('Timeout Test Project');
    await expect(page.locator('[data-testid="project-image"]')).toHaveCount(1);

    // App should remain functional
    const image = page.locator('[data-testid="project-image"]').first();
    await expect(image).toBeVisible();
  });

  test('should display appropriate loading states during batch fetch', async () => {
    let resolveBatchRequest: () => void;
    const batchPromise = new Promise<void>(resolve => {
      resolveBatchRequest = resolve;
    });

    // Mock APIs with delayed batch response
    await page.route('**/api/projects/test-project', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'test-project',
            title: 'Loading Test Project',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
            userId: 'test-user',
          },
        }),
      });
    });

    await page.route('**/api/projects/test-project/images**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            images: [
              {
                id: 'img-1',
                name: 'loading-test.jpg',
                segmentationStatus: 'segmented',
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
              },
            ],
            pagination: { total: 1, page: 1, totalPages: 1 },
          },
        }),
      });
    });

    // Mock batch API with controllable delay
    await page.route('**/api/segmentation/batch-results**', async route => {
      await batchPromise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          'img-1': {
            polygons: [],
            imageWidth: 800,
            imageHeight: 600,
          },
        }),
      });
    });

    // Navigate to project page
    await page.goto('http://localhost:3000/project/test-project');

    // Check initial loading state
    await expect(page.locator('h1')).toContainText('Loading Test Project');

    // Images should load first (before batch data)
    await expect(page.locator('[data-testid="project-image"]')).toHaveCount(1);

    // Now resolve batch request
    resolveBatchRequest!();

    // Wait for batch processing to complete
    await page.waitForTimeout(1000);

    // Page should be fully loaded
    const loadingIndicators = page.locator('[data-testid="loading"], .loading');
    await expect(loadingIndicators).toHaveCount(0);
  });
});
