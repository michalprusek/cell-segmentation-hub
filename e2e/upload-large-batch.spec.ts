import { test, expect, Page, BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Test configuration
const TEST_USER = {
  email: 'test-upload@example.com',
  password: 'TestPassword123!',
  username: 'uploadtester',
};

const TEST_PROJECT = {
  name: 'Large Batch Upload Test',
  description: 'Testing large batch upload functionality',
};

// Helper to create test image files
async function createTestImages(
  count: number,
  baseDir: string
): Promise<string[]> {
  const files: string[] = [];

  // Create a simple 1x1 pixel JPEG for testing
  const miniJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x11,
    0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
    0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04,
    0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03,
    0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61,
    0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1,
    0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
    0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34,
    0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64,
    0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
    0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93,
    0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6,
    0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9,
    0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
    0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5,
    0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7,
    0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11,
    0x03, 0x11, 0x00, 0x3f, 0x00, 0xf7, 0xfa, 0x28, 0xa2, 0x8a, 0x00, 0x28,
    0xa2, 0x8a, 0x00, 0xff, 0xd9,
  ]);

  for (let i = 0; i < count; i++) {
    const filename = `test-image-${i + 1}.jpg`;
    const filepath = path.join(baseDir, filename);
    await fs.promises.writeFile(filepath, miniJpeg);
    files.push(filepath);
  }

  return files;
}

// Cleanup function
async function cleanupTestImages(files: string[]) {
  for (const file of files) {
    try {
      await fs.promises.unlink(file);
    } catch (_error) {
      // Ignore cleanup errors
    }
  }
}

test.describe('Large Batch Upload E2E Tests', () => {
  let context: BrowserContext;
  let page: Page;
  let testImagesDir: string;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();

    // Create temp directory for test images
    testImagesDir = path.join(process.cwd(), 'temp-test-images');
    await fs.promises.mkdir(testImagesDir, { recursive: true });

    // Register test user
    await page.goto('http://localhost:3000/register');
    await page.fill('[data-testid="email"]', TEST_USER.email);
    await page.fill('[data-testid="password"]', TEST_USER.password);
    await page.fill('[data-testid="username"]', TEST_USER.username);
    await page.click('[data-testid="register-button"]');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard');

    // Create test project
    await page.click('[data-testid="create-project-button"]');
    await page.fill('[data-testid="project-name"]', TEST_PROJECT.name);
    await page.fill(
      '[data-testid="project-description"]',
      TEST_PROJECT.description
    );
    await page.click('[data-testid="create-project-submit"]');

    // Wait for project creation
    await page.waitForSelector(`text=${TEST_PROJECT.name}`);
  });

  test.afterAll(async () => {
    // Cleanup test images directory
    await fs.promises.rm(testImagesDir, { recursive: true, force: true });
    await context.close();
  });

  test('should upload 100 images with progress indication', async () => {
    const fileCount = 100;
    const testFiles = await createTestImages(fileCount, testImagesDir);

    try {
      // Navigate to project
      await page.click(`text=${TEST_PROJECT.name}`);
      await page.waitForSelector('[data-testid="upload-images-button"]');

      // Click upload button
      await page.click('[data-testid="upload-images-button"]');

      // Select files
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(testFiles);

      // Start upload
      await page.click('[data-testid="start-upload-button"]');

      // Wait for progress bar to appear
      await page.waitForSelector('[data-testid="upload-progress-bar"]');

      // Monitor progress updates
      const progressUpdates: number[] = [];
      const progressElement = page.locator(
        '[data-testid="upload-progress-percentage"]'
      );

      // Collect progress updates
      const progressInterval = setInterval(async () => {
        try {
          const progressText = await progressElement.textContent();
          if (progressText) {
            const progress = parseInt(progressText.replace('%', ''));
            if (!isNaN(progress)) {
              progressUpdates.push(progress);
            }
          }
        } catch (_error) {
          // Element might not be available
        }
      }, 500);

      // Wait for upload completion
      await page.waitForSelector('[data-testid="upload-complete"]', {
        timeout: 120000,
      });
      clearInterval(progressInterval);

      // Verify progress went from 0 to 100
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100);

      // Verify success message
      await expect(
        page.locator('[data-testid="upload-success-message"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="upload-success-message"]')
      ).toContainText('100 images');

      // Verify images appear in project view
      await page.waitForSelector('[data-testid="image-grid"]');
      const imageCards = page.locator('[data-testid="image-card"]');
      const imageCount = await imageCards.count();
      expect(imageCount).toBe(fileCount);
    } finally {
      await cleanupTestImages(testFiles);
    }
  });

  test('should handle 613 images upload (original problem case)', async () => {
    const fileCount = 613;
    const testFiles = await createTestImages(fileCount, testImagesDir);

    try {
      // Navigate to project
      await page.click(`text=${TEST_PROJECT.name}`);
      await page.waitForSelector('[data-testid="upload-images-button"]');

      // Click upload button
      await page.click('[data-testid="upload-images-button"]');

      // Select files (this might take a moment for 613 files)
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(testFiles);

      // Verify file count is displayed
      await expect(
        page.locator('[data-testid="selected-files-count"]')
      ).toContainText('613');

      // Start upload
      await page.click('[data-testid="start-upload-button"]');

      // Wait for chunked upload indication
      await page.waitForSelector('[data-testid="chunked-upload-info"]');
      await expect(
        page.locator('[data-testid="chunked-upload-info"]')
      ).toContainText('31 chunks');

      // Monitor chunk progress
      const chunkProgressElement = page.locator(
        '[data-testid="chunk-progress"]'
      );
      const chunkUpdates: string[] = [];

      const chunkInterval = setInterval(async () => {
        try {
          const chunkText = await chunkProgressElement.textContent();
          if (chunkText && !chunkUpdates.includes(chunkText)) {
            chunkUpdates.push(chunkText);
          }
        } catch (_error) {
          // Element might not be available
        }
      }, 1000);

      // Wait for upload completion (allow up to 10 minutes)
      await page.waitForSelector('[data-testid="upload-complete"]', {
        timeout: 600000,
      });
      clearInterval(chunkInterval);

      // Verify chunk progress was tracked
      expect(chunkUpdates.length).toBeGreaterThan(0);
      expect(chunkUpdates[chunkUpdates.length - 1]).toContain('31/31');

      // Verify all images uploaded
      await expect(
        page.locator('[data-testid="upload-success-message"]')
      ).toContainText('613 images');

      // Navigate to image gallery to verify
      await page.click('[data-testid="view-images-button"]');
      await page.waitForSelector('[data-testid="image-gallery"]');

      // Check total image count (may be paginated)
      const imageCountElement = page.locator(
        '[data-testid="total-image-count"]'
      );
      await expect(imageCountElement).toContainText('613');
    } finally {
      await cleanupTestImages(testFiles);
    }
  });

  test('should handle upload cancellation', async () => {
    const fileCount = 150;
    const testFiles = await createTestImages(fileCount, testImagesDir);

    try {
      // Navigate to project and start upload
      await page.click(`text=${TEST_PROJECT.name}`);
      await page.click('[data-testid="upload-images-button"]');

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(testFiles);

      await page.click('[data-testid="start-upload-button"]');

      // Wait for upload to start
      await page.waitForSelector('[data-testid="upload-progress-bar"]');

      // Wait a bit for upload to progress
      await page.waitForTimeout(2000);

      // Cancel upload
      await page.click('[data-testid="cancel-upload-button"]');

      // Verify cancellation message
      await page.waitForSelector('[data-testid="upload-cancelled"]');
      await expect(
        page.locator('[data-testid="upload-cancelled"]')
      ).toContainText('Upload cancelled');

      // Verify partial uploads are handled gracefully
      await page.waitForSelector('[data-testid="partial-upload-info"]');
      const partialInfo = await page
        .locator('[data-testid="partial-upload-info"]')
        .textContent();
      expect(partialInfo).toMatch(/\d+ images uploaded before cancellation/);
    } finally {
      await cleanupTestImages(testFiles);
    }
  });

  test('should handle upload errors gracefully', async () => {
    const fileCount = 50;
    const testFiles = await createTestImages(fileCount, testImagesDir);

    // Add one invalid file
    const invalidFile = path.join(testImagesDir, 'invalid.txt');
    await fs.promises.writeFile(invalidFile, 'This is not an image');
    testFiles.push(invalidFile);

    try {
      await page.click(`text=${TEST_PROJECT.name}`);
      await page.click('[data-testid="upload-images-button"]');

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(testFiles);

      await page.click('[data-testid="start-upload-button"]');

      // Wait for error to appear
      await page.waitForSelector('[data-testid="upload-error"]');

      // Verify error message mentions file type
      await expect(page.locator('[data-testid="upload-error"]')).toContainText(
        'file type'
      );

      // Verify retry button is available
      await expect(
        page.locator('[data-testid="retry-upload-button"]')
      ).toBeVisible();
    } finally {
      await cleanupTestImages(testFiles);
    }
  });

  test('should display accurate progress for chunked uploads', async () => {
    const fileCount = 85; // Not divisible by 20, so last chunk will be smaller
    const testFiles = await createTestImages(fileCount, testImagesDir);

    try {
      await page.click(`text=${TEST_PROJECT.name}`);
      await page.click('[data-testid="upload-images-button"]');

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(testFiles);

      await page.click('[data-testid="start-upload-button"]');

      // Monitor both overall progress and chunk progress
      const progressElement = page.locator(
        '[data-testid="upload-progress-percentage"]'
      );
      const chunkElement = page.locator('[data-testid="current-chunk"]');

      const progressData: Array<{
        overall: number;
        chunk: string;
        timestamp: number;
      }> = [];

      const monitorInterval = setInterval(async () => {
        try {
          const overallText = await progressElement.textContent();
          const chunkText = await chunkElement.textContent();

          if (overallText && chunkText) {
            const overall = parseInt(overallText.replace('%', ''));
            if (!isNaN(overall)) {
              progressData.push({
                overall,
                chunk: chunkText,
                timestamp: Date.now(),
              });
            }
          }
        } catch (_error) {
          // Elements might not be available
        }
      }, 500);

      await page.waitForSelector('[data-testid="upload-complete"]', {
        timeout: 120000,
      });
      clearInterval(monitorInterval);

      // Analyze progress data
      expect(progressData.length).toBeGreaterThan(0);

      // Progress should be monotonically increasing
      for (let i = 1; i < progressData.length; i++) {
        expect(progressData[i].overall).toBeGreaterThanOrEqual(
          progressData[i - 1].overall
        );
      }

      // Should see multiple chunks (85 files = 5 chunks of 20, 17 files)
      const uniqueChunks = new Set(progressData.map(d => d.chunk));
      expect(uniqueChunks.size).toBeGreaterThan(1);

      // Final progress should be 100%
      expect(progressData[progressData.length - 1].overall).toBe(100);
    } finally {
      await cleanupTestImages(testFiles);
    }
  });

  test('should handle network interruptions and resume', async () => {
    const fileCount = 80;
    const testFiles = await createTestImages(fileCount, testImagesDir);

    try {
      await page.click(`text=${TEST_PROJECT.name}`);
      await page.click('[data-testid="upload-images-button"]');

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(testFiles);

      await page.click('[data-testid="start-upload-button"]');

      // Wait for upload to start
      await page.waitForSelector('[data-testid="upload-progress-bar"]');

      // Simulate network interruption by going offline
      await context.setOffline(true);

      // Wait for network error to be detected
      await page.waitForSelector('[data-testid="network-error"]', {
        timeout: 10000,
      });

      // Go back online
      await context.setOffline(false);

      // Check for resume functionality
      if (
        await page.locator('[data-testid="resume-upload-button"]').isVisible()
      ) {
        await page.click('[data-testid="resume-upload-button"]');
      }

      // Wait for upload to complete or show appropriate error handling
      await Promise.race([
        page.waitForSelector('[data-testid="upload-complete"]', {
          timeout: 60000,
        }),
        page.waitForSelector('[data-testid="upload-partial-complete"]', {
          timeout: 60000,
        }),
      ]);

      // Verify some images were uploaded
      const resultElement = await page
        .locator('[data-testid="upload-result"]')
        .textContent();
      expect(resultElement).toMatch(/\d+ images uploaded/);
    } finally {
      await context.setOffline(false); // Ensure we're back online
      await cleanupTestImages(testFiles);
    }
  });

  test('should respect file size limits per chunk', async () => {
    // Create files that would exceed nginx limits if uploaded all at once
    const fileCount = 40;
    const largeFileSize = 10 * 1024 * 1024; // 10MB per file

    const testFiles: string[] = [];
    for (let i = 0; i < fileCount; i++) {
      const filename = `large-test-${i + 1}.jpg`;
      const filepath = path.join(testImagesDir, filename);

      // Create a larger JPEG-like file
      const largeBuffer = Buffer.alloc(largeFileSize);
      largeBuffer.fill(0xff);
      // Add JPEG header
      largeBuffer[0] = 0xff;
      largeBuffer[1] = 0xd8;
      largeBuffer[2] = 0xff;

      await fs.promises.writeFile(filepath, largeBuffer);
      testFiles.push(filepath);
    }

    try {
      await page.click(`text=${TEST_PROJECT.name}`);
      await page.click('[data-testid="upload-images-button"]');

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(testFiles);

      // Should show warning about large files
      await expect(
        page.locator('[data-testid="large-files-warning"]')
      ).toBeVisible();

      await page.click('[data-testid="start-upload-button"]');

      // Should process in smaller chunks due to size limits
      await page.waitForSelector('[data-testid="chunked-upload-info"]');
      const chunkInfo = await page
        .locator('[data-testid="chunked-upload-info"]')
        .textContent();

      // Should be more chunks due to size constraints (not just count-based)
      expect(chunkInfo).toMatch(/chunks/);

      // Wait for completion
      await page.waitForSelector('[data-testid="upload-complete"]', {
        timeout: 300000,
      }); // 5 minutes

      await expect(
        page.locator('[data-testid="upload-success-message"]')
      ).toContainText('40 images');
    } finally {
      await cleanupTestImages(testFiles);
    }
  });
});
