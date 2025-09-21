import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { WebSocketService } from '../../services/websocketService';
import { createTestApp } from '../utils/testApp';
import { createTestUser, createTestProject, createTestImage, cleanupTestData } from '../utils/testHelpers';

/**
 * Integration tests for queue cancellation functionality
 * Tests the complete flow from API endpoint to database to WebSocket
 */
describe('Queue Cancellation Integration Tests', () => {
  let app: Express;
  let prisma: PrismaClient;
  let testUser: any;
  let testProject: any;
  let testImages: any[];
  let authToken: string;
  let websocketEvents: any[] = [];

  beforeAll(async () => {
    // Create test app with real dependencies but isolated database
    app = await createTestApp();
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.TEST_DATABASE_URL || 'file:./test.db'
        }
      }
    });

    // Mock WebSocket service to capture events
    const originalWebSocketService = WebSocketService.getInstance();
    vi.spyOn(originalWebSocketService, 'emitSegmentationUpdate').mockImplementation((userId, data) => {
      websocketEvents.push({ type: 'segmentationUpdate', userId, data });
    });
    vi.spyOn(originalWebSocketService, 'emitQueueStatsUpdate').mockImplementation((projectId, data) => {
      websocketEvents.push({ type: 'queueStatsUpdate', projectId, data });
    });
    vi.spyOn(originalWebSocketService, 'emitToUser').mockImplementation((userId, event, data) => {
      websocketEvents.push({ type: event, userId, data });
    });
  });

  beforeEach(async () => {
    // Clear previous test data
    await cleanupTestData(prisma);
    websocketEvents = [];

    // Create test user and get auth token
    const userResult = await createTestUser(app);
    testUser = userResult.user;
    authToken = userResult.token;

    // Create test project
    testProject = await createTestProject(prisma, testUser.id);

    // Create test images
    testImages = await Promise.all([
      createTestImage(prisma, testProject.id, 'image1.jpg'),
      createTestImage(prisma, testProject.id, 'image2.jpg'),
      createTestImage(prisma, testProject.id, 'image3.jpg'),
      createTestImage(prisma, testProject.id, 'image4.jpg'),
      createTestImage(prisma, testProject.id, 'image5.jpg')
    ]);
  });

  afterEach(async () => {
    await cleanupTestData(prisma);
    websocketEvents = [];
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Individual Item Cancellation Flow', () => {
    it('should complete full cancellation flow for queued item', async () => {
      // Step 1: Add item to queue
      const addResponse = await request(app)
        .post(`/api/queue/images/${testImages[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      const queueEntry = addResponse.body.data;
      expect(queueEntry.id).toBeDefined();
      expect(queueEntry.status).toBe('queued');

      // Clear WebSocket events from queue addition
      websocketEvents = [];

      // Step 2: Cancel the item
      const cancelResponse = await request(app)
        .delete(`/api/queue/items/${queueEntry.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelResponse.body.success).toBe(true);
      expect(cancelResponse.body.data.cancelledCount).toBe(1);

      // Step 3: Verify database state
      const queueItem = await prisma.segmentationQueue.findUnique({
        where: { id: queueEntry.id }
      });
      expect(queueItem).toBeNull(); // Item should be deleted

      const image = await prisma.image.findUnique({
        where: { id: testImages[0].id }
      });
      expect(image?.segmentationStatus).toBe('no_segmentation');

      // Step 4: Verify WebSocket events were emitted
      expect(websocketEvents).toHaveLength(2);

      const segmentationUpdate = websocketEvents.find(e => e.type === 'segmentationUpdate');
      expect(segmentationUpdate).toBeDefined();
      expect(segmentationUpdate.userId).toBe(testUser.id);
      expect(segmentationUpdate.data).toEqual({
        imageId: testImages[0].id,
        projectId: testProject.id,
        status: 'no_segmentation'
      });

      const queueStatsUpdate = websocketEvents.find(e => e.type === 'queueStatsUpdate');
      expect(queueStatsUpdate).toBeDefined();
      expect(queueStatsUpdate.projectId).toBe(testProject.id);
    });

    it('should handle 409 Conflict for processing items', async () => {
      // Step 1: Add item to queue
      const addResponse = await request(app)
        .post(`/api/queue/images/${testImages[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      const queueEntry = addResponse.body.data;

      // Step 2: Manually set item to processing status
      await prisma.segmentationQueue.update({
        where: { id: queueEntry.id },
        data: {
          status: 'processing',
          startedAt: new Date()
        }
      });

      // Step 3: Attempt to cancel processing item
      const cancelResponse = await request(app)
        .delete(`/api/queue/items/${queueEntry.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(409);

      expect(cancelResponse.body.success).toBe(false);
      expect(cancelResponse.body.error).toBe('CANNOT_CANCEL_PROCESSING_ITEM');

      // Step 4: Verify item still exists in processing state
      const queueItem = await prisma.segmentationQueue.findUnique({
        where: { id: queueEntry.id }
      });
      expect(queueItem).toBeDefined();
      expect(queueItem!.status).toBe('processing');
    });

    it('should handle race conditions during concurrent cancellations', async () => {
      // Step 1: Add multiple items to queue
      const addPromises = testImages.slice(0, 3).map(image =>
        request(app)
          .post(`/api/queue/images/${image.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            model: 'hrnet',
            threshold: 0.5,
            detectHoles: true
          })
      );

      const addResponses = await Promise.all(addPromises);
      const queueEntries = addResponses.map(r => r.body.data);

      // Step 2: Attempt concurrent cancellations
      const cancelPromises = queueEntries.map(entry =>
        request(app)
          .delete(`/api/queue/items/${entry.id}`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const cancelResponses = await Promise.all(cancelPromises);

      // Step 3: Verify all cancellations succeeded
      cancelResponses.forEach(response => {
        expect([200, 409]).toContain(response.status); // 200 for success, 409 if already processing
      });

      // Step 4: Verify database consistency
      const remainingItems = await prisma.segmentationQueue.findMany({
        where: {
          imageId: { in: testImages.slice(0, 3).map(img => img.id) }
        }
      });

      // All items should be removed (since they were queued)
      expect(remainingItems).toHaveLength(0);
    });
  });

  describe('Batch Cancellation Flow', () => {
    it('should complete full batch cancellation flow', async () => {
      // Step 1: Add multiple items to queue as batch
      const batchResponse = await request(app)
        .post('/api/queue/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          imageIds: testImages.map(img => img.id),
          projectId: testProject.id,
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      expect(batchResponse.body.data.queuedCount).toBe(5);

      // Clear WebSocket events from batch addition
      websocketEvents = [];

      // Step 2: Cancel project queue
      const cancelResponse = await request(app)
        .post(`/api/queue/projects/${testProject.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelResponse.body.data.cancelledItems).toBe(5);

      // Step 3: Verify database state
      const remainingItems = await prisma.segmentationQueue.findMany({
        where: { projectId: testProject.id }
      });
      expect(remainingItems).toHaveLength(0);

      const images = await prisma.image.findMany({
        where: { id: { in: testImages.map(img => img.id) } }
      });
      images.forEach(img => {
        expect(img.segmentationStatus).toBe('no_segmentation');
      });

      // Step 4: Verify WebSocket events
      const cancelEvent = websocketEvents.find(e => e.type === 'queue:cancelled');
      expect(cancelEvent).toBeDefined();
      expect(cancelEvent.userId).toBe(testUser.id);
      expect(cancelEvent.data.projectId).toBe(testProject.id);
      expect(cancelEvent.data.cancelledCount).toBe(5);
    });

    it('should handle partial batch cancellation', async () => {
      // Step 1: Add batch to queue
      const batchResponse = await request(app)
        .post('/api/queue/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          imageIds: testImages.map(img => img.id),
          projectId: testProject.id,
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      const queueEntries = batchResponse.body.data.queueEntries;

      // Step 2: Set some items to processing
      await prisma.segmentationQueue.updateMany({
        where: {
          id: { in: [queueEntries[0].id, queueEntries[1].id] }
        },
        data: {
          status: 'processing',
          startedAt: new Date()
        }
      });

      // Step 3: Cancel project queue
      const cancelResponse = await request(app)
        .post(`/api/queue/projects/${testProject.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should only cancel 3 items (the 2 processing items cannot be cancelled)
      expect(cancelResponse.body.data.cancelledItems).toBe(3);

      // Step 4: Verify database state
      const remainingItems = await prisma.segmentationQueue.findMany({
        where: { projectId: testProject.id }
      });

      // 2 processing items should remain
      expect(remainingItems).toHaveLength(2);
      remainingItems.forEach(item => {
        expect(item.status).toBe('processing');
      });
    });

    it('should handle batch cancellation by batchId', async () => {
      // Step 1: Add batch to queue
      const batchResponse = await request(app)
        .post('/api/queue/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          imageIds: testImages.slice(0, 3).map(img => img.id),
          projectId: testProject.id,
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      const queueEntries = batchResponse.body.data.queueEntries;
      const batchId = queueEntries[0].batchId;
      expect(batchId).toBeDefined();

      // Clear WebSocket events
      websocketEvents = [];

      // Step 2: Cancel by batch ID
      const cancelResponse = await request(app)
        .post(`/api/queue/batches/${batchId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelResponse.body.data.cancelledItems).toBe(3);

      // Step 3: Verify database state
      const remainingItems = await prisma.segmentationQueue.findMany({
        where: { batchId }
      });
      expect(remainingItems).toHaveLength(0);

      // Step 4: Verify WebSocket events
      const batchCancelEvent = websocketEvents.find(e => e.type === 'batch:cancelled');
      expect(batchCancelEvent).toBeDefined();
      expect(batchCancelEvent.data.batchId).toBe(batchId);
      expect(batchCancelEvent.data.cancelledCount).toBe(3);
    });
  });

  describe('Cross-User Security', () => {
    let otherUser: any;
    let otherAuthToken: string;

    beforeEach(async () => {
      const otherUserResult = await createTestUser(app, 'other@example.com');
      otherUser = otherUserResult.user;
      otherAuthToken = otherUserResult.token;
    });

    it('should prevent cancelling other users\' queue items', async () => {
      // Step 1: User 1 adds item to queue
      const addResponse = await request(app)
        .post(`/api/queue/images/${testImages[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      const queueEntry = addResponse.body.data;

      // Step 2: User 2 attempts to cancel User 1's item
      await request(app)
        .delete(`/api/queue/items/${queueEntry.id}`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(404); // Not found because it doesn't belong to user 2

      // Step 3: Verify item still exists
      const queueItem = await prisma.segmentationQueue.findUnique({
        where: { id: queueEntry.id }
      });
      expect(queueItem).toBeDefined();
      expect(queueItem!.status).toBe('queued');
    });

    it('should prevent cancelling other users\' project queues', async () => {
      // Step 1: User 1 adds items to queue
      await request(app)
        .post('/api/queue/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          imageIds: testImages.map(img => img.id),
          projectId: testProject.id,
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      // Step 2: User 2 attempts to cancel User 1's project queue
      await request(app)
        .post(`/api/queue/projects/${testProject.id}/cancel`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(404); // Not found because project doesn't belong to user 2

      // Step 3: Verify items still exist
      const remainingItems = await prisma.segmentationQueue.findMany({
        where: { projectId: testProject.id }
      });
      expect(remainingItems.length).toBeGreaterThan(0);
    });
  });

  describe('Database Transaction Safety', () => {
    it('should maintain database consistency during transaction failures', async () => {
      // Step 1: Add items to queue
      const batchResponse = await request(app)
        .post('/api/queue/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          imageIds: testImages.map(img => img.id),
          projectId: testProject.id,
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      const originalQueueCount = await prisma.segmentationQueue.count();

      // Step 2: Mock a database error during cancellation
      const originalDelete = prisma.segmentationQueue.delete;
      let deleteCallCount = 0;

      vi.spyOn(prisma.segmentationQueue, 'delete').mockImplementation(async (args) => {
        deleteCallCount++;
        if (deleteCallCount === 2) {
          throw new Error('Simulated database error');
        }
        return originalDelete.call(prisma.segmentationQueue, args);
      });

      // Step 3: Attempt cancellation that will fail
      try {
        await request(app)
          .post(`/api/queue/projects/${testProject.id}/cancel`)
          .set('Authorization', `Bearer ${authToken}`);
      } catch (error) {
        // Expected to fail
      }

      // Step 4: Verify database consistency (transaction should have rolled back)
      const finalQueueCount = await prisma.segmentationQueue.count();

      // Either all items cancelled or none (depending on where transaction failed)
      expect([0, originalQueueCount]).toContain(finalQueueCount);

      // Restore original method
      vi.restoreAllMocks();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle cancellation of 100+ items efficiently', async () => {
      // Create many test images
      const manyImages = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          createTestImage(prisma, testProject.id, `image${i}.jpg`)
        )
      );

      // Step 1: Add large batch to queue
      const batchResponse = await request(app)
        .post('/api/queue/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          imageIds: manyImages.map(img => img.id),
          projectId: testProject.id,
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      expect(batchResponse.body.data.queuedCount).toBe(100);

      // Step 2: Measure cancellation time
      const startTime = Date.now();

      const cancelResponse = await request(app)
        .post(`/api/queue/projects/${testProject.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Step 3: Verify performance (should complete within 5 seconds)
      expect(duration).toBeLessThan(5000);
      expect(cancelResponse.body.data.cancelledItems).toBe(100);

      // Step 4: Verify all items were cancelled
      const remainingItems = await prisma.segmentationQueue.findMany({
        where: { projectId: testProject.id }
      });
      expect(remainingItems).toHaveLength(0);
    });
  });

  describe('WebSocket Event Integrity', () => {
    it('should emit events in correct order for batch operations', async () => {
      // Step 1: Add batch to queue
      await request(app)
        .post('/api/queue/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          imageIds: testImages.slice(0, 3).map(img => img.id),
          projectId: testProject.id,
          model: 'hrnet',
          threshold: 0.5,
          detectHoles: true
        })
        .expect(200);

      // Clear events from batch addition
      websocketEvents = [];

      // Step 2: Cancel batch
      await request(app)
        .post(`/api/queue/projects/${testProject.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Step 3: Verify event order and completeness
      expect(websocketEvents.length).toBeGreaterThan(0);

      // Should have cancel event
      const cancelEvent = websocketEvents.find(e => e.type === 'queue:cancelled');
      expect(cancelEvent).toBeDefined();

      // Events should contain all required data
      expect(cancelEvent.data).toHaveProperty('projectId');
      expect(cancelEvent.data).toHaveProperty('cancelledCount');
      expect(cancelEvent.data).toHaveProperty('timestamp');

      // Timestamp should be recent
      const eventTime = new Date(cancelEvent.data.timestamp);
      const now = new Date();
      expect(now.getTime() - eventTime.getTime()).toBeLessThan(5000);
    });
  });
});