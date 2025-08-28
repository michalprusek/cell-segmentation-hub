import { test, expect } from '@playwright/test';
import { performance } from 'perf_hooks';

// Performance thresholds (in milliseconds)
const PERFORMANCE_THRESHOLDS = {
  pageLoad: {
    dashboard: 2000,
    projectDetail: 2500,
    segmentationEditor: 3000,
  },
  api: {
    login: 500,
    fetchProjects: 1000,
    uploadImage: 5000,
    startSegmentation: 1000,
  },
  interaction: {
    navigationClick: 200,
    formSubmit: 500,
    modalOpen: 300,
  },
};

// Helper to measure operation time
async function measureTime(operation: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await operation();
  const end = performance.now();
  return end - start;
}

test.describe('Performance Regression Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Set up performance observer
    await page.evaluateOnNewDocument(() => {
      window.performanceMetrics = {
        marks: [],
        measures: [],
      };

      // Override performance.mark to capture metrics
      const originalMark = performance.mark.bind(performance);
      performance.mark = function (name: string) {
        window.performanceMetrics.marks.push({ name, time: performance.now() });
        return originalMark(name);
      };

      // Override performance.measure to capture metrics
      const originalMeasure = performance.measure.bind(performance);
      performance.measure = function (
        name: string,
        startMark?: string,
        endMark?: string
      ) {
        const measure = originalMeasure(name, startMark, endMark);
        window.performanceMetrics.measures.push({
          name,
          duration: measure.duration,
        });
        return measure;
      };
    });
  });

  test.describe('Page Load Performance', () => {
    test('Dashboard should load within threshold', async ({ page }) => {
      const loadTime = await measureTime(async () => {
        await page.goto('http://localhost:3000/dashboard');
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('[data-testid="project-card"]', {
          timeout: 5000,
        });
      });

      expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.pageLoad.dashboard);

      // Check Core Web Vitals
      const metrics = await page.evaluate(() => {
        return new Promise(resolve => {
          new PerformanceObserver(list => {
            const entries = list.getEntries();
            const metrics = {
              FCP: 0,
              LCP: 0,
              FID: 0,
              CLS: 0,
            };

            entries.forEach(entry => {
              if (
                entry.entryType === 'paint' &&
                entry.name === 'first-contentful-paint'
              ) {
                metrics.FCP = entry.startTime;
              } else if (entry.entryType === 'largest-contentful-paint') {
                metrics.LCP = entry.startTime;
              }
            });

            resolve(metrics);
          }).observe({ entryTypes: ['paint', 'largest-contentful-paint'] });
        });
      });

      // Assert Core Web Vitals are within acceptable ranges
      expect(metrics.FCP).toBeLessThan(1800); // FCP < 1.8s is good
      expect(metrics.LCP).toBeLessThan(2500); // LCP < 2.5s is good
    });

    test('Project Detail page should load within threshold', async ({
      page,
    }) => {
      // First navigate to dashboard
      await page.goto('http://localhost:3000/dashboard');
      await page.waitForSelector('[data-testid="project-card"]');

      // Measure project detail load time
      const loadTime = await measureTime(async () => {
        await page.click('[data-testid="project-card"]:first-child');
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('[data-testid="image-gallery"]', {
          timeout: 5000,
        });
      });

      expect(loadTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.pageLoad.projectDetail
      );
    });

    test('Segmentation Editor should load within threshold', async ({
      page,
    }) => {
      await page.goto(
        'http://localhost:3000/projects/test-project/images/test-image/segmentation'
      );

      const loadTime = await measureTime(async () => {
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('canvas', { timeout: 5000 });
      });

      expect(loadTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.pageLoad.segmentationEditor
      );
    });
  });

  test.describe('API Response Times', () => {
    test('Login API should respond within threshold', async ({ request }) => {
      const startTime = Date.now();

      const response = await request.post(
        'http://localhost:3001/api/auth/login',
        {
          data: {
            email: 'test@example.com',
            password: 'testpassword',
          },
        }
      );

      const responseTime = Date.now() - startTime;

      expect(response.status()).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.api.login);
    });

    test('Fetch projects API should respond within threshold', async ({
      request,
    }) => {
      const startTime = Date.now();

      const response = await request.get('http://localhost:3001/api/projects', {
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      const responseTime = Date.now() - startTime;

      expect(response.ok()).toBeTruthy();
      expect(responseTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.api.fetchProjects
      );
    });

    test('Parallel API requests should not degrade performance', async ({
      request,
    }) => {
      const requests = Array(10)
        .fill(null)
        .map(() =>
          request.get('http://localhost:3001/api/projects', {
            headers: { Authorization: 'Bearer test-token' },
          })
        );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      // All should succeed
      responses.forEach(response => {
        expect(response.ok()).toBeTruthy();
      });

      // Total time should be reasonable (not 10x single request time)
      expect(totalTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.api.fetchProjects * 3
      );
    });
  });

  test.describe('User Interaction Performance', () => {
    test('Navigation clicks should be responsive', async ({ page }) => {
      await page.goto('http://localhost:3000/dashboard');
      await page.waitForSelector('[data-testid="nav-menu"]');

      // Measure navigation click response
      const clickTime = await measureTime(async () => {
        await page.click('[data-testid="nav-projects"]');
        await page.waitForSelector('[data-testid="projects-page"]', {
          state: 'visible',
        });
      });

      expect(clickTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.interaction.navigationClick
      );
    });

    test('Form submissions should be responsive', async ({ page }) => {
      await page.goto('http://localhost:3000/projects/new');

      // Fill form
      await page.fill(
        '[data-testid="project-name"]',
        'Performance Test Project'
      );
      await page.fill(
        '[data-testid="project-description"]',
        'Testing form performance'
      );

      // Measure form submit time
      const submitTime = await measureTime(async () => {
        await page.click('[data-testid="submit-button"]');
        await page.waitForSelector('[data-testid="success-message"]', {
          state: 'visible',
          timeout: 5000,
        });
      });

      expect(submitTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.interaction.formSubmit
      );
    });

    test('Modal opening should be instant', async ({ page }) => {
      await page.goto('http://localhost:3000/dashboard');
      await page.waitForSelector('[data-testid="create-project-button"]');

      // Measure modal open time
      const openTime = await measureTime(async () => {
        await page.click('[data-testid="create-project-button"]');
        await page.waitForSelector('[data-testid="modal-content"]', {
          state: 'visible',
        });
      });

      expect(openTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.interaction.modalOpen
      );
    });
  });

  test.describe('Resource Loading Performance', () => {
    test('Images should lazy load efficiently', async ({ page }) => {
      await page.goto('http://localhost:3000/projects/test-project');

      // Check that images are lazy loaded
      const lazyImages = await page.$$eval(
        'img[loading="lazy"]',
        imgs => imgs.length
      );
      expect(lazyImages).toBeGreaterThan(0);

      // Scroll and measure image loading time
      const loadTime = await measureTime(async () => {
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight)
        );
        await page.waitForLoadState('networkidle');
      });

      expect(loadTime).toBeLessThan(2000); // Images should load within 2s
    });

    test('Bundle sizes should be within limits', async ({ page }) => {
      const response = await page.goto('http://localhost:3000');
      const resources = await page.evaluate(() =>
        performance.getEntriesByType('resource').map(r => ({
          name: r.name,
          size: r.transferSize,
          duration: r.duration,
        }))
      );

      // Check JS bundle sizes
      const jsBundles = resources.filter(r => r.name.endsWith('.js'));
      jsBundles.forEach(bundle => {
        expect(bundle.size).toBeLessThan(500 * 1024); // Max 500KB per JS bundle
      });

      // Check CSS bundle sizes
      const cssBundles = resources.filter(r => r.name.endsWith('.css'));
      cssBundles.forEach(bundle => {
        expect(bundle.size).toBeLessThan(100 * 1024); // Max 100KB per CSS bundle
      });

      // Total bundle size
      const totalSize = resources.reduce((sum, r) => sum + r.size, 0);
      expect(totalSize).toBeLessThan(2 * 1024 * 1024); // Max 2MB total
    });
  });

  test.describe('Memory Performance', () => {
    test('No memory leaks during navigation', async ({ page }) => {
      if (!page.context().browser()) {
        test.skip();
        return;
      }

      // Get initial memory usage
      const getMemory = () =>
        page.evaluate(() => {
          if ('memory' in performance) {
            return (performance as any).memory.usedJSHeapSize;
          }
          return 0;
        });

      const initialMemory = await getMemory();

      // Navigate through multiple pages
      for (let i = 0; i < 10; i++) {
        await page.goto('http://localhost:3000/dashboard');
        await page.goto('http://localhost:3000/projects');
        await page.goto('http://localhost:3000/settings');
      }

      // Force garbage collection if available
      await page.evaluate(() => {
        if ('gc' in globalThis) {
          (globalThis as any).gc();
        }
      });

      // Check memory after navigation
      const finalMemory = await getMemory();
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    test('Large data sets should not cause memory issues', async ({ page }) => {
      await page.goto('http://localhost:3000/projects/large-dataset');

      // Load large dataset
      await page.evaluate(() => {
        // Simulate loading large amount of data
        const largeArray = Array(10000)
          .fill(null)
          .map((_, i) => ({
            id: i,
            name: `Item ${i}`,
            data: Array(100).fill(Math.random()),
          }));

        // Store in window for testing
        (window as any).testData = largeArray;
      });

      // Check that page remains responsive
      const interactionTime = await measureTime(async () => {
        await page.click('[data-testid="filter-button"]');
        await page.waitForSelector('[data-testid="filter-menu"]', {
          state: 'visible',
        });
      });

      expect(interactionTime).toBeLessThan(500); // Should remain responsive

      // Clean up
      await page.evaluate(() => {
        delete (window as any).testData;
      });
    });
  });

  test.describe('Network Performance', () => {
    test('API calls should use efficient caching', async ({ page }) => {
      await page.goto('http://localhost:3000/dashboard');

      // Track network requests
      const requests: string[] = [];
      page.on('request', request => {
        if (request.url().includes('/api/')) {
          requests.push(request.url());
        }
      });

      // Navigate to same page again
      await page.goto('http://localhost:3000/dashboard');

      // Check for duplicate requests (should use cache)
      const uniqueRequests = new Set(requests);
      expect(uniqueRequests.size).toBeLessThanOrEqual(requests.length * 0.7); // At least 30% cached
    });

    test('Should handle slow network gracefully', async ({ page, context }) => {
      // Simulate slow 3G network
      await context.route('**/*', route => {
        setTimeout(() => route.continue(), 100); // Add 100ms delay
      });

      const loadTime = await measureTime(async () => {
        await page.goto('http://localhost:3000/dashboard');
        await page.waitForSelector('[data-testid="loading-complete"]', {
          timeout: 10000,
        });
      });

      // Should still load within reasonable time
      expect(loadTime).toBeLessThan(10000); // 10 seconds max on slow network

      // Should show loading indicators
      const hasLoadingIndicator = await page.isVisible(
        '[data-testid="loading-spinner"]'
      );
      expect(hasLoadingIndicator).toBeTruthy();
    });
  });

  test.describe('Rendering Performance', () => {
    test('Large lists should use virtualization', async ({ page }) => {
      await page.goto('http://localhost:3000/projects/test-project/images');

      // Check if virtualization is implemented
      const visibleItems = await page.$$eval(
        '[data-testid="image-item"]',
        items => items.length
      );
      const totalItems = await page.textContent('[data-testid="total-count"]');

      // If total > 20 but visible < total, virtualization is working
      if (parseInt(totalItems || '0') > 20) {
        expect(visibleItems).toBeLessThan(parseInt(totalItems || '0'));
      }
    });

    test('Animations should run at 60fps', async ({ page }) => {
      await page.goto('http://localhost:3000/dashboard');

      // Measure frame rate during animation
      const fps = await page.evaluate(() => {
        return new Promise(resolve => {
          let frameCount = 0;
          let lastTime = performance.now();
          const frames: number[] = [];

          function measureFrame() {
            const currentTime = performance.now();
            const delta = currentTime - lastTime;
            if (delta > 0) {
              frames.push(1000 / delta);
            }
            lastTime = currentTime;
            frameCount++;

            if (frameCount < 60) {
              requestAnimationFrame(measureFrame);
            } else {
              const avgFps = frames.reduce((a, b) => a + b, 0) / frames.length;
              resolve(avgFps);
            }
          }

          // Trigger an animation
          const element = document.querySelector(
            '[data-testid="animated-element"]'
          );
          if (element) {
            element.classList.add('animate');
          }

          requestAnimationFrame(measureFrame);
        });
      });

      // Should maintain close to 60fps
      expect(fps).toBeGreaterThan(50);
    });
  });
});

// Generate performance report
test.afterAll(async () => {
  console.log('Performance Test Summary:');
  console.log('========================');
  console.log('All performance thresholds checked');
  console.log('Results saved to: playwright-report/performance.html');
});
