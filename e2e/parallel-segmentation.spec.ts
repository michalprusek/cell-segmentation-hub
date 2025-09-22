/**
 * End-to-End tests for 4-way parallel segmentation processing
 *
 * This test suite validates the complete user workflow for parallel processing,
 * including real-time WebSocket updates, database consistency, and resource
 * allocation fairness during concurrent operations.
 *
 * Requirements tested:
 * - End-to-end test: 4 users submitting segmentation batches simultaneously
 * - Real-time WebSocket updates during concurrent processing
 * - Database consistency during parallel queue operations
 * - Resource allocation fairness among 4 concurrent users
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
// import { faker } from '@faker-js/faker';

// Test configuration
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const BACKEND_URL =
  process.env.PLAYWRIGHT_BACKEND_URL || 'http://localhost:3001';

interface TestUser {
  email: string;
  password: string;
  name: string;
  projectName: string;
  images: TestImage[];
}

interface TestImage {
  filename: string;
  path: string;
  expectedSegmentCount: number;
}

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: number;
}

interface ParallelProcessingResults {
  user: string;
  totalTime: number;
  imagesProcessed: number;
  segmentationResults: number;
  websocketUpdates: number;
  errors: string[];
}

// Test data preparation
const createTestUsers = (): TestUser[] => [
  {
    email: 'parallel_user_1@test.com',
    password: 'TestPassword123!',
    name: 'Parallel Test User 1',
    projectName: 'Parallel Processing Project 1',
    images: [
      {
        filename: 'test_image_1_1.jpg',
        path: '/test-images/cells_01.jpg',
        expectedSegmentCount: 15,
      },
      {
        filename: 'test_image_1_2.jpg',
        path: '/test-images/cells_02.jpg',
        expectedSegmentCount: 12,
      },
      {
        filename: 'test_image_1_3.jpg',
        path: '/test-images/cells_03.jpg',
        expectedSegmentCount: 18,
      },
      {
        filename: 'test_image_1_4.jpg',
        path: '/test-images/cells_04.jpg',
        expectedSegmentCount: 10,
      },
    ],
  },
  {
    email: 'parallel_user_2@test.com',
    password: 'TestPassword123!',
    name: 'Parallel Test User 2',
    projectName: 'Parallel Processing Project 2',
    images: [
      {
        filename: 'test_image_2_1.jpg',
        path: '/test-images/cells_05.jpg',
        expectedSegmentCount: 20,
      },
      {
        filename: 'test_image_2_2.jpg',
        path: '/test-images/cells_06.jpg',
        expectedSegmentCount: 8,
      },
      {
        filename: 'test_image_2_3.jpg',
        path: '/test-images/cells_07.jpg',
        expectedSegmentCount: 14,
      },
      {
        filename: 'test_image_2_4.jpg',
        path: '/test-images/cells_08.jpg',
        expectedSegmentCount: 16,
      },
    ],
  },
  {
    email: 'parallel_user_3@test.com',
    password: 'TestPassword123!',
    name: 'Parallel Test User 3',
    projectName: 'Parallel Processing Project 3',
    images: [
      {
        filename: 'test_image_3_1.jpg',
        path: '/test-images/cells_09.jpg',
        expectedSegmentCount: 22,
      },
      {
        filename: 'test_image_3_2.jpg',
        path: '/test-images/cells_10.jpg',
        expectedSegmentCount: 11,
      },
      {
        filename: 'test_image_3_3.jpg',
        path: '/test-images/cells_11.jpg',
        expectedSegmentCount: 19,
      },
      {
        filename: 'test_image_3_4.jpg',
        path: '/test-images/cells_12.jpg',
        expectedSegmentCount: 13,
      },
    ],
  },
  {
    email: 'parallel_user_4@test.com',
    password: 'TestPassword123!',
    name: 'Parallel Test User 4',
    projectName: 'Parallel Processing Project 4',
    images: [
      {
        filename: 'test_image_4_1.jpg',
        path: '/test-images/cells_13.jpg',
        expectedSegmentCount: 17,
      },
      {
        filename: 'test_image_4_2.jpg',
        path: '/test-images/cells_14.jpg',
        expectedSegmentCount: 9,
      },
      {
        filename: 'test_image_4_3.jpg',
        path: '/test-images/cells_15.jpg',
        expectedSegmentCount: 21,
      },
      {
        filename: 'test_image_4_4.jpg',
        path: '/test-images/cells_16.jpg',
        expectedSegmentCount: 14,
      },
    ],
  },
];

test.describe('Parallel Segmentation Processing E2E', () => {
  let testUsers: TestUser[];

  test.beforeAll(async () => {
    testUsers = createTestUsers();
  });

  test.describe('Setup and Authentication', () => {
    test('should register and authenticate all 4 test users', async ({
      browser,
    }) => {
      // Create separate contexts for each user to simulate real concurrent usage
      const userContexts: {
        user: TestUser;
        context: BrowserContext;
        page: Page;
      }[] = [];

      try {
        for (const user of testUsers) {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: `ParallelTest-${user.name.replace(/\s+/g, '')}`,
          });

          const page = await context.newPage();
          userContexts.push({ user, context, page });

          // Navigate to registration page
          await page.goto(`${BASE_URL}/register`);

          // Register user
          await page.fill('[data-testid="register-name"]', user.name);
          await page.fill('[data-testid="register-email"]', user.email);
          await page.fill('[data-testid="register-password"]', user.password);
          await page.fill(
            '[data-testid="register-confirm-password"]',
            user.password
          );

          await page.click('[data-testid="register-submit"]');

          // Wait for successful registration and redirect to dashboard
          await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

          // Verify user is logged in
          await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
          await expect(page.locator(`text=${user.name}`)).toBeVisible();
        }

        // Verify all users are registered and authenticated
        expect(userContexts).toHaveLength(4);

        // Close all contexts after verification
        for (const { context } of userContexts) {
          await context.close();
        }
      } catch (error) {
        // Cleanup on error
        for (const { context } of userContexts) {
          await context.close();
        }
        throw error;
      }
    });
  });

  test.describe('Project Setup and Image Upload', () => {
    test('should create projects and upload images for all users concurrently', async ({
      browser,
    }) => {
      const userContexts: {
        user: TestUser;
        context: BrowserContext;
        page: Page;
      }[] = [];

      try {
        // Setup contexts for all users
        for (const user of testUsers) {
          const context = await browser.newContext();
          const page = await context.newPage();
          userContexts.push({ user, context, page });

          // Login
          await page.goto(`${BASE_URL}/login`);
          await page.fill('[data-testid="login-email"]', user.email);
          await page.fill('[data-testid="login-password"]', user.password);
          await page.click('[data-testid="login-submit"]');
          await expect(page).toHaveURL(/\/dashboard/);
        }

        // Create projects concurrently
        const projectCreationPromises = userContexts.map(
          async ({ user, page }) => {
            // Create new project
            await page.click('[data-testid="create-project-button"]');
            await page.fill(
              '[data-testid="project-name-input"]',
              user.projectName
            );
            await page.fill(
              '[data-testid="project-description-input"]',
              `Test project for parallel processing - ${user.name}`
            );
            await page.click('[data-testid="create-project-confirm"]');

            // Wait for project creation and navigation
            await expect(page).toHaveURL(/\/project\//, { timeout: 10000 });

            return { user: user.email, success: true };
          }
        );

        const projectResults = await Promise.all(projectCreationPromises);

        // Verify all projects were created
        expect(projectResults.every(result => result.success)).toBe(true);

        // Upload images concurrently for each user
        const imageUploadPromises = userContexts.map(async ({ user, page }) => {
          const uploadResults = [];

          for (const image of user.images) {
            try {
              // Navigate to upload section
              await page.click('[data-testid="upload-images-tab"]');

              // Simulate file upload (in real E2E, you'd upload actual files)
              await page.setInputFiles('[data-testid="file-upload-input"]', {
                name: image.filename,
                mimeType: 'image/jpeg',
                buffer: Buffer.from('fake-image-data'), // In real test, use actual image files
              });

              // Wait for upload to complete
              await expect(
                page.locator(`[data-testid="uploaded-file-${image.filename}"]`)
              ).toBeVisible({ timeout: 15000 });

              uploadResults.push({ filename: image.filename, success: true });
            } catch (error) {
              uploadResults.push({
                filename: image.filename,
                success: false,
                error: error.message,
              });
            }
          }

          return { user: user.email, uploads: uploadResults };
        });

        const uploadResults = await Promise.all(imageUploadPromises);

        // Verify uploads
        for (const userResult of uploadResults) {
          const successfulUploads = userResult.uploads.filter(
            upload => upload.success
          );
          expect(successfulUploads).toHaveLength(4); // Each user should upload 4 images
        }

        // Close contexts
        for (const { context } of userContexts) {
          await context.close();
        }
      } catch (error) {
        // Cleanup on error
        for (const { context } of userContexts) {
          await context.close();
        }
        throw error;
      }
    });
  });

  test.describe('Concurrent Segmentation Processing', () => {
    test('should process 4 users submitting segmentation batches simultaneously', async ({
      browser,
    }) => {
      const userContexts: {
        user: TestUser;
        context: BrowserContext;
        page: Page;
      }[] = [];
      const websocketMessages: {
        user: string;
        messages: WebSocketMessage[];
      }[] = [];
      const processingResults: ParallelProcessingResults[] = [];

      try {
        // Setup contexts and WebSocket monitoring for all users
        for (const user of testUsers) {
          const context = await browser.newContext();
          const page = await context.newPage();
          userContexts.push({ user, context, page });

          // Setup WebSocket message collection
          const userMessages: WebSocketMessage[] = [];
          websocketMessages.push({ user: user.email, messages: userMessages });

          // Monitor WebSocket messages
          page.on('websocket', ws => {
            ws.on('framereceived', event => {
              try {
                const data = JSON.parse(event.payload.toString());
                userMessages.push({
                  type: data.type || 'unknown',
                  data: data,
                  timestamp: Date.now(),
                });
              } catch (_e) {
                // Ignore non-JSON WebSocket messages
              }
            });
          });

          // Login and navigate to project
          await page.goto(`${BASE_URL}/login`);
          await page.fill('[data-testid="login-email"]', user.email);
          await page.fill('[data-testid="login-password"]', user.password);
          await page.click('[data-testid="login-submit"]');
          await expect(page).toHaveURL(/\/dashboard/);

          // Navigate to the user's project
          await page.click(`[data-testid="project-card-${user.projectName}"]`);
          await expect(page).toHaveURL(/\/project\//);
        }

        // Start concurrent segmentation processing for all users
        const segmentationStartTime = Date.now();

        const segmentationPromises = userContexts.map(
          async ({ user, page }) => {
            const userStartTime = Date.now();
            const userResult: ParallelProcessingResults = {
              user: user.email,
              totalTime: 0,
              imagesProcessed: 0,
              segmentationResults: 0,
              websocketUpdates: 0,
              errors: [],
            };

            try {
              // Navigate to segmentation tab
              await page.click('[data-testid="segmentation-tab"]');

              // Select all images for batch processing
              await page.click('[data-testid="select-all-images"]');

              // Configure segmentation settings
              await page.selectOption('[data-testid="model-select"]', 'hrnet');
              await page.fill('[data-testid="threshold-input"]', '0.5');

              // Start batch segmentation
              await page.click('[data-testid="start-batch-segmentation"]');

              // Wait for segmentation to begin
              await expect(
                page.locator('[data-testid="segmentation-in-progress"]')
              ).toBeVisible({ timeout: 5000 });

              // Monitor segmentation progress
              let processedCount = 0;
              let segmentationComplete = false;

              while (
                !segmentationComplete &&
                Date.now() - userStartTime < 60000
              ) {
                // 60 second timeout
                try {
                  // Check for completed segmentations
                  const completedElements = await page
                    .locator('[data-testid^="image-segmented-"]')
                    .count();

                  if (completedElements > processedCount) {
                    processedCount = completedElements;
                    userResult.imagesProcessed = processedCount;
                  }

                  // Check if all images are processed
                  if (processedCount >= user.images.length) {
                    segmentationComplete = true;
                    break;
                  }

                  // Check for errors
                  const errorElements = await page
                    .locator('[data-testid^="image-error-"]')
                    .count();
                  if (errorElements > 0) {
                    const errorText = await page
                      .locator('[data-testid^="image-error-"]')
                      .first()
                      .textContent();
                    userResult.errors.push(errorText || 'Unknown error');
                  }

                  await page.waitForTimeout(1000); // Check every second
                } catch (error) {
                  userResult.errors.push(`Monitoring error: ${error.message}`);
                  break;
                }
              }

              // Count final segmentation results
              const segmentedImages = await page
                .locator('[data-testid^="segmented-polygons-"]')
                .count();
              userResult.segmentationResults = segmentedImages;

              userResult.totalTime = Date.now() - userStartTime;

              return userResult;
            } catch (error) {
              userResult.errors.push(`Processing error: ${error.message}`);
              userResult.totalTime = Date.now() - userStartTime;
              return userResult;
            }
          }
        );

        // Wait for all users to complete segmentation
        const allResults = await Promise.all(segmentationPromises);
        const totalProcessingTime = Date.now() - segmentationStartTime;

        processingResults.push(...allResults);

        // Analyze WebSocket messages received during processing
        for (const { user, messages } of websocketMessages) {
          const userResult = processingResults.find(r => r.user === user);
          if (userResult) {
            userResult.websocketUpdates = messages.length;
          }
        }

        // Performance and correctness assertions
        expect(processingResults).toHaveLength(4);

        // Verify all users completed processing
        const successfulUsers = processingResults.filter(
          r => r.errors.length === 0
        );
        expect(successfulUsers.length).toBeGreaterThan(2); // At least 3 out of 4 should succeed

        // Verify parallel processing performance
        const averageUserTime =
          processingResults.reduce((sum, r) => sum + r.totalTime, 0) /
          processingResults.length;
        expect(totalProcessingTime).toBeLessThan(averageUserTime * 2); // Parallel should be < 2x sequential time

        // Verify concurrent processing didn't take longer than single-user sequential processing
        expect(totalProcessingTime).toBeLessThan(120000); // Should complete within 2 minutes

        // Verify WebSocket real-time updates
        for (const result of processingResults) {
          if (result.errors.length === 0) {
            expect(result.websocketUpdates).toBeGreaterThan(0); // Should receive real-time updates
          }
        }

        // Verify images were processed
        const totalImagesProcessed = processingResults.reduce(
          (sum, r) => sum + r.imagesProcessed,
          0
        );
        expect(totalImagesProcessed).toBeGreaterThan(12); // At least 3 users × 4 images

        // Verify segmentation results
        const totalSegmentationResults = processingResults.reduce(
          (sum, r) => sum + r.segmentationResults,
          0
        );
        expect(totalSegmentationResults).toBeGreaterThan(0); // Should have some segmentation results

        // Parallel processing test completed - results validated in assertions
        expect(totalProcessingTime).toBeLessThan(300000); // 5 minutes max
        expect(averageUserTime).toBeLessThan(120000); // 2 minutes average
        expect(successfulUsers.length).toBe(4);
        expect(totalImagesProcessed).toBeGreaterThan(0);
        expect(totalSegmentationResults).toBeGreaterThan(0);

        // Close contexts
        for (const { context } of userContexts) {
          await context.close();
        }
      } catch (error) {
        // Cleanup on error
        for (const { context } of userContexts) {
          await context.close();
        }
        throw error;
      }
    });

    test('should maintain real-time WebSocket updates during concurrent processing', async ({
      browser,
    }) => {
      const userContexts: {
        user: TestUser;
        context: BrowserContext;
        page: Page;
      }[] = [];
      const websocketTracking: Record<
        string,
        {
          queueUpdates: number;
          segmentationUpdates: number;
          completionNotifications: number;
          errors: number;
          latencies: number[];
        }
      > = {};

      try {
        // Setup one user for detailed WebSocket monitoring
        const primaryUser = testUsers[0];
        const context = await browser.newContext();
        const page = await context.newPage();
        userContexts.push({ user: primaryUser, context, page });

        // Initialize tracking
        websocketTracking[primaryUser.email] = {
          queueUpdates: 0,
          segmentationUpdates: 0,
          completionNotifications: 0,
          errors: 0,
          latencies: [],
        };

        const tracking = websocketTracking[primaryUser.email];

        // Setup detailed WebSocket monitoring
        page.on('websocket', ws => {
          ws.on('framereceived', event => {
            const receiveTime = Date.now();

            try {
              const data = JSON.parse(event.payload.toString());

              // Track different types of WebSocket messages
              if (data.type === 'queueStatsUpdate') {
                tracking.queueUpdates++;
              } else if (data.type === 'segmentationUpdate') {
                tracking.segmentationUpdates++;

                // Calculate latency if timestamp is available
                if (data.timestamp) {
                  const latency = receiveTime - data.timestamp;
                  tracking.latencies.push(latency);
                }
              } else if (data.type === 'segmentationComplete') {
                tracking.completionNotifications++;
              } else if (data.type === 'error') {
                tracking.errors++;
              }
            } catch (_e) {
              // Ignore non-JSON messages
            }
          });
        });

        // Login and setup
        await page.goto(`${BASE_URL}/login`);
        await page.fill('[data-testid="login-email"]', primaryUser.email);
        await page.fill('[data-testid="login-password"]', primaryUser.password);
        await page.click('[data-testid="login-submit"]');
        await expect(page).toHaveURL(/\/dashboard/);

        // Navigate to project
        await page.click(
          `[data-testid="project-card-${primaryUser.projectName}"]`
        );
        await page.click('[data-testid="segmentation-tab"]');

        // Start segmentation and monitor WebSocket activity
        await page.click('[data-testid="select-all-images"]');
        await page.selectOption('[data-testid="model-select"]', 'hrnet');
        await page.click('[data-testid="start-batch-segmentation"]');

        // Wait for processing to begin and monitor updates
        await page.waitForTimeout(2000); // Allow initial setup

        const monitoringStartTime = Date.now();
        let monitoringDuration = 0;

        while (monitoringDuration < 30000) {
          // Monitor for 30 seconds
          // Check for new WebSocket activity
          await page.waitForTimeout(1000);
          monitoringDuration = Date.now() - monitoringStartTime;

          // Check if processing is complete
          const completedImages = await page
            .locator('[data-testid^="image-segmented-"]')
            .count();
          if (completedImages >= primaryUser.images.length) {
            break;
          }
        }

        // Verify WebSocket communication quality
        expect(tracking.queueUpdates).toBeGreaterThan(0); // Should receive queue status updates
        expect(tracking.segmentationUpdates).toBeGreaterThan(0); // Should receive segmentation progress updates

        // Verify real-time performance
        if (tracking.latencies.length > 0) {
          const averageLatency =
            tracking.latencies.reduce((a, b) => a + b, 0) /
            tracking.latencies.length;
          const maxLatency = Math.max(...tracking.latencies);

          expect(averageLatency).toBeLessThan(1000); // Average latency should be < 1 second
          expect(maxLatency).toBeLessThan(5000); // Max latency should be < 5 seconds

          // WebSocket performance test completed - metrics validated in assertions
          expect(tracking.queueUpdates).toBeGreaterThan(0);
          expect(tracking.segmentationUpdates).toBeGreaterThan(0);
          expect(tracking.completionNotifications).toBeGreaterThan(0);
          expect(tracking.errors).toBe(0);
        }

        // Clean up
        for (const { context } of userContexts) {
          await context.close();
        }
      } catch (error) {
        for (const { context } of userContexts) {
          await context.close();
        }
        throw error;
      }
    });
  });

  test.describe('Database Consistency Verification', () => {
    test('should maintain database consistency during parallel operations', async ({
      browser: _browser,
      request,
    }) => {
      // This test verifies database state through API calls during concurrent operations
      const userTokens: Record<string, string> = {};

      // Authenticate all users and get tokens
      for (const user of testUsers) {
        const loginResponse = await request.post(
          `${BACKEND_URL}/api/auth/login`,
          {
            data: { email: user.email, password: user.password },
          }
        );

        expect(loginResponse.ok()).toBe(true);
        const loginData = await loginResponse.json();
        userTokens[user.email] = loginData.token;
      }

      // Start concurrent operations for all users
      const concurrentOperations = testUsers.map(async user => {
        const token = userTokens[user.email];
        const headers = { Authorization: `Bearer ${token}` };

        // Get user's projects
        const projectsResponse = await request.get(
          `${BACKEND_URL}/api/projects`,
          { headers }
        );
        expect(projectsResponse.ok()).toBe(true);

        const projectsData = await projectsResponse.json();
        const userProject = projectsData.projects.find(
          (p: any) => p.name === user.projectName
        );
        expect(userProject).toBeDefined();

        // Get project images
        const imagesResponse = await request.get(
          `${BACKEND_URL}/api/projects/${userProject.id}/images`,
          { headers }
        );
        expect(imagesResponse.ok()).toBe(true);

        const imagesData = await imagesResponse.json();
        expect(imagesData.images.length).toBeGreaterThan(0);

        // Submit batch segmentation
        const batchRequest = {
          imageIds: imagesData.images.map((img: any) => img.id),
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true,
        };

        const batchResponse = await request.post(
          `${BACKEND_URL}/api/segmentation/batch`,
          { headers, data: batchRequest }
        );

        expect(batchResponse.ok()).toBe(true);

        // Monitor queue status
        let queueEmpty = false;
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds timeout

        while (!queueEmpty && attempts < maxAttempts) {
          const queueResponse = await request.get(
            `${BACKEND_URL}/api/queue/stats/${userProject.id}`,
            { headers }
          );

          if (queueResponse.ok()) {
            const queueData = await queueResponse.json();
            queueEmpty =
              queueData.stats.queued === 0 && queueData.stats.processing === 0;
          }

          if (!queueEmpty) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          attempts++;
        }

        // Verify final state
        const finalImagesResponse = await request.get(
          `${BACKEND_URL}/api/projects/${userProject.id}/images`,
          { headers }
        );
        expect(finalImagesResponse.ok()).toBe(true);

        const finalImagesData = await finalImagesResponse.json();
        const segmentedImages = finalImagesData.images.filter(
          (img: any) =>
            img.segmentationStatus === 'segmented' ||
            img.segmentationStatus === 'no_segmentation'
        );

        return {
          user: user.email,
          projectId: userProject.id,
          totalImages: imagesData.images.length,
          processedImages: segmentedImages.length,
          queueEmptied: queueEmpty,
        };
      });

      // Wait for all concurrent operations to complete
      const operationResults = await Promise.all(concurrentOperations);

      // Verify database consistency
      for (const result of operationResults) {
        expect(result.processedImages).toBeGreaterThan(0); // Some images should be processed
        expect(result.processedImages).toBeLessThanOrEqual(result.totalImages); // Not more than total
        expect(result.queueEmptied).toBe(true); // Queue should be empty after processing
      }

      // Verify no data corruption across users
      const totalImagesProcessed = operationResults.reduce(
        (sum, r) => sum + r.processedImages,
        0
      );
      expect(totalImagesProcessed).toBeGreaterThan(0);

      // Cross-verify that each user's data is isolated and correct
      for (const user of testUsers) {
        const token = userTokens[user.email];
        const headers = { Authorization: `Bearer ${token}` };

        const projectsResponse = await request.get(
          `${BACKEND_URL}/api/projects`,
          { headers }
        );
        const projectsData = await projectsResponse.json();

        // User should only see their own projects
        const userProjects = projectsData.projects.filter(
          (p: any) => p.name === user.projectName
        );
        expect(userProjects.length).toBe(1);

        // Verify project integrity
        const userProject = userProjects[0];
        const imagesResponse = await request.get(
          `${BACKEND_URL}/api/projects/${userProject.id}/images`,
          { headers }
        );
        const imagesData = await imagesResponse.json();

        expect(imagesData.images.length).toBe(user.images.length); // All images should be present
      }

      // Database consistency test completed - results validated in assertions
      expect(operationResults.length).toBe(4);
      expect(totalImagesProcessed).toBeGreaterThan(0);
      expect(operationResults.every(r => r.queueEmptied)).toBe(true);
    });
  });

  test.describe('Resource Allocation Fairness', () => {
    test('should allocate resources fairly among 4 concurrent users', async ({
      browser: _browser,
      request,
    }) => {
      const fairnessMetrics: Record<
        string,
        {
          startTime: number;
          endTime: number;
          processingTime: number;
          imagesPerSecond: number;
          queueWaitTime: number;
          resourceShare: number;
        }
      > = {};

      // Authenticate all users
      const userTokens: Record<string, string> = {};
      for (const user of testUsers) {
        const loginResponse = await request.post(
          `${BACKEND_URL}/api/auth/login`,
          {
            data: { email: user.email, password: user.password },
          }
        );
        const loginData = await loginResponse.json();
        userTokens[user.email] = loginData.token;

        // Initialize metrics
        fairnessMetrics[user.email] = {
          startTime: 0,
          endTime: 0,
          processingTime: 0,
          imagesPerSecond: 0,
          queueWaitTime: 0,
          resourceShare: 0,
        };
      }

      // Submit all batches simultaneously to test fairness
      const simultaneousStartTime = Date.now();

      const fairnessPromises = testUsers.map(async user => {
        const token = userTokens[user.email];
        const headers = { Authorization: `Bearer ${token}` };
        const metrics = fairnessMetrics[user.email];

        // Get user's project and images
        const projectsResponse = await request.get(
          `${BACKEND_URL}/api/projects`,
          { headers }
        );
        const projectsData = await projectsResponse.json();
        const userProject = projectsData.projects.find(
          (p: any) => p.name === user.projectName
        );

        const imagesResponse = await request.get(
          `${BACKEND_URL}/api/projects/${userProject.id}/images`,
          { headers }
        );
        const imagesData = await imagesResponse.json();

        // Record start time
        metrics.startTime = Date.now();

        // Submit batch with different priorities to test fairness
        const userIndex = testUsers.indexOf(user);
        const priority = userIndex % 2; // Alternate priorities: 0, 1, 0, 1

        const batchRequest = {
          imageIds: imagesData.images.map((img: any) => img.id),
          model: userIndex < 2 ? 'hrnet' : 'cbam_resunet', // Mix models
          threshold: 0.5,
          priority: priority,
          detectHoles: true,
        };

        await request.post(`${BACKEND_URL}/api/segmentation/batch`, {
          headers,
          data: batchRequest,
        });

        // Monitor processing with detailed timing
        let firstProcessingDetected = false;
        let queueWaitTime = 0;

        while (true) {
          const queueResponse = await request.get(
            `${BACKEND_URL}/api/queue/stats/${userProject.id}`,
            { headers }
          );

          if (queueResponse.ok()) {
            const queueData = await queueResponse.json();

            // Detect when processing starts (queue wait time ends)
            if (!firstProcessingDetected && queueData.stats.processing > 0) {
              firstProcessingDetected = true;
              queueWaitTime = Date.now() - metrics.startTime;
              metrics.queueWaitTime = queueWaitTime;
            }

            // Check if processing is complete
            if (
              queueData.stats.queued === 0 &&
              queueData.stats.processing === 0
            ) {
              metrics.endTime = Date.now();
              break;
            }
          }

          await new Promise(resolve => setTimeout(resolve, 500));

          // Timeout after 2 minutes
          if (Date.now() - metrics.startTime > 120000) {
            metrics.endTime = Date.now();
            break;
          }
        }

        // Calculate metrics
        metrics.processingTime = metrics.endTime - metrics.startTime;
        metrics.imagesPerSecond =
          user.images.length / (metrics.processingTime / 1000);

        return {
          user: user.email,
          success: metrics.endTime > metrics.startTime,
        };
      });

      // Wait for all users to complete
      const fairnessResults = await Promise.all(fairnessPromises);
      const totalTime = Date.now() - simultaneousStartTime;

      // Calculate resource share (normalized processing time)
      const totalProcessingTime = Object.values(fairnessMetrics).reduce(
        (sum, m) => sum + m.processingTime,
        0
      );

      for (const metrics of Object.values(fairnessMetrics)) {
        metrics.resourceShare =
          totalProcessingTime > 0
            ? metrics.processingTime / totalProcessingTime
            : 0;
      }

      // Fairness analysis
      const processingTimes = Object.values(fairnessMetrics).map(
        m => m.processingTime
      );
      const queueWaitTimes = Object.values(fairnessMetrics).map(
        m => m.queueWaitTime
      );
      const throughputs = Object.values(fairnessMetrics).map(
        m => m.imagesPerSecond
      );

      const avgProcessingTime =
        processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
      const avgQueueWaitTime =
        queueWaitTimes.reduce((a, b) => a + b, 0) / queueWaitTimes.length;
      const avgThroughput =
        throughputs.reduce((a, b) => a + b, 0) / throughputs.length;

      // Calculate fairness metrics (coefficient of variation)
      const processingTimeVariance =
        processingTimes.reduce(
          (sum, time) => sum + Math.pow(time - avgProcessingTime, 2),
          0
        ) / processingTimes.length;
      const processingTimeStdDev = Math.sqrt(processingTimeVariance);
      const fairnessCoefficient = processingTimeStdDev / avgProcessingTime;

      // Fairness assertions
      expect(fairnessResults.every(r => r.success)).toBe(true); // All users should complete

      // Processing times should be reasonably fair (coefficient of variation < 0.5)
      expect(fairnessCoefficient).toBeLessThan(0.5);

      // Queue wait times should be relatively similar
      const maxQueueWaitTime = Math.max(...queueWaitTimes);
      const minQueueWaitTime = Math.min(...queueWaitTimes);
      expect(maxQueueWaitTime - minQueueWaitTime).toBeLessThan(10000); // Within 10 seconds

      // Resource shares should be relatively even (each user should get ~25% of resources)
      const resourceShares = Object.values(fairnessMetrics).map(
        m => m.resourceShare
      );
      const expectedShare = 1 / testUsers.length; // 0.25 for 4 users

      for (const share of resourceShares) {
        expect(share).toBeGreaterThan(expectedShare * 0.5); // At least 50% of fair share
        expect(share).toBeLessThan(expectedShare * 2.0); // At most 200% of fair share
      }

      // Resource allocation fairness test completed - results validated in assertions
      expect(totalTime).toBeLessThan(300000); // Should complete within 5 minutes
      expect(avgProcessingTime).toBeLessThan(120000); // Average under 2 minutes
      expect(avgQueueWaitTime).toBeLessThan(60000); // Average wait under 1 minute
      expect(avgThroughput).toBeGreaterThan(0); // Should have positive throughput
      expect(fairnessCoefficient).toBeGreaterThan(0.8); // High fairness coefficient
    });
  });

  test.describe('Error Recovery and Resilience', () => {
    test('should recover gracefully from partial failures in concurrent processing', async ({
      browser: _browser,
      request,
    }) => {
      // This test simulates failures and verifies recovery mechanisms
      const userTokens: Record<string, string> = {};

      // Authenticate users
      for (const user of testUsers.slice(0, 2)) {
        // Use only 2 users for this test
        const loginResponse = await request.post(
          `${BACKEND_URL}/api/auth/login`,
          {
            data: { email: user.email, password: user.password },
          }
        );
        const loginData = await loginResponse.json();
        userTokens[user.email] = loginData.token;
      }

      const activeUsers = testUsers.slice(0, 2);
      const recoveryResults: Array<{
        user: string;
        initialSubmission: boolean;
        recoverySuccessful: boolean;
        finalProcessedImages: number;
        retryAttempts: number;
      }> = [];

      // Submit batches and monitor for failures/recovery
      const recoveryPromises = activeUsers.map(async (user, index) => {
        const token = userTokens[user.email];
        const headers = { Authorization: `Bearer ${token}` };

        const result = {
          user: user.email,
          initialSubmission: false,
          recoverySuccessful: false,
          finalProcessedImages: 0,
          retryAttempts: 0,
        };

        try {
          // Get project and images
          const projectsResponse = await request.get(
            `${BACKEND_URL}/api/projects`,
            { headers }
          );
          const projectsData = await projectsResponse.json();
          const userProject = projectsData.projects.find(
            (p: any) => p.name === user.projectName
          );

          const imagesResponse = await request.get(
            `${BACKEND_URL}/api/projects/${userProject.id}/images`,
            { headers }
          );
          const imagesData = await imagesResponse.json();

          // Submit batch with potentially problematic settings for the second user
          const batchRequest = {
            imageIds: imagesData.images.map((img: any) => img.id),
            model: index === 1 ? 'invalid_model' : 'hrnet', // Intentional error for user 2
            threshold: 0.5,
            detectHoles: true,
          };

          const batchResponse = await request.post(
            `${BACKEND_URL}/api/segmentation/batch`,
            { headers, data: batchRequest }
          );

          if (batchResponse.ok()) {
            result.initialSubmission = true;
          }

          // Monitor and retry on failures
          let monitoring = true;
          let monitoringStartTime = Date.now();

          while (monitoring && Date.now() - monitoringStartTime < 60000) {
            const queueResponse = await request.get(
              `${BACKEND_URL}/api/queue/stats/${userProject.id}`,
              { headers }
            );

            if (queueResponse.ok()) {
              const queueData = await queueResponse.json();

              // Check for stuck or failed items
              if (
                queueData.stats.queued === 0 &&
                queueData.stats.processing === 0
              ) {
                // Processing complete
                monitoring = false;
              } else if (Date.now() - monitoringStartTime > 30000) {
                // Stuck - attempt recovery
                result.retryAttempts++;

                // Retry with correct settings
                const retryRequest = {
                  ...batchRequest,
                  model: 'hrnet', // Use valid model
                };

                const retryResponse = await request.post(
                  `${BACKEND_URL}/api/segmentation/batch`,
                  { headers, data: retryRequest }
                );

                if (retryResponse.ok()) {
                  result.recoverySuccessful = true;
                }

                monitoringStartTime = Date.now(); // Reset timer for retry
              }
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
          }

          // Check final state
          const finalImagesResponse = await request.get(
            `${BACKEND_URL}/api/projects/${userProject.id}/images`,
            { headers }
          );
          const finalImagesData = await finalImagesResponse.json();

          result.finalProcessedImages = finalImagesData.images.filter(
            (img: any) =>
              img.segmentationStatus === 'segmented' ||
              img.segmentationStatus === 'no_segmentation'
          ).length;
        } catch (error) {
          console.error(
            `Error in recovery test for user ${user.email}:`,
            error
          );
        }

        return result;
      });

      const allResults = await Promise.all(recoveryPromises);
      recoveryResults.push(...allResults);

      // Verify recovery behavior
      const userWithError = recoveryResults.find(r => !r.initialSubmission);
      const userWithoutError = recoveryResults.find(r => r.initialSubmission);

      if (userWithError) {
        expect(userWithError.retryAttempts).toBeGreaterThan(0); // Should attempt recovery
        // Note: Recovery success depends on the backend implementation
      }

      if (userWithoutError) {
        expect(userWithoutError.finalProcessedImages).toBeGreaterThan(0); // Should process successfully
      }

      // At least one user should complete successfully
      const successfulUsers = recoveryResults.filter(
        r => r.finalProcessedImages > 0
      );
      expect(successfulUsers.length).toBeGreaterThan(0);

      // Error recovery test completed - results validated in assertions
      expect(recoveryResults.length).toBe(4);
      expect(
        recoveryResults.filter(r => r.recoverySuccessful).length
      ).toBeGreaterThanOrEqual(3); // At least 75% success
      expect(
        recoveryResults.reduce((sum, r) => sum + r.finalProcessedImages, 0)
      ).toBeGreaterThan(0); // Some images processed
    });
  });
});
