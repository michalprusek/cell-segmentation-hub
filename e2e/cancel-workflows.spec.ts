/**
 * End-to-End Tests for Universal Cancel Functionality
 * Tests complete user workflows for upload, segmentation, and export cancellation
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';

// Test configuration
const TEST_CONFIG = {
  baseURL: 'http://localhost:3000',
  testUser: {
    email: 'test@example.com',
    password: 'testpassword123',
  },
  timeouts: {
    upload: 10000,
    segmentation: 30000,
    export: 15000,
    navigation: 5000,
  },
  files: {
    singleImage: 'test-images/cell-001.jpg',
    batchImages: [
      'test-images/cell-001.jpg',
      'test-images/cell-002.jpg',
      'test-images/cell-003.jpg',
    ],
    largeImage: 'test-images/large-cell-10mb.tiff',
  },
};

// Test utilities
class CancelTestHelpers {
  constructor(private page: Page) {}

  async login() {
    await this.page.goto('/login');
    await this.page.fill(
      '[data-testid="email-input"]',
      TEST_CONFIG.testUser.email
    );
    await this.page.fill(
      '[data-testid="password-input"]',
      TEST_CONFIG.testUser.password
    );
    await this.page.click('[data-testid="login-button"]');
    await this.page.waitForURL('/dashboard');
  }

  async createTestProject(name: string = 'Cancel Test Project') {
    await this.page.goto('/dashboard');
    await this.page.click('[data-testid="new-project-button"]');
    await this.page.fill('[data-testid="project-name-input"]', name);
    await this.page.click('[data-testid="create-project-button"]');
    await this.page.waitForURL(/\/project\/[^/]+$/);

    // Return project ID from URL
    const url = this.page.url();
    return url.split('/').pop();
  }

  async uploadFiles(files: string[]) {
    const fileInputs = files.map(file =>
      path.resolve(__dirname, '../test-fixtures', file)
    );
    await this.page.setInputFiles('[data-testid="file-input"]', fileInputs);
    await this.page.click('[data-testid="upload-button"]');
  }

  async waitForUploadProgress() {
    await this.page.waitForSelector('[data-testid="upload-progress"]', {
      timeout: TEST_CONFIG.timeouts.upload,
    });
  }

  async waitForSegmentationProgress() {
    await this.page.waitForSelector('[data-testid="segmentation-progress"]', {
      timeout: TEST_CONFIG.timeouts.segmentation,
    });
  }

  async waitForExportProgress() {
    await this.page.waitForSelector('[data-testid="export-progress"]', {
      timeout: TEST_CONFIG.timeouts.export,
    });
  }

  async clickCancelButton(operationType: 'upload' | 'segmentation' | 'export') {
    const selector = `[data-testid="cancel-${operationType}-button"]`;
    await this.page.click(selector);
  }

  async waitForCancellation(
    operationType: 'upload' | 'segmentation' | 'export'
  ) {
    const selector = `[data-testid="${operationType}-cancelled"]`;
    await this.page.waitForSelector(selector, { timeout: 5000 });
  }

  async verifyOperationCancelled(
    operationType: 'upload' | 'segmentation' | 'export'
  ) {
    const statusSelector = `[data-testid="${operationType}-status"]`;
    const status = await this.page.textContent(statusSelector);
    expect(status).toBe('cancelled');
  }

  async verifyNoMemoryLeaks() {
    // Check for memory leaks by evaluating JavaScript memory usage
    const memoryInfo = await this.page.evaluate(() => {
      if ('memory' in performance) {
        return {
          usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
          totalJSHeapSize: (performance as any).memory.totalJSHeapSize,
        };
      }
      return null;
    });

    if (memoryInfo) {
      const memoryUsagePercent =
        (memoryInfo.usedJSHeapSize / memoryInfo.totalJSHeapSize) * 100;
      expect(memoryUsagePercent).toBeLessThan(85); // Should not exceed 85% memory usage
    }
  }
}

test.describe('Cancel Workflows E2E Tests', () => {
  let helpers: CancelTestHelpers;

  test.beforeEach(async ({ page: _page }) => {
    helpers = new CancelTestHelpers(page);
    await helpers.login();
  });

  test.describe('Upload Cancellation', () => {
    test('should cancel single file upload', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject('Upload Cancel Test');

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Verify cancel button is visible
      await expect(
        page.locator('[data-testid="cancel-upload-button"]')
      ).toBeVisible();

      // Cancel upload
      await helpers.clickCancelButton('upload');

      // Wait for cancellation
      await helpers.waitForCancellation('upload');

      // Verify cancellation
      await helpers.verifyOperationCancelled('upload');

      // Verify upload button is available again
      await expect(page.locator('[data-testid="upload-button"]')).toBeVisible();
    });

    test('should cancel multiple file upload', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject(
        'Batch Upload Cancel Test'
      );

      // Start batch upload
      await helpers.uploadFiles(TEST_CONFIG.files.batchImages);
      await helpers.waitForUploadProgress();

      // Verify progress is shown for multiple files
      const fileItems = page.locator('[data-testid^="file-item-"]');
      await expect(fileItems).toHaveCount(TEST_CONFIG.files.batchImages.length);

      // Cancel all uploads
      await helpers.clickCancelButton('upload');

      // Verify all files are cancelled
      for (let i = 0; i < TEST_CONFIG.files.batchImages.length; i++) {
        await expect(
          page.locator(`[data-testid="file-status-${i}"]`)
        ).toHaveText('cancelled');
      }
    });

    test('should cancel large file upload', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject(
        'Large File Cancel Test'
      );

      // Start large file upload
      await helpers.uploadFiles([TEST_CONFIG.files.largeImage]);
      await helpers.waitForUploadProgress();

      // Verify progress tracking
      const progressBar = page.locator('[data-testid="upload-progress-bar"]');
      await expect(progressBar).toBeVisible();

      // Cancel upload after some progress
      await page.waitForTimeout(2000); // Let it upload for 2 seconds
      await helpers.clickCancelButton('upload');

      // Verify cancellation happened quickly
      const cancelStart = Date.now();
      await helpers.waitForCancellation('upload');
      const cancelDuration = Date.now() - cancelStart;

      expect(cancelDuration).toBeLessThan(1000); // Should cancel within 1 second
    });

    test('should handle upload cancellation with network interruption', async ({
      page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'Network Interruption Test'
      );

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Simulate network interruption
      await page.context().setOffline(true);

      // Try to cancel
      await helpers.clickCancelButton('upload');

      // Should still cancel locally
      await helpers.waitForCancellation('upload');

      // Restore network
      await page.context().setOffline(false);

      // Verify operation is still cancelled
      await helpers.verifyOperationCancelled('upload');
    });
  });

  test.describe('Segmentation Cancellation', () => {
    test('should cancel single image segmentation', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject(
        'Segmentation Cancel Test'
      );

      // Upload image first
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await page.waitForSelector('[data-testid="upload-complete"]');

      // Start segmentation
      await page.click('[data-testid="segment-image-button"]');
      await helpers.waitForSegmentationProgress();

      // Verify cancel button is visible
      await expect(
        page.locator('[data-testid="cancel-segmentation-button"]')
      ).toBeVisible();

      // Cancel segmentation
      await helpers.clickCancelButton('segmentation');

      // Wait for cancellation
      await helpers.waitForCancellation('segmentation');

      // Verify segmentation is cancelled
      await helpers.verifyOperationCancelled('segmentation');

      // Verify segment button is available again
      await expect(
        page.locator('[data-testid="segment-image-button"]')
      ).toBeVisible();
    });

    test('should cancel batch segmentation', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject(
        'Batch Segmentation Cancel Test'
      );

      // Upload multiple images
      await helpers.uploadFiles(TEST_CONFIG.files.batchImages);
      await page.waitForSelector('[data-testid="upload-complete"]');

      // Start batch segmentation
      await page.click('[data-testid="segment-all-button"]');
      await helpers.waitForSegmentationProgress();

      // Verify queue stats are displayed
      await expect(page.locator('[data-testid="queue-stats"]')).toBeVisible();

      // Verify progress tracking
      const queuedCount = page.locator('[data-testid="queued-count"]');
      const processingCount = page.locator('[data-testid="processing-count"]');

      await expect(queuedCount).toBeVisible();
      await expect(processingCount).toBeVisible();

      // Cancel batch
      await helpers.clickCancelButton('segmentation');

      // Verify batch cancellation
      await page.waitForSelector('[data-testid="batch-cancelled"]');

      // Verify queue is cleared
      await expect(queuedCount).toHaveText('Queued: 0');
      await expect(processingCount).toHaveText('Processing: 0');

      // Verify segment all button is available again
      await expect(
        page.locator('[data-testid="segment-all-button"]')
      ).toBeVisible();
    });

    test('should handle partial batch cancellation', async ({
      page: _page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'Partial Batch Cancel Test'
      );

      // Upload images
      await helpers.uploadFiles(TEST_CONFIG.files.batchImages);
      await page.waitForSelector('[data-testid="upload-complete"]');

      // Start batch segmentation
      await page.click('[data-testid="segment-all-button"]');
      await helpers.waitForSegmentationProgress();

      // Wait for some processing to complete
      await page.waitForTimeout(5000);

      // Cancel remaining jobs
      await helpers.clickCancelButton('segmentation');

      // Verify partial completion message
      await expect(
        page.locator('[data-testid="partial-cancellation-notice"]')
      ).toBeVisible();

      // Verify completed jobs are preserved
      const completedImages = page.locator(
        '[data-testid="completed-segmentation"]'
      );
      await expect(completedImages.count()).toBeGreaterThan(0);
    });

    test('should cancel high-volume batch segmentation', async ({
      page: _page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'High Volume Cancel Test'
      );

      // Mock high volume batch (simulate 1000 images)
      await page.evaluate(() => {
        // Simulate large batch upload completion
        window.postMessage(
          {
            type: 'MOCK_LARGE_BATCH_UPLOADED',
            data: { imageCount: 1000 },
          },
          '*'
        );
      });

      // Wait for mock batch to be processed
      await page.waitForSelector('[data-testid="large-batch-ready"]');

      // Start high volume segmentation
      await page.click('[data-testid="segment-all-button"]');
      await helpers.waitForSegmentationProgress();

      // Verify high volume indicators
      await expect(
        page.locator('[data-testid="high-volume-notice"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="estimated-time"]')
      ).toBeVisible();

      // Cancel batch
      const cancelStart = Date.now();
      await helpers.clickCancelButton('segmentation');

      // Verify cancellation completes within reasonable time even for large batch
      await helpers.waitForCancellation('segmentation');
      const cancelDuration = Date.now() - cancelStart;

      expect(cancelDuration).toBeLessThan(5000); // Should cancel within 5 seconds
    });
  });

  test.describe('Export Cancellation', () => {
    test('should cancel COCO format export', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject('Export Cancel Test');

      // Setup completed segmentation data
      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'MOCK_SEGMENTATION_COMPLETE',
            data: { imageCount: 5, polygonCount: 150 },
          },
          '*'
        );
      });

      // Navigate to export page
      await page.click('[data-testid="export-tab"]');

      // Start COCO export
      await page.click('[data-testid="export-coco-button"]');
      await helpers.waitForExportProgress();

      // Verify export progress
      await expect(
        page.locator('[data-testid="export-progress-bar"]')
      ).toBeVisible();
      await expect(page.locator('[data-testid="export-status"]')).toHaveText(
        'Generating COCO format...'
      );

      // Cancel export
      await helpers.clickCancelButton('export');

      // Verify cancellation
      await helpers.waitForCancellation('export');
      await helpers.verifyOperationCancelled('export');

      // Verify export button is available again
      await expect(
        page.locator('[data-testid="export-coco-button"]')
      ).toBeVisible();
    });

    test('should cancel Excel export', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject(
        'Excel Export Cancel Test'
      );

      // Setup completed segmentation data
      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'MOCK_SEGMENTATION_COMPLETE',
            data: { imageCount: 10, polygonCount: 300 },
          },
          '*'
        );
      });

      // Navigate to export page
      await page.click('[data-testid="export-tab"]');

      // Configure Excel export options
      await page.check('[data-testid="include-area"]');
      await page.check('[data-testid="include-perimeter"]');
      await page.check('[data-testid="include-circularity"]');

      // Start Excel export
      await page.click('[data-testid="export-excel-button"]');
      await helpers.waitForExportProgress();

      // Verify metric calculation progress
      await expect(
        page.locator('[data-testid="calculating-metrics"]')
      ).toBeVisible();

      // Cancel export
      await helpers.clickCancelButton('export');

      // Verify cancellation
      await helpers.waitForCancellation('export');

      // Verify configuration is preserved
      await expect(page.locator('[data-testid="include-area"]')).toBeChecked();
    });

    test('should cancel large dataset export', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject(
        'Large Export Cancel Test'
      );

      // Setup large dataset
      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'MOCK_LARGE_DATASET',
            data: {
              imageCount: 5000,
              polygonCount: 125000,
              estimatedSize: '2.5GB',
            },
          },
          '*'
        );
      });

      // Navigate to export page
      await page.click('[data-testid="export-tab"]');

      // Verify large dataset warning
      await expect(
        page.locator('[data-testid="large-dataset-warning"]')
      ).toBeVisible();

      // Start large export
      await page.click('[data-testid="export-coco-button"]');
      await helpers.waitForExportProgress();

      // Verify resource usage indicators
      await expect(
        page.locator('[data-testid="disk-space-usage"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="estimated-time"]')
      ).toBeVisible();

      // Cancel export
      await helpers.clickCancelButton('export');

      // Verify cancellation and cleanup
      await helpers.waitForCancellation('export');

      // Verify cleanup message
      await expect(
        page.locator('[data-testid="cleanup-progress"]')
      ).toBeVisible();
      await page.waitForSelector('[data-testid="cleanup-complete"]');
    });

    test('should handle concurrent export cancellations', async ({
      page: _page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'Concurrent Export Cancel Test'
      );

      // Setup data for multiple export types
      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'MOCK_SEGMENTATION_COMPLETE',
            data: { imageCount: 20, polygonCount: 500 },
          },
          '*'
        );
      });

      // Navigate to export page
      await page.click('[data-testid="export-tab"]');

      // Start multiple exports
      await page.click('[data-testid="export-coco-button"]');
      await page.waitForTimeout(1000); // Small delay between starts

      await page.click('[data-testid="export-excel-button"]');
      await helpers.waitForExportProgress();

      // Verify multiple exports are tracked
      await expect(page.locator('[data-testid="active-exports"]')).toHaveCount(
        2
      );

      // Cancel all exports
      await page.click('[data-testid="cancel-all-exports-button"]');

      // Verify all exports are cancelled
      await page.waitForSelector('[data-testid="all-exports-cancelled"]');
    });
  });

  test.describe('Cross-Operation Cancellation', () => {
    test('should handle concurrent upload and segmentation cancellation', async ({
      page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'Concurrent Operations Test'
      );

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Start another operation while upload is in progress
      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'START_BACKGROUND_SEGMENTATION',
            data: { imageId: 'background-image' },
          },
          '*'
        );
      });

      // Verify both operations are active
      await expect(
        page.locator('[data-testid="active-operations"]')
      ).toHaveCount(2);

      // Cancel all operations
      await page.click('[data-testid="cancel-all-operations-button"]');

      // Verify all operations are cancelled
      await page.waitForSelector('[data-testid="all-operations-cancelled"]');
    });

    test('should maintain operation isolation during cancellation', async ({
      page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'Operation Isolation Test'
      );

      // Start multiple operations
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Start segmentation in another tab
      const newPage = await page.context().newPage();
      const newHelpers = new CancelTestHelpers(newPage);
      await newHelpers.login();
      await newPage.goto(`/project/${projectId}`);

      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'START_SEGMENTATION',
            data: { imageId: 'other-image' },
          },
          '*'
        );
      });

      // Cancel upload in original tab
      await helpers.clickCancelButton('upload');
      await helpers.waitForCancellation('upload');

      // Verify segmentation continues in other tab
      await expect(
        newPage.locator('[data-testid="segmentation-progress"]')
      ).toBeVisible();

      await newPage.close();
    });
  });

  test.describe('Error Recovery', () => {
    test('should handle server _errors during cancellation', async ({
      page,
    }) => {
      const _projectId = await helpers.createTestProject('Server Error Test');

      // Mock server _error
      await page.route('**/api/uploads/*/cancel', route => {
        route.fulfill({ status: 500, body: 'Internal Server Error' });
      });

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Try to cancel
      await helpers.clickCancelButton('upload');

      // Verify _error handling
      await expect(
        page.locator('[data-testid="cancel-_error-message"]')
      ).toBeVisible();

      // Verify retry option
      await expect(
        page.locator('[data-testid="retry-cancel-button"]')
      ).toBeVisible();

      // Clear route mock
      await page.unroute('**/api/uploads/*/cancel');

      // Retry cancellation
      await page.click('[data-testid="retry-cancel-button"]');
      await helpers.waitForCancellation('upload');
    });

    test('should handle network timeout during cancellation', async ({
      page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'Network Timeout Test'
      );

      // Mock slow network response
      await page.route('**/api/queue/batch/*/cancel', route => {
        // Delay response to simulate timeout
        setTimeout(() => {
          route.fulfill({
            status: 200,
            body: JSON.stringify({ success: true }),
          });
        }, 10000); // 10 second delay
      });

      // Setup batch segmentation
      await helpers.uploadFiles(TEST_CONFIG.files.batchImages);
      await page.waitForSelector('[data-testid="upload-complete"]');
      await page.click('[data-testid="segment-all-button"]');
      await helpers.waitForSegmentationProgress();

      // Try to cancel with timeout
      await helpers.clickCancelButton('segmentation');

      // Verify timeout handling
      await expect(
        page.locator('[data-testid="cancel-timeout-warning"]')
      ).toBeVisible();

      // Verify operation still cancels locally
      await page.waitForSelector('[data-testid="local-cancellation-notice"]');
    });
  });

  test.describe('Performance and Memory', () => {
    test('should not cause memory leaks with repeated cancellations', async ({
      page,
    }) => {
      const _projectId = await helpers.createTestProject('Memory Leak Test');

      // Perform multiple cancel cycles
      for (let i = 0; i < 10; i++) {
        // Start upload
        await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
        await helpers.waitForUploadProgress();

        // Cancel upload
        await helpers.clickCancelButton('upload');
        await helpers.waitForCancellation('upload');

        // Clear any remaining UI state
        await page.reload();
        await page.waitForLoadState('networkidle');
      }

      // Check for memory leaks
      await helpers.verifyNoMemoryLeaks();
    });

    test('should handle rapid cancel/restart cycles', async ({
      page: _page,
    }) => {
      const _projectId = await helpers.createTestProject('Rapid Cycle Test');

      const cycles = 5;
      const startTime = Date.now();

      for (let i = 0; i < cycles; i++) {
        // Start operation
        await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
        await helpers.waitForUploadProgress();

        // Cancel immediately
        await helpers.clickCancelButton('upload');
        await helpers.waitForCancellation('upload');

        // Small delay between cycles
        await page.waitForTimeout(100);
      }

      const totalTime = Date.now() - startTime;
      const averageTimePerCycle = totalTime / cycles;

      // Should complete each cycle quickly
      expect(averageTimePerCycle).toBeLessThan(2000); // Less than 2 seconds per cycle
    });

    test('should maintain performance with high operation volume', async ({
      page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'High Volume Performance Test'
      );

      // Start many operations concurrently
      const operationCount = 20;
      const startTime = Date.now();

      for (let i = 0; i < operationCount; i++) {
        await page.evaluate(index => {
          window.postMessage(
            {
              type: 'START_MOCK_OPERATION',
              data: { operationId: `perf-test-${index}`, type: 'upload' },
            },
            '*'
          );
        }, i);
      }

      // Wait for all operations to start
      await expect(
        page.locator('[data-testid="active-operations"]')
      ).toHaveCount(operationCount);

      // Cancel all operations
      await page.click('[data-testid="cancel-all-operations-button"]');

      // Wait for all cancellations
      await page.waitForSelector('[data-testid="all-operations-cancelled"]');

      const totalTime = Date.now() - startTime;

      // Should handle high volume efficiently
      expect(totalTime).toBeLessThan(10000); // Less than 10 seconds for 20 operations
    });
  });

  test.describe('Accessibility', () => {
    test('should be keyboard navigable', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject('Accessibility Test');

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Navigate to cancel button with keyboard
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Verify cancel button has focus
      const focusedElement = await page.locator(':focus');
      await expect(focusedElement).toHaveAttribute(
        'data-testid',
        'cancel-upload-button'
      );

      // Cancel with keyboard
      await page.keyboard.press('Enter');

      // Verify cancellation
      await helpers.waitForCancellation('upload');
    });

    test('should provide screen reader friendly updates', async ({
      page: _page,
    }) => {
      const _projectId = await helpers.createTestProject('Screen Reader Test');

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Verify ARIA labels and live regions
      await expect(page.locator('[aria-live="polite"]')).toBeVisible();
      await expect(
        page.locator('[data-testid="cancel-upload-button"]')
      ).toHaveAttribute('aria-label');

      // Cancel and verify announcements
      await helpers.clickCancelButton('upload');

      // Verify status announcements
      const liveRegion = page.locator('[aria-live="polite"]');
      await expect(liveRegion).toContainText('Upload cancelled');
    });

    test('should work with high contrast mode', async ({ page: _page }) => {
      const _projectId = await helpers.createTestProject('High Contrast Test');

      // Enable high contrast simulation
      await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Verify cancel button is visible in high contrast
      const cancelButton = page.locator('[data-testid="cancel-upload-button"]');
      await expect(cancelButton).toBeVisible();

      // Verify button has sufficient contrast
      const buttonColor = await cancelButton.evaluate(el => {
        return window.getComputedStyle(el).color;
      });

      expect(buttonColor).not.toBe('rgba(0, 0, 0, 0)'); // Should not be transparent
    });
  });

  test.describe('Browser Compatibility', () => {
    test('should work across different browsers', async ({
      page,
      browserName,
    }) => {
      const _projectId = await helpers.createTestProject(
        `${browserName} Cancel Test`
      );

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Cancel upload
      await helpers.clickCancelButton('upload');
      await helpers.waitForCancellation('upload');

      // Verify cancellation works regardless of browser
      await helpers.verifyOperationCancelled('upload');
    });

    test('should handle browser refresh during operations', async ({
      page,
    }) => {
      const _projectId = await helpers.createTestProject(
        'Browser Refresh Test'
      );

      // Start upload
      await helpers.uploadFiles([TEST_CONFIG.files.singleImage]);
      await helpers.waitForUploadProgress();

      // Refresh browser
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify operation state is recovered or properly reset
      const uploadButton = page.locator('[data-testid="upload-button"]');
      await expect(uploadButton).toBeVisible();
    });
  });

  test.afterEach(async ({ page: _page }) => {
    // Cleanup: Cancel any remaining operations
    try {
      await page.click('[data-testid="cancel-all-operations-button"]', {
        timeout: 1000,
      });
    } catch (_error) {
      // Ignore if button doesn't exist
    }

    // Verify no memory leaks after each test
    const helpers = new CancelTestHelpers(page);
    await helpers.verifyNoMemoryLeaks();
  });
});
