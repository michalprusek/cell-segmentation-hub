import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { WebSocketService } from '../../services/websocketService';
import { createTestApp } from '../utils/testApp';
import {
  createTestUser,
  createTestProject,
  createTestImage,
  createTestQueueItems,
  cleanupTestData,
  waitForCondition,
  MockWebSocketEvents
} from '../utils/testHelpers';

/**
 * WebSocket synchronization tests for queue cancellation
 * Tests real-time communication and event consistency
 */
describe('Queue Cancellation WebSocket Integration', () => {
  let app: Express;
  let prisma: PrismaClient;
  let testUser: any;
  let testProject: any;
  let testImages: any[];
  let authToken: string;
  let mockWebSocketEvents: MockWebSocketEvents;
  let originalWebSocketService: WebSocketService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.TEST_DATABASE_URL || 'file:./test.db'
        }
      }
    });

    mockWebSocketEvents = new MockWebSocketEvents();
    originalWebSocketService = WebSocketService.getInstance();
  });

  beforeEach(async () => {
    await cleanupTestData(prisma);
    mockWebSocketEvents.clear();

    // Mock WebSocket service methods
    vi.spyOn(originalWebSocketService, 'emitSegmentationUpdate').mockImplementation(
      (userId, data) => {
        mockWebSocketEvents.emit('segmentationUpdate', { userId, data });
      }
    );

    vi.spyOn(originalWebSocketService, 'emitQueueStatsUpdate').mockImplementation(
      (projectId, data) => {
        mockWebSocketEvents.emit('queueStatsUpdate', { projectId, data });
      }
    );

    vi.spyOn(originalWebSocketService, 'emitToUser').mockImplementation(
      (userId, event, data) => {
        mockWebSocketEvents.emit(event, { userId, data });
      }
    );

    vi.spyOn(originalWebSocketService, 'emitParallelProcessingStatus').mockImplementation(
      (status) => {
        mockWebSocketEvents.emit('parallelProcessingStatus', status);
      }
    );

    const userResult = await createTestUser(app);
    testUser = userResult.user;
    authToken = userResult.token;

    testProject = await createTestProject(prisma, testUser.id);

    testImages = await Promise.all([
      createTestImage(prisma, testProject.id, 'ws1.jpg'),
      createTestImage(prisma, testProject.id, 'ws2.jpg'),
      createTestImage(prisma, testProject.id, 'ws3.jpg'),
      createTestImage(prisma, testProject.id, 'ws4.jpg'),
      createTestImage(prisma, testProject.id, 'ws5.jpg')
    ]);
  });

  afterEach(async () => {
    await cleanupTestData(prisma);
    mockWebSocketEvents.clear();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Individual Item Cancellation Events', () => {
    it('should emit segmentationUpdate event for individual cancellation', async () => {
      // Add item to queue
      const queueItems = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      // Cancel the item
      await request(app)
        .delete(`/api/queue/items/${queueItems[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Wait for WebSocket events
      const segmentationEvent = await mockWebSocketEvents.waitForEvent('segmentationUpdate');

      expect(segmentationEvent.data.userId).toBe(testUser.id);
      expect(segmentationEvent.data.data).toEqual({
        imageId: testImages[0].id,
        projectId: testProject.id,
        status: 'no_segmentation'
      });
    });

    it('should emit queueStatsUpdate event after cancellation', async () => {
      // Add multiple items to queue
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.slice(0, 3).map(img => img.id),
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      // Cancel one item
      await request(app)
        .delete(`/api/queue/items/${queueItems[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Wait for queue stats event
      const statsEvent = await mockWebSocketEvents.waitForEvent('queueStatsUpdate');

      expect(statsEvent.data.projectId).toBe(testProject.id);
      expect(statsEvent.data.data).toHaveProperty('queued');
      expect(statsEvent.data.data).toHaveProperty('processing');
      expect(statsEvent.data.data).toHaveProperty('total');

      // Stats should reflect the cancellation
      expect(statsEvent.data.data.total).toBe(2); // 2 remaining items
    });

    it('should emit events in correct order', async () => {
      const queueItems = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      await request(app)
        .delete(`/api/queue/items/${queueItems[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Wait for both events
      await mockWebSocketEvents.waitForEvent('segmentationUpdate');
      await mockWebSocketEvents.waitForEvent('queueStatsUpdate');

      const allEvents = mockWebSocketEvents.getEvents();

      // Should have at least segmentationUpdate and queueStatsUpdate
      expect(allEvents.length).toBeGreaterThanOrEqual(2);

      const segmentationUpdateIndex = allEvents.findIndex(e => e.event === 'segmentationUpdate');
      const queueStatsUpdateIndex = allEvents.findIndex(e => e.event === 'queueStatsUpdate');

      expect(segmentationUpdateIndex).toBeGreaterThanOrEqual(0);
      expect(queueStatsUpdateIndex).toBeGreaterThanOrEqual(0);

      // Events should be emitted in quick succession
      const timeDiff = allEvents[queueStatsUpdateIndex].timestamp.getTime() -
                      allEvents[segmentationUpdateIndex].timestamp.getTime();
      expect(timeDiff).toBeLessThan(1000); // Within 1 second
    });

    it('should not emit events for failed cancellations', async () => {
      // Add item and set it to processing
      const queueItems = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id,
        { status: 'processing' }
      );

      mockWebSocketEvents.clear();

      // Attempt to cancel processing item (should fail)
      await request(app)
        .delete(`/api/queue/items/${queueItems[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(409);

      // Wait a bit to ensure no events are emitted
      await new Promise(resolve => setTimeout(resolve, 500));

      const events = mockWebSocketEvents.getEvents();
      expect(events).toHaveLength(0);
    });
  });

  describe('Batch Cancellation Events', () => {
    it('should emit queue:cancelled event for project cancellation', async () => {
      // Add batch to queue
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.map(img => img.id),
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      // Cancel project queue
      await request(app)
        .post(`/api/queue/projects/${testProject.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Wait for batch cancellation event
      const cancelEvent = await mockWebSocketEvents.waitForEvent('queue:cancelled');

      expect(cancelEvent.data.userId).toBe(testUser.id);
      expect(cancelEvent.data.data).toHaveProperty('projectId', testProject.id);
      expect(cancelEvent.data.data).toHaveProperty('cancelledCount', testImages.length);
      expect(cancelEvent.data.data).toHaveProperty('timestamp');

      // Timestamp should be recent
      const eventTime = new Date(cancelEvent.data.data.timestamp);
      const now = new Date();
      expect(now.getTime() - eventTime.getTime()).toBeLessThan(5000);
    });

    it('should emit batch:cancelled event for batch ID cancellation', async () => {
      const batchId = 'test-batch-123';

      // Add batch to queue
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.slice(0, 3).map(img => img.id),
        testProject.id,
        testUser.id,
        { batchId }
      );

      mockWebSocketEvents.clear();

      // Cancel by batch ID
      await request(app)
        .post(`/api/queue/batches/${batchId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Wait for batch cancellation event
      const batchCancelEvent = await mockWebSocketEvents.waitForEvent('batch:cancelled');

      expect(batchCancelEvent.data.userId).toBe(testUser.id);
      expect(batchCancelEvent.data.data).toHaveProperty('batchId', batchId);
      expect(batchCancelEvent.data.data).toHaveProperty('cancelledCount', 3);
      expect(batchCancelEvent.data.data).toHaveProperty('timestamp');
    });

    it('should handle partial batch cancellation events correctly', async () => {
      // Add batch with mixed statuses
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.map(img => img.id),
        testProject.id,
        testUser.id
      );

      // Set some items to processing
      await prisma.segmentationQueue.updateMany({
        where: {
          id: { in: [queueItems[0].id, queueItems[1].id] }
        },
        data: {
          status: 'processing',
          startedAt: new Date()
        }
      });

      mockWebSocketEvents.clear();

      // Cancel project queue
      await request(app)
        .post(`/api/queue/projects/${testProject.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Wait for cancellation event
      const cancelEvent = await mockWebSocketEvents.waitForEvent('queue:cancelled');

      // Should only cancel the queued items (not processing ones)
      expect(cancelEvent.data.data.cancelledCount).toBe(3); // 5 total - 2 processing
    });
  });

  describe('Multi-User Event Isolation', () => {
    let user2: any;
    let user2Token: string;
    let project2: any;

    beforeEach(async () => {
      const user2Result = await createTestUser(app, 'user2@example.com');
      user2 = user2Result.user;
      user2Token = user2Result.token;

      project2 = await createTestProject(prisma, user2.id, 'User 2 Project');
    });

    it('should only emit events to correct users', async () => {
      // Add items for both users
      const user1Items = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id
      );

      const user2Images = await Promise.all([
        createTestImage(prisma, project2.id, 'user2-image1.jpg')
      ]);

      const user2Items = await createTestQueueItems(
        prisma,
        [user2Images[0].id],
        project2.id,
        user2.id
      );

      mockWebSocketEvents.clear();

      // User 1 cancels their item
      await request(app)
        .delete(`/api/queue/items/${user1Items[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Wait for events
      const segmentationEvent = await mockWebSocketEvents.waitForEvent('segmentationUpdate');

      // Event should be for user 1 only
      expect(segmentationEvent.data.userId).toBe(testUser.id);
      expect(segmentationEvent.data.data.imageId).toBe(testImages[0].id);

      // User 2 cancels their item
      await request(app)
        .delete(`/api/queue/items/${user2Items[0].id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);

      // Wait for user 2's event
      await new Promise(resolve => setTimeout(resolve, 100));

      const allEvents = mockWebSocketEvents.getEvents('segmentationUpdate');
      expect(allEvents).toHaveLength(2);

      // Second event should be for user 2
      const user2Event = allEvents[1];
      expect(user2Event.data.userId).toBe(user2.id);
      expect(user2Event.data.data.imageId).toBe(user2Images[0].id);
    });

    it('should isolate project-specific events', async () => {
      // Add items to both projects
      const user1Items = await createTestQueueItems(
        prisma,
        testImages.slice(0, 2).map(img => img.id),
        testProject.id,
        testUser.id
      );

      const user2Images = await Promise.all([
        createTestImage(prisma, project2.id, 'user2-image1.jpg'),
        createTestImage(prisma, project2.id, 'user2-image2.jpg')
      ]);

      const user2Items = await createTestQueueItems(
        prisma,
        user2Images.map(img => img.id),
        project2.id,
        user2.id
      );

      mockWebSocketEvents.clear();

      // Cancel user 1's project
      await request(app)
        .post(`/api/queue/projects/${testProject.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const cancelEvent = await mockWebSocketEvents.waitForEvent('queue:cancelled');

      expect(cancelEvent.data.data.projectId).toBe(testProject.id);
      expect(cancelEvent.data.data.cancelledCount).toBe(2);

      // User 2's items should be unaffected
      const remainingUser2Items = await prisma.segmentationQueue.findMany({
        where: { projectId: project2.id }
      });
      expect(remainingUser2Items).toHaveLength(2);
    });
  });

  describe('Event Timing and Ordering', () => {
    it('should emit events immediately after successful cancellation', async () => {
      const queueItems = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      const startTime = Date.now();

      await request(app)
        .delete(`/api/queue/items/${queueItems[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const segmentationEvent = await mockWebSocketEvents.waitForEvent('segmentationUpdate');
      const eventTime = segmentationEvent.timestamp.getTime();

      // Event should be emitted within 100ms of the API call
      expect(eventTime - startTime).toBeLessThan(100);
    });

    it('should maintain event ordering during concurrent cancellations', async () => {
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.slice(0, 3).map(img => img.id),
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      // Concurrent cancellations
      const cancellationPromises = queueItems.map((item, index) =>
        (async () => {
          await new Promise(resolve => setTimeout(resolve, index * 50));
          return request(app)
            .delete(`/api/queue/items/${item.id}`)
            .set('Authorization', `Bearer ${authToken}`);
        })()
      );

      await Promise.all(cancellationPromises);

      // Wait for all events
      await new Promise(resolve => setTimeout(resolve, 500));

      const segmentationEvents = mockWebSocketEvents.getEvents('segmentationUpdate');
      expect(segmentationEvents.length).toBeGreaterThanOrEqual(3);

      // Events should be in chronological order
      for (let i = 1; i < segmentationEvents.length; i++) {
        expect(segmentationEvents[i].timestamp.getTime())
          .toBeGreaterThanOrEqual(segmentationEvents[i - 1].timestamp.getTime());
      }
    });

    it('should handle event backlog during high load', async () => {
      // Create many items
      const manyImages = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          createTestImage(prisma, testProject.id, `load-test-${i}.jpg`)
        )
      );

      const queueItems = await createTestQueueItems(
        prisma,
        manyImages.map(img => img.id),
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      // Rapid concurrent cancellations
      const cancellationPromises = queueItems.map(item =>
        request(app)
          .delete(`/api/queue/items/${item.id}`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      await Promise.allSettled(cancellationPromises);

      // Wait for all events to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      const segmentationEvents = mockWebSocketEvents.getEvents('segmentationUpdate');

      // Should have emitted events for most cancellations
      expect(segmentationEvents.length).toBeGreaterThan(15);

      // All events should have valid data
      segmentationEvents.forEach(event => {
        expect(event.data.userId).toBe(testUser.id);
        expect(event.data.data).toHaveProperty('imageId');
        expect(event.data.data).toHaveProperty('projectId', testProject.id);
        expect(event.data.data).toHaveProperty('status', 'no_segmentation');
      });
    });
  });

  describe('Event Reliability', () => {
    it('should retry event emission on failure', async () => {
      const queueItems = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id
      );

      // Mock failure then success
      let emitCallCount = 0;
      vi.spyOn(originalWebSocketService, 'emitSegmentationUpdate').mockImplementation(
        (userId, data) => {
          emitCallCount++;
          if (emitCallCount === 1) {
            throw new Error('WebSocket emission failed');
          }
          mockWebSocketEvents.emit('segmentationUpdate', { userId, data });
        }
      );

      await request(app)
        .delete(`/api/queue/items/${queueItems[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should still succeed despite initial failure
      const segmentationEvent = await mockWebSocketEvents.waitForEvent('segmentationUpdate');
      expect(segmentationEvent.data.userId).toBe(testUser.id);
    });

    it('should handle WebSocket service unavailability gracefully', async () => {
      const queueItems = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id
      );

      // Mock WebSocket service as unavailable
      vi.spyOn(originalWebSocketService, 'emitSegmentationUpdate').mockImplementation(() => {
        throw new Error('WebSocket service unavailable');
      });

      // API should still succeed even if WebSocket fails
      const response = await request(app)
        .delete(`/api/queue/items/${queueItems[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Database should still be updated correctly
      const queueItem = await prisma.segmentationQueue.findUnique({
        where: { id: queueItems[0].id }
      });
      expect(queueItem).toBeNull();

      const image = await prisma.image.findUnique({
        where: { id: testImages[0].id }
      });
      expect(image?.segmentationStatus).toBe('no_segmentation');
    });
  });

  describe('Event Data Integrity', () => {
    it('should include all required fields in events', async () => {
      const queueItems = await createTestQueueItems(
        prisma,
        [testImages[0].id],
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      await request(app)
        .delete(`/api/queue/items/${queueItems[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const segmentationEvent = await mockWebSocketEvents.waitForEvent('segmentationUpdate');
      const queueStatsEvent = await mockWebSocketEvents.waitForEvent('queueStatsUpdate');

      // Segmentation event validation
      expect(segmentationEvent.data).toHaveProperty('userId');
      expect(segmentationEvent.data).toHaveProperty('data');
      expect(segmentationEvent.data.data).toHaveProperty('imageId');
      expect(segmentationEvent.data.data).toHaveProperty('projectId');
      expect(segmentationEvent.data.data).toHaveProperty('status');

      // Queue stats event validation
      expect(queueStatsEvent.data).toHaveProperty('projectId');
      expect(queueStatsEvent.data).toHaveProperty('data');
      expect(queueStatsEvent.data.data).toHaveProperty('queued');
      expect(queueStatsEvent.data.data).toHaveProperty('processing');
      expect(queueStatsEvent.data.data).toHaveProperty('total');

      // Data types validation
      expect(typeof segmentationEvent.data.userId).toBe('string');
      expect(typeof segmentationEvent.data.data.imageId).toBe('string');
      expect(typeof queueStatsEvent.data.data.queued).toBe('number');
    });

    it('should maintain data consistency across multiple events', async () => {
      const queueItems = await createTestQueueItems(
        prisma,
        testImages.slice(0, 3).map(img => img.id),
        testProject.id,
        testUser.id
      );

      mockWebSocketEvents.clear();

      // Cancel all items
      for (const item of queueItems) {
        await request(app)
          .delete(`/api/queue/items/${item.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
      }

      // Wait for all events
      await new Promise(resolve => setTimeout(resolve, 500));

      const segmentationEvents = mockWebSocketEvents.getEvents('segmentationUpdate');
      const queueStatsEvents = mockWebSocketEvents.getEvents('queueStatsUpdate');

      // Should have events for all cancellations
      expect(segmentationEvents).toHaveLength(3);
      expect(queueStatsEvents).toHaveLength(3);

      // Queue stats should show decreasing totals
      const statsTotals = queueStatsEvents.map(e => e.data.data.total);
      expect(statsTotals).toEqual([2, 1, 0]); // Decreasing order
    });
  });
});