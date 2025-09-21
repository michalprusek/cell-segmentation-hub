import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from '../utils/testApp';
import {
  createTestUser,
  createTestProject,
  createTestImage,
  createTestQueueItems,
  cleanupTestData,
  waitForCondition,
  DatabaseStateVerifier
} from '../utils/testHelpers';

/**
 * Race condition and concurrent operation tests for queue cancellation
 * These tests verify that the system handles concurrent operations safely
 */
describe('Queue Cancellation Race Conditions', () => {
  let app: Express;
  let prisma: PrismaClient;
  let testUser: any;
  let testProject: any;
  let testImages: any[];
  let authToken: string;
  let dbVerifier: DatabaseStateVerifier;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.TEST_DATABASE_URL || 'file:./test.db'
        }
      }
    });
    dbVerifier = new DatabaseStateVerifier(prisma);
  });

  beforeEach(async () => {
    await cleanupTestData(prisma);

    const userResult = await createTestUser(app);
    testUser = userResult.user;
    authToken = userResult.token;

    testProject = await createTestProject(prisma, testUser.id);

    testImages = await Promise.all([
      createTestImage(prisma, testProject.id, 'race1.jpg'),
      createTestImage(prisma, testProject.id, 'race2.jpg'),
      createTestImage(prisma, testProject.id, 'race3.jpg'),
      createTestImage(prisma, testProject.id, 'race4.jpg'),
      createTestImage(prisma, testProject.id, 'race5.jpg'),
      createTestImage(prisma, testProject.id, 'race6.jpg'),
      createTestImage(prisma, testProject.id, 'race7.jpg'),
      createTestImage(prisma, testProject.id, 'race8.jpg'),
      createTestImage(prisma, testProject.id, 'race9.jpg'),
      createTestImage(prisma, testProject.id, 'race10.jpg')
    ]);
  });

  afterEach(async () => {
    await cleanupTestData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Concurrent Individual Cancellations', () => {
    it('should handle multiple users cancelling different items simultaneously', async () => {
      // Create second user
      const user2Result = await createTestUser(app, 'user2@example.com');
      const user2Token = user2Result.token;

      // Create projects for both users
      const project2 = await createTestProject(prisma, user2Result.user.id, 'User 2 Project');
      const images2 = await Promise.all([
        createTestImage(prisma, project2.id, 'user2-image1.jpg'),
        createTestImage(prisma, project2.id, 'user2-image2.jpg')
      ]);

      // Add queue items for both users
      const queueItems1 = await createTestQueueItems(
        prisma,
        testImages.slice(0, 3).map(img => img.id),
        testProject.id,
        testUser.id
      );

      const queueItems2 = await createTestQueueItems(
        prisma,
        images2.map(img => img.id),
        project2.id,
        user2Result.user.id
      );

      // Concurrent cancellations by different users
      const cancellationPromises = [
        ...queueItems1.map(item =>
          request(app)
            .delete(`/api/queue/items/${item.id}`)
            .set('Authorization', `Bearer ${authToken}`)
        ),
        ...queueItems2.map(item =>
          request(app)
            .delete(`/api/queue/items/${item.id}`)
            .set('Authorization', `Bearer ${user2Token}`)
        )
      ];

      const results = await Promise.allSettled(cancellationPromises);

      // All cancellations should succeed
      results.forEach((result, index) => {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          expect(result.value.status).toBe(200);
        }
      });

      // Verify database state
      await dbVerifier.verifyQueueItemCount(testProject.id, 0);
      await dbVerifier.verifyQueueItemCount(project2.id, 0);
    });

    it('should handle same item being cancelled by multiple requests', async () => {
      // Add single item to queue
      const queueItems = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id
      );

      const queueItem = queueItems[0];

      // Multiple concurrent cancellation requests for same item
      const cancellationPromises = Array.from({ length: 5 }, () =>
        request(app)
          .delete(`/api/queue/items/${queueItem.id}`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const results = await Promise.allSettled(cancellationPromises);

      // First request should succeed (200), others should get 404 (item not found)
      const successfulCancellations = results.filter(
        result => result.status === 'fulfilled' &&
        (result as any).value.status === 200
      );

      const notFoundResponses = results.filter(
        result => result.status === 'fulfilled' &&
        (result as any).value.status === 404
      );

      expect(successfulCancellations).toHaveLength(1);
      expect(notFoundResponses.length).toBeGreaterThan(0);

      // Verify item is actually deleted
      await dbVerifier.verifyQueueItemStatus(queueItem.id, null);
    });

    it('should handle concurrent cancellation with status changes', async () => {
      // Add items to queue
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.slice(0, 3).map(img => img.id),
        testProject.id,
        testUser.id
      );

      // Start concurrent operations
      const operations = await Promise.allSettled([
        // Cancellation requests
        request(app)
          .delete(`/api/queue/items/${queueItems[0].id}`)
          .set('Authorization', `Bearer ${authToken}`),

        request(app)
          .delete(`/api/queue/items/${queueItems[1].id}`)
          .set('Authorization', `Bearer ${authToken}`),

        // Simulate status change to processing during cancellation
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          await prisma.segmentationQueue.update({
            where: { id: queueItems[2].id },
            data: {
              status: 'processing',
              startedAt: new Date()
            }
          });

          // Try to cancel processing item
          return request(app)
            .delete(`/api/queue/items/${queueItems[2].id}`)
            .set('Authorization', `Bearer ${authToken}`);
        })()
      ]);

      // First two should succeed, third should fail with 409
      expect(operations[0].status).toBe('fulfilled');
      expect(operations[1].status).toBe('fulfilled');
      expect(operations[2].status).toBe('fulfilled');

      if (operations[0].status === 'fulfilled') {
        expect((operations[0].value as any).status).toBe(200);
      }
      if (operations[1].status === 'fulfilled') {
        expect((operations[1].value as any).status).toBe(200);
      }
      if (operations[2].status === 'fulfilled') {
        expect((operations[2].value as any).status).toBe(409);
      }

      // Verify final state
      await dbVerifier.verifyQueueItemStatus(queueItems[0].id, null);
      await dbVerifier.verifyQueueItemStatus(queueItems[1].id, null);
      await dbVerifier.verifyQueueItemStatus(queueItems[2].id, 'processing');
    });
  });

  describe('Concurrent Batch Operations', () => {
    it('should handle multiple batch cancellations on same project', async () => {
      // Add large batch to queue
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.map(img => img.id),
        testProject.id,
        testUser.id,
        { batchId: 'batch-1' }
      );

      // Multiple concurrent project cancellation requests
      const cancellationPromises = Array.from({ length: 3 }, () =>
        request(app)
          .post(`/api/queue/projects/${testProject.id}/cancel`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const results = await Promise.allSettled(cancellationPromises);

      // All requests should complete successfully
      results.forEach(result => {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          expect((result.value as any).status).toBe(200);
        }
      });

      // At least one should have cancelled items
      const cancellationCounts = results
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as any).value.body.data.cancelledItems);

      const totalCancelled = cancellationCounts.reduce((sum, count) => sum + count, 0);
      expect(totalCancelled).toBe(testImages.length);

      // Verify all items are cancelled
      await dbVerifier.verifyQueueItemCount(testProject.id, 0);
    });

    it('should handle concurrent batch and individual cancellations', async () => {
      // Add items to queue
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.slice(0, 6).map(img => img.id),
        testProject.id,
        testUser.id,
        { batchId: 'mixed-batch' }
      );

      // Start mixed concurrent operations
      const operations = await Promise.allSettled([
        // Individual cancellations
        request(app)
          .delete(`/api/queue/items/${queueItems[0].id}`)
          .set('Authorization', `Bearer ${authToken}`),

        request(app)
          .delete(`/api/queue/items/${queueItems[1].id}`)
          .set('Authorization', `Bearer ${authToken}`),

        // Batch cancellation
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return request(app)
            .post(`/api/queue/projects/${testProject.id}/cancel`)
            .set('Authorization', `Bearer ${authToken}`);
        })(),

        // More individual cancellations
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return request(app)
            .delete(`/api/queue/items/${queueItems[2].id}`)
            .set('Authorization', `Bearer ${authToken}`);
        })()
      ]);

      // All operations should complete (some may get 404 if already cancelled)
      operations.forEach(operation => {
        expect(operation.status).toBe('fulfilled');
        if (operation.status === 'fulfilled') {
          expect([200, 404]).toContain((operation.value as any).status);
        }
      });

      // Final state should have no queue items
      await waitForCondition(async () => {
        const count = await prisma.segmentationQueue.count({
          where: { projectId: testProject.id }
        });
        return count === 0;
      }, 5000);
    });

    it('should handle concurrent batch cancellations by batch ID', async () => {
      // Create multiple batches
      const batch1Items = await createTestQueueItems(
        prisma,
        testImages.slice(0, 3).map(img => img.id),
        testProject.id,
        testUser.id,
        { batchId: 'concurrent-batch-1' }
      );

      const batch2Items = await createTestQueueItems(
        prisma,
        testImages.slice(3, 6).map(img => img.id),
        testProject.id,
        testUser.id,
        { batchId: 'concurrent-batch-2' }
      );

      // Concurrent batch cancellations
      const cancellationPromises = [
        request(app)
          .post(`/api/queue/batches/concurrent-batch-1/cancel`)
          .set('Authorization', `Bearer ${authToken}`),

        request(app)
          .post(`/api/queue/batches/concurrent-batch-2/cancel`)
          .set('Authorization', `Bearer ${authToken}`),

        // Duplicate requests
        request(app)
          .post(`/api/queue/batches/concurrent-batch-1/cancel`)
          .set('Authorization', `Bearer ${authToken}`)
      ];

      const results = await Promise.allSettled(cancellationPromises);

      // All should complete successfully
      results.forEach(result => {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          expect((result.value as any).status).toBe(200);
        }
      });

      // Verify final state
      const remainingItems = await dbVerifier.getAllQueueItems(testProject.id);
      expect(remainingItems).toHaveLength(4); // Items 6-9 should remain
    });
  });

  describe('Database Transaction Race Conditions', () => {
    it('should maintain consistency during concurrent database operations', async () => {
      // Add many items to queue
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.map(img => img.id),
        testProject.id,
        testUser.id
      );

      // Simulate concurrent database operations
      const operations = [
        // Cancellations
        ...queueItems.slice(0, 5).map(item =>
          request(app)
            .delete(`/api/queue/items/${item.id}`)
            .set('Authorization', `Bearer ${authToken}`)
        ),

        // Status updates (simulating processing)
        ...(async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return queueItems.slice(5, 8).map(item =>
            prisma.segmentationQueue.update({
              where: { id: item.id },
              data: {
                status: 'processing',
                startedAt: new Date()
              }
            })
          );
        })(),

        // Batch cancellation
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return request(app)
            .post(`/api/queue/projects/${testProject.id}/cancel`)
            .set('Authorization', `Bearer ${authToken}`);
        })()
      ];

      // Wait for all operations to complete
      await Promise.allSettled(operations.flat());

      // Wait for database to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify database consistency
      const remainingItems = await dbVerifier.getAllQueueItems(testProject.id);
      const images = await dbVerifier.getAllImages(testProject.id);

      // All remaining items should be in processing state
      remainingItems.forEach(item => {
        expect(item.status).toBe('processing');
      });

      // Images corresponding to cancelled items should have correct status
      images.forEach(image => {
        const hasQueueItem = remainingItems.some(item => item.imageId === image.id);
        if (!hasQueueItem) {
          expect(image.segmentationStatus).toBe('no_segmentation');
        }
      });
    });

    it('should handle deadlock scenarios gracefully', async () => {
      // Create items in specific order to potentially trigger deadlocks
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.slice(0, 5).map(img => img.id),
        testProject.id,
        testUser.id
      );

      // Create operations that might cause deadlocks
      const deadlockOperations = [
        // Cancel items in one order
        ...queueItems.map((item, index) =>
          (async () => {
            await new Promise(resolve => setTimeout(resolve, index * 10));
            return request(app)
              .delete(`/api/queue/items/${item.id}`)
              .set('Authorization', `Bearer ${authToken}`);
          })()
        ),

        // Update items in reverse order
        ...queueItems.reverse().map((item, index) =>
          (async () => {
            await new Promise(resolve => setTimeout(resolve, index * 15));
            return prisma.segmentationQueue.update({
              where: { id: item.id },
              data: {
                priority: index,
                updatedAt: new Date()
              }
            }).catch(() => {
              // Item might be deleted, ignore error
              return null;
            });
          })()
        )
      ];

      // All operations should complete without throwing deadlock errors
      const results = await Promise.allSettled(deadlockOperations);

      // Should not have any rejected promises due to deadlocks
      const deadlockErrors = results.filter(
        result => result.status === 'rejected' &&
        (result.reason.message?.includes('deadlock') ||
         result.reason.message?.includes('SQLITE_BUSY'))
      );

      expect(deadlockErrors).toHaveLength(0);
    });
  });

  describe('Resource Contention', () => {
    it('should handle high-concurrency cancellation load', async () => {
      // Create large number of queue items
      const largeImageSet = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          createTestImage(prisma, testProject.id, `load-test-${i}.jpg`)
        )
      );

      const queueItems = await createTestQueueItems(
        prisma,
        largeImageSet.map(img => img.id),
        testProject.id,
        testUser.id
      );

      // Create high concurrency load
      const concurrentRequests = queueItems.map((item, index) =>
        (async () => {
          // Stagger requests slightly
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

          return request(app)
            .delete(`/api/queue/items/${item.id}`)
            .set('Authorization', `Bearer ${authToken}`);
        })()
      );

      // Measure performance
      const startTime = Date.now();
      const results = await Promise.allSettled(concurrentRequests);
      const endTime = Date.now();

      // Should complete within reasonable time (10 seconds for 50 items)
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(10000);

      // Most requests should succeed
      const successfulRequests = results.filter(
        result => result.status === 'fulfilled' &&
        (result as any).value.status === 200
      );

      expect(successfulRequests.length).toBeGreaterThan(30);

      // Verify final state
      const remainingItems = await dbVerifier.getAllQueueItems(testProject.id);
      expect(remainingItems.length).toBeLessThan(20); // Most should be cancelled
    });

    it('should maintain performance under memory pressure', async () => {
      // Create operations that use significant memory
      const memoryIntensiveOperations = Array.from({ length: 100 }, (_, i) =>
        (async () => {
          // Create temporary data structures
          const largeArray = new Array(10000).fill(i);

          // Add item to queue
          const queueItems = await createTestQueueItems(
            prisma,
            [testImages[i % testImages.length].id],
            testProject.id,
            testUser.id,
            { batchId: `memory-test-${i}` }
          );

          // Immediately cancel it
          const cancelResult = await request(app)
            .delete(`/api/queue/items/${queueItems[0].id}`)
            .set('Authorization', `Bearer ${authToken}`);

          // Clean up large array
          largeArray.length = 0;

          return cancelResult;
        })()
      );

      // Should complete without memory errors
      const results = await Promise.allSettled(memoryIntensiveOperations);

      const errors = results.filter(result => result.status === 'rejected');
      expect(errors).toHaveLength(0);

      // Most operations should succeed
      const successful = results.filter(
        result => result.status === 'fulfilled' &&
        [200, 404].includes((result as any).value.status)
      );

      expect(successful.length).toBeGreaterThan(80);
    });
  });

  describe('Error Recovery', () => {
    it('should recover gracefully from partial system failures', async () => {
      // Add items to queue
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.slice(0, 5).map(img => img.id),
        testProject.id,
        testUser.id
      );

      // Mock partial database failures
      let failureCount = 0;
      const originalUpdate = prisma.segmentationQueue.update;

      vi.spyOn(prisma.segmentationQueue, 'update').mockImplementation(async (args) => {
        failureCount++;
        if (failureCount === 2 || failureCount === 4) {
          throw new Error('Simulated database failure');
        }
        return originalUpdate.call(prisma.segmentationQueue, args);
      });

      // Attempt concurrent cancellations
      const cancellationPromises = queueItems.map(item =>
        request(app)
          .delete(`/api/queue/items/${item.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .catch(error => ({ error: true, status: 500 }))
      );

      const results = await Promise.allSettled(cancellationPromises);

      // Should have mix of successes and failures
      const successes = results.filter(
        result => result.status === 'fulfilled' &&
        !(result as any).value.error
      );

      expect(successes.length).toBeGreaterThan(0);
      expect(successes.length).toBeLessThan(queueItems.length);

      // Restore original method
      vi.restoreAllMocks();

      // System should still be functional
      const healthCheck = await request(app)
        .get('/api/queue/health')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(healthCheck.body.success).toBe(true);
    });
  });
});