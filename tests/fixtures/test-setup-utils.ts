/**
 * Test Setup Utilities for E2E Tests
 * Provides common setup, teardown, and utility functions
 */

import { Page, Browser, BrowserContext } from '@playwright/test';
import { TestDataManager, TestUser, TestProject } from './test-data-manager';
import path from 'path';
import fs from 'fs';

export interface TestEnvironment {
  page: Page;
  context: BrowserContext;
  user?: TestUser;
  project?: TestProject;
  dataManager: TestDataManager;
}

export class TestSetupUtils {
  private static dataManager = TestDataManager.getInstance();

  /**
   * Setup test environment with authenticated user
   */
  static async setupAuthenticatedTest(
    page: Page,
    scenario = 'default'
  ): Promise<TestEnvironment> {
    const scenarioData = this.dataManager.generateScenarioData(scenario);

    // Register and login user
    await page.goto('/');
    await page.getByRole('link', { name: /sign up/i }).click();

    await page.getByLabel(/email/i).fill(scenarioData.user.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(scenarioData.user.password);
    await page.getByLabel(/confirm password/i).fill(scenarioData.user.password);

    const termsCheckbox = page.getByRole('checkbox', { name: /terms/i });
    if (await termsCheckbox.isVisible()) {
      await termsCheckbox.check();
    }

    await page.getByRole('button', { name: /sign up/i }).click();

    // Wait for dashboard
    await page.waitForURL('/dashboard', { timeout: 15000 });

    return {
      page,
      context: page.context(),
      user: scenarioData.user,
      project: scenarioData.projects[0],
      dataManager: this.dataManager,
    };
  }

  /**
   * Setup test project with images
   */
  static async setupProjectWithImages(
    env: TestEnvironment,
    imageCount = 3,
    autoSegment = false
  ): Promise<{ projectId: string; imageIds: string[] }> {
    const { page, project } = env;

    // Create project
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(project!.name);
    await page.getByLabel(/description/i).fill(project!.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    await page
      .getByText(/project.*created|success/i)
      .waitFor({ state: 'visible', timeout: 10000 });

    // Navigate to project
    await page.getByText(project!.name).click();

    // Upload images
    const imagePaths = this.getTestImagePaths(imageCount);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(imagePaths);

    // Wait for upload completion
    await page
      .getByText(/upload.*complete|success/i)
      .waitFor({ state: 'visible', timeout: 30000 });

    // Auto-segment if requested
    if (autoSegment) {
      const segmentButton = page
        .getByRole('button', { name: /segment.*all|batch.*segment/i })
        .first();
      if (await segmentButton.isVisible()) {
        await segmentButton.click();
        await page.getByRole('button', { name: /start|process/i }).click();
        await page
          .getByText(/complete|finished/i)
          .waitFor({ state: 'visible', timeout: 120000 });
      }
    }

    // Extract project ID from URL
    const currentUrl = page.url();
    const projectIdMatch = currentUrl.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : 'unknown';

    // Generate mock image IDs
    const imageIds = Array.from(
      { length: imageCount },
      (_, i) => `image-${i + 1}`
    );

    return { projectId, imageIds };
  }

  /**
   * Get test image paths
   */
  static getTestImagePaths(count = 3): string[] {
    const testImagesDir = path.join(__dirname, '../fixtures');
    const imageNames = [
      'test-image.jpg',
      'test-image-2.jpg',
      'test-image-3.jpg',
      'test-image-4.jpg',
      'test-image-5.jpg',
    ];

    return imageNames
      .slice(0, count)
      .map(name => path.join(testImagesDir, name));
  }

  /**
   * Create test images if they don't exist
   */
  static async ensureTestImages(): Promise<void> {
    const testImagesDir = path.join(__dirname, '../fixtures');
    const requiredImages = [
      'test-image.jpg',
      'test-image-2.jpg',
      'test-image-3.jpg',
      'test-image-4.jpg',
      'test-image-5.jpg',
    ];

    // Check if images exist
    const missingImages = requiredImages.filter(
      image => !fs.existsSync(path.join(testImagesDir, image))
    );

    if (missingImages.length > 0) {
      // Creating missing test images

      // Create simple test images using Canvas API if available
      try {
        const { createCanvas } = await import('canvas');

        for (const imageName of missingImages) {
          const canvas = createCanvas(512, 512);
          const ctx = canvas.getContext('2d');

          // Create a simple gradient background
          const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
          gradient.addColorStop(0, '#ffffff');
          gradient.addColorStop(1, '#cccccc');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 512, 512);

          // Add some random "cells" for realism
          for (let i = 0; i < 20; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const radius = 10 + Math.random() * 30;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = `rgba(${Math.floor(Math.random() * 100)}, ${Math.floor(Math.random() * 100)}, ${Math.floor(Math.random() * 100)}, 0.7)`;
            ctx.fill();
          }

          // Save image
          const buffer = canvas.toBuffer('image/jpeg', { quality: 0.8 });
          fs.writeFileSync(path.join(testImagesDir, imageName), buffer);
        }
      } catch (error) {
        console.warn('Canvas not available, creating placeholder images');

        // Create minimal placeholder files
        for (const imageName of missingImages) {
          const placeholder = Buffer.from('fake-image-data-for-testing');
          fs.writeFileSync(path.join(testImagesDir, imageName), placeholder);
        }
      }
    }
  }

  /**
   * Setup mock API responses
   */
  static async setupMockAPI(
    page: Page,
    config: {
      networkDelay?: number;
      errorRate?: number;
      responses?: Record<string, any>;
    }
  ): Promise<void> {
    const { networkDelay = 0, errorRate = 0, responses = {} } = config;

    await page.route('**/api/**', async route => {
      // Add network delay
      if (networkDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, networkDelay));
      }

      // Simulate errors
      if (Math.random() < errorRate) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Mock server error' }),
        });
        return;
      }

      // Custom responses
      const url = route.request().url();
      const endpoint = url.split('/api/')[1];

      if (responses[endpoint]) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(responses[endpoint]),
        });
        return;
      }

      // Continue with normal request
      await route.continue();
    });
  }

  /**
   * Wait for all network requests to complete
   */
  static async waitForNetworkIdle(page: Page, timeout = 10000): Promise<void> {
    let requestCount = 0;
    let responseCount = 0;

    const requestHandler = () => {
      requestCount++;
      // Update window counter
      page
        .evaluate(() => {
          (window as any)._testRequestCount =
            ((window as any)._testRequestCount || 0) + 1;
        })
        .catch(() => {
          /* ignore if page is closed */
        });
    };
    const responseHandler = () => {
      responseCount++;
      // Update window counter
      page
        .evaluate(() => {
          (window as any)._testResponseCount =
            ((window as any)._testResponseCount || 0) + 1;
        })
        .catch(() => {
          /* ignore if page is closed */
        });
    };

    // Initialize window counters
    await page.evaluate(() => {
      (window as any)._testRequestCount = 0;
      (window as any)._testResponseCount = 0;
    });

    page.on('request', requestHandler);
    page.on('response', responseHandler);

    try {
      // Wait for network to be idle (no pending requests)
      await page.waitForFunction(
        () => {
          const pending =
            ((window as any)._testRequestCount || 0) -
            ((window as any)._testResponseCount || 0);
          return pending <= 0;
        },
        { timeout }
      );
    } catch (error) {
      // Fallback: just wait a bit
      await page.waitForTimeout(2000);
    } finally {
      page.off('request', requestHandler);
      page.off('response', responseHandler);
    }
  }

  /**
   * Capture page performance metrics
   */
  static async capturePerformanceMetrics(page: Page): Promise<{
    loadTime: number;
    domContentLoaded: number;
    firstContentfulPaint: number;
    memoryUsage?: number;
  }> {
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        'navigation'
      )[0] as PerformanceNavigationTiming;
      const paint = performance.getEntriesByType('paint');
      const fcp = paint.find(entry => entry.name === 'first-contentful-paint');

      return {
        loadTime: navigation.loadEventEnd - navigation.navigationStart,
        domContentLoaded:
          navigation.domContentLoadedEventEnd - navigation.navigationStart,
        firstContentfulPaint: fcp?.startTime || 0,
        memoryUsage: (performance as any).memory?.usedJSHeapSize || undefined,
      };
    });

    return metrics;
  }

  /**
   * Setup accessibility testing
   */
  static async setupAccessibilityTesting(page: Page): Promise<void> {
    // Inject axe-core for accessibility testing
    try {
      await page.addScriptTag({
        url: 'https://unpkg.com/axe-core@4.7.0/axe.min.js',
      });
    } catch (error) {
      console.warn('Failed to load axe-core, accessibility tests may not work');
    }
  }

  /**
   * Take screenshot with timestamp
   */
  static async takeTimestampedScreenshot(
    page: Page,
    name: string,
    options?: {
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
    }
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.png`;
    const screenshotPath = path.join(__dirname, '../screenshots', filename);

    // Ensure screenshots directory exists
    const screenshotsDir = path.dirname(screenshotPath);
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    await page.screenshot({
      path: screenshotPath,
      fullPage: options?.fullPage,
      clip: options?.clip,
    });

    return screenshotPath;
  }

  /**
   * Verify all services are healthy before testing
   */
  static async verifyServicesHealthy(): Promise<void> {
    const services = [
      { name: 'Frontend', url: 'http://localhost:3000' },
      { name: 'Backend API', url: 'http://localhost:3001/health' },
      { name: 'ML Service', url: 'http://localhost:8000/health' },
    ];

    for (const service of services) {
      try {
        const response = await fetch(service.url, {
          method: 'GET',
          timeout: 5000,
        });

        if (!response.ok) {
          throw new Error(`${service.name} returned ${response.status}`);
        }
      } catch (error) {
        throw new Error(
          `${service.name} health check failed: ${error.message}`
        );
      }
    }
  }

  /**
   * Setup database state for testing
   */
  static async setupDatabaseState(scenario: string): Promise<void> {
    // In a real implementation, this would set up database state
    // For now, we'll just log the scenario
    // Setting up database state for scenario
  }

  /**
   * Clean up test data and state
   */
  static async cleanupTestData(): Promise<void> {
    await this.dataManager.cleanup();
  }

  /**
   * Get browser info for debugging
   */
  static async getBrowserInfo(page: Page): Promise<{
    userAgent: string;
    viewport: { width: number; height: number } | null;
    devicePixelRatio: number;
    timezone: string;
  }> {
    const info = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      devicePixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));

    return info;
  }

  /**
   * Wait for element with custom conditions
   */
  static async waitForElementWithCondition(
    page: Page,
    selector: string,
    condition: 'visible' | 'hidden' | 'stable' | 'clickable',
    timeout = 10000
  ): Promise<void> {
    const element = page.locator(selector);

    switch (condition) {
      case 'visible':
        await element.waitFor({ state: 'visible', timeout });
        break;
      case 'hidden':
        await element.waitFor({ state: 'hidden', timeout });
        break;
      case 'stable': {
        // Wait for element to be stable (not moving)
        await element.waitFor({ state: 'visible', timeout });
        let previousBox = await element.boundingBox();
        await page.waitForTimeout(100);

        for (let i = 0; i < 10; i++) {
          const currentBox = await element.boundingBox();
          if (
            previousBox &&
            currentBox &&
            previousBox.x === currentBox.x &&
            previousBox.y === currentBox.y
          ) {
            break;
          }
          previousBox = currentBox;
          await page.waitForTimeout(100);
        }
        break;
      }
      case 'clickable':
        await element.waitFor({ state: 'visible', timeout });
        await page.waitForFunction(
          sel => {
            const el = document.querySelector(sel);
            return (
              el &&
              !el.hasAttribute('disabled') &&
              getComputedStyle(el).pointerEvents !== 'none'
            );
          },
          selector,
          { timeout }
        );
        break;
    }
  }

  /**
   * Retry operation with exponential backoff
   */
  static async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        // Attempt failed, retrying...
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // This should never be reached due to the loop logic above
  }

  /**
   * Monitor console errors during test
   */
  static async monitorConsoleErrors(page: Page): Promise<{
    startMonitoring: () => void;
    stopMonitoring: () => string[];
  }> {
    const errors: string[] = [];

    const errorHandler = (msg: any) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    };

    return {
      startMonitoring: () => {
        page.on('console', errorHandler);
      },
      stopMonitoring: () => {
        page.off('console', errorHandler);
        return [...errors];
      },
    };
  }

  /**
   * Create test report data
   */
  static createTestReport(
    testName: string,
    metrics: any,
    screenshots: string[]
  ): {
    testName: string;
    timestamp: string;
    metrics: any;
    screenshots: string[];
    duration: number;
  } {
    return {
      testName,
      timestamp: new Date().toISOString(),
      metrics,
      screenshots,
      duration: Date.now(),
    };
  }
}

// Export commonly used functions
export const {
  setupAuthenticatedTest,
  setupProjectWithImages,
  waitForNetworkIdle,
  capturePerformanceMetrics,
  takeTimestampedScreenshot,
  cleanupTestData,
  retryOperation,
  verifyServicesHealthy,
} = TestSetupUtils;
