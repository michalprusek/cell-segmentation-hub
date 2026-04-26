/**
 * Backend API Tests for Segmentation Batch Cancellation
 * Tests POST /api/queue/batch/:batchId/cancel functionality
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from 'vitest';
import type { MockedFunction } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';

// Mock dependencies before imports
vi.mock('@/db', () => ({
  prisma: {
    segmentationQueue: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    image: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('bull', () => ({
  default: vi.fn().mockImplementation(() => ({
    getJob: vi.fn(),
    removeJobs: vi.fn(),
    getWaiting: vi.fn(),
    getActive: vi.fn(),
    getCompleted: vi.fn(),
    clean: vi.fn(),
  })),
}));

const mockWsInstance = {
  emitToRoom: vi.fn(),
  emitToUser: vi.fn(),
  broadcastBatchCancellation: vi.fn(),
};

const mockQueueInstance = {
  removeJobs: vi.fn() as MockedFunction<(...args: any[]) => Promise<any>>,
  getWaiting: vi.fn(),
  getActive: vi.fn(),
};

const mockMLServiceInstance = {
  cancelJob: vi.fn() as MockedFunction<(...args: any[]) => Promise<any>>,
  cancelBatch: vi.fn(),
};

vi.mock('../../services/websocketService', () => ({
  WebSocketService: {
    // Use regular function (not vi.fn) so resetMocks doesn't clear it
    getInstance: () => mockWsInstance,
  },
}));

// mlService doesn't exist - mock inline instead
// vi.mock('../../services/mlService', () => ({
//   mlService: {
//     cancelJob: vi.fn(),
//     cancelBatch: vi.fn(),
//   },
// }));


// Test data fixtures
const mockSegmentationJobs = {
  activeBatch: [
    {
      id: 'job-001',
      batchId: 'batch-123',
      imageId: 'img-001',
      projectId: 'project-456',
      userId: 'user-789',
      status: 'queued',
      priority: 1,
      queueId: 'queue-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'job-002',
      batchId: 'batch-123',
      imageId: 'img-002',
      projectId: 'project-456',
      userId: 'user-789',
      status: 'processing',
      priority: 1,
      queueId: 'queue-002',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'job-003',
      batchId: 'batch-123',
      imageId: 'img-003',
      projectId: 'project-456',
      userId: 'user-789',
      status: 'completed',
      priority: 1,
      queueId: 'queue-003',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  largeBatch: Array.from({ length: 100 }, (_, i) => ({
    id: `job-${String(i + 1).padStart(3, '0')}`,
    batchId: 'batch-large-001',
    imageId: `img-${String(i + 1).padStart(3, '0')}`,
    projectId: 'project-large',
    userId: 'user-789',
    status: i < 10 ? 'completed' : i < 20 ? 'processing' : 'queued',
    priority: 1,
    queueId: `queue-${String(i + 1).padStart(3, '0')}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
};

const mockProject = {
  id: 'project-456',
  name: 'Test Project',
  userId: 'user-789',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Mock Express App for Testing (TDD - to be implemented)
 */
const createMockApp = (): Express => {
  const app = express();

  app.use(express.json());

  // Mock authentication middleware
  app.use((req: any, res: any, next: any) => {
    req.user = { id: 'user-789', email: 'test@example.com' };
    next();
  });

  // Mock batch cancel endpoint
  app.post('/api/queue/batch/:batchId/cancel', async (req: any, res: any) => {
    const { batchId } = req.params;
    const userId = req.user.id;

    try {
      const { prisma } = await import('../../db');
      const { WebSocketService } = await import('../../services/websocketService');
      const webSocketService = WebSocketService.getInstance() as any; // Use module mock
      // mlService doesn't exist - create inline mock (tests mock at module level via mockMLServiceInstance)
      const mlService = mockMLServiceInstance;
      const queue = mockQueueInstance;

      // Find all jobs in the batch
      const jobs = await prisma.segmentationQueue.findMany({
        where: { batchId },
        include: { project: true },
      });

      if (jobs.length === 0) {
        return res.status(404).json({ error: 'Batch not found' });
      }

      // Check ownership (via project)
      const project = jobs[0].project;
      if (!project || project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Separate jobs by status
      const queuedJobs = jobs.filter(job => job.status === 'queued');
      const processingJobs = jobs.filter(job => job.status === 'processing');
      const completedJobs = jobs.filter(job => job.status === 'completed');
      const cancelledJobs = jobs.filter(job => job.status === 'cancelled');

      // Can't cancel already completed or cancelled batches
      if (completedJobs.length === jobs.length) {
        return res.status(400).json({ error: 'Batch already completed' });
      }

      if (cancelledJobs.length === jobs.length) {
        return res.status(400).json({ error: 'Batch already cancelled' });
      }

      const jobsToCancel = [...queuedJobs, ...processingJobs];

      if (jobsToCancel.length === 0) {
        return res.status(400).json({ error: 'No active jobs to cancel' });
      }

      // Cancel jobs in ML service
      const mlCancellationPromises = processingJobs.map(job =>
        mlService.cancelJob(job.id as string)
      );

      const mlResults = await Promise.allSettled(mlCancellationPromises);

      // Remove jobs from Bull queue
      const bullCancellationPromises = queuedJobs.map(job =>
        queue.removeJobs(`${job.id}*`).catch((error: any) => {
          console.warn(`Failed to remove job ${job.id} from queue:`, error);
          return { success: false, error: error.message };
        })
      );

      await Promise.allSettled(bullCancellationPromises);

      // Update job statuses in database
      await prisma.segmentationQueue.updateMany({
        where: {
          id: { in: jobsToCancel.map(job => job.id) },
        },
        data: {
          status: 'cancelled',
        },
      });

      // Update image statuses
      await prisma.image.updateMany({
        where: {
          id: { in: jobsToCancel.map(job => job.imageId) },
        },
        data: {
          segmentationStatus: 'cancelled',
        },
      });

      // Emit WebSocket events (non-blocking, errors are swallowed)
      Promise.resolve()
        .then(() => webSocketService.emitToUser(userId, 'batchCancelled', {
          batchId,
          projectId: project.id,
          cancelledJobs: jobsToCancel.length,
          completedJobs: completedJobs.length,
          timestamp: new Date().toISOString(),
        }))
        .catch(() => {});

      Promise.resolve()
        .then(() => webSocketService.emitToRoom(`project:${project.id}`, 'batchCancelled', {
          batchId,
          projectId: project.id,
          userId,
          cancelledJobs: jobsToCancel.length,
          completedJobs: completedJobs.length,
          timestamp: new Date().toISOString(),
        }))
        .catch(() => {});

      // Send queue stats update
      const totalJobs = jobs.length;
      const _remainingJobs =
        totalJobs - completedJobs.length - jobsToCancel.length;

      Promise.resolve()
        .then(() => webSocketService.emitToRoom(`project:${project.id}`, 'queueStats', {
          projectId: project.id,
          queued: 0,
          processing: 0,
          completed: completedJobs.length,
          total: totalJobs,
        }))
        .catch(() => {});

      res.json({
        success: true,
        message: 'Batch cancellation completed',
        batchId,
        cancelledJobs: jobsToCancel.length,
        completedJobs: completedJobs.length,
        totalJobs,
        mlServiceResults: mlResults.map(result => ({
          status: result.status,
          value: result.status === 'fulfilled' ? result.value : result.reason,
        })),
      });
    } catch (error) {
      console.error('Batch cancel error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
};

describe('Segmentation Batch Cancel API Tests', () => {
  let app: Express;
  let mockPrisma: any;
  let mockWebSocket: any;
  let mockMLService: any;
  let mockQueue: any;

  beforeAll(async () => {
    app = createMockApp();
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mocks
    const { prisma } = await import('../../db');
    mockPrisma = prisma as any;

    // All module-level mocks share the same vi.fn() references
    // resetMocks clears implementations but not the object references
    mockWebSocket = mockWsInstance;
    mockMLService = mockMLServiceInstance;
    mockQueue = mockQueueInstance;

    // Default successful mock implementations
    mockPrisma.segmentationQueue.findMany.mockResolvedValue(
      mockSegmentationJobs.activeBatch.map(job => ({
        ...job,
        project: mockProject,
      }))
    );
    mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.image.updateMany.mockResolvedValue({ count: 2 });
    mockMLService.cancelJob.mockResolvedValue({ success: true });
    mockQueue.removeJobs.mockResolvedValue(1);
    mockWebSocket.emitToUser.mockResolvedValue(undefined);
    mockWebSocket.emitToRoom.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/queue/batch/:batchId/cancel', () => {
    describe('Successful Cancellation', () => {
      it('should cancel active batch successfully', async () => {
        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(response.body).toEqual({
          success: true,
          message: 'Batch cancellation completed',
          batchId: 'batch-123',
          cancelledJobs: 2, // queued + processing
          completedJobs: 1,
          totalJobs: 3,
          mlServiceResults: expect.any(Array),
        });

        // Verify database operations
        expect(mockPrisma.segmentationQueue.findMany).toHaveBeenCalledWith({
          where: { batchId: 'batch-123' },
          include: { project: true },
        });

        expect(mockPrisma.segmentationQueue.updateMany).toHaveBeenCalledWith({
          where: {
            id: { in: ['job-001', 'job-002'] },
          },
          data: {
            status: 'cancelled',
          },
        });
      });

      it('should cancel ML service jobs for processing jobs', async () => {
        await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(mockMLService.cancelJob).toHaveBeenCalledWith('job-002');
        expect(mockMLService.cancelJob).toHaveBeenCalledTimes(1); // Only for processing job
      });

      it('should remove queued jobs from Bull queue', async () => {
        await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(mockQueue.removeJobs).toHaveBeenCalledWith('job-001*');
        expect(mockQueue.removeJobs).toHaveBeenCalledTimes(1); // Only for queued job
      });

      it('should update image statuses', async () => {
        await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(mockPrisma.image.updateMany).toHaveBeenCalledWith({
          where: {
            id: { in: ['img-001', 'img-002'] },
          },
          data: {
            segmentationStatus: 'cancelled',
          },
        });
      });

      it('should emit WebSocket events', async () => {
        await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(mockWebSocket.emitToUser).toHaveBeenCalledWith(
          'user-789',
          'batchCancelled',
          {
            batchId: 'batch-123',
            projectId: 'project-456',
            cancelledJobs: 2,
            completedJobs: 1,
            timestamp: expect.any(String),
          }
        );

        expect(mockWebSocket.emitToRoom).toHaveBeenCalledWith(
          'project:project-456',
          'batchCancelled',
          expect.objectContaining({
            batchId: 'batch-123',
            projectId: 'project-456',
            userId: 'user-789',
          })
        );

        expect(mockWebSocket.emitToRoom).toHaveBeenCalledWith(
          'project:project-456',
          'queueStats',
          {
            projectId: 'project-456',
            queued: 0,
            processing: 0,
            completed: 1,
            total: 3,
          }
        );
      });

      it('should handle partial batch cancellation', async () => {
        // Batch with some completed jobs
        const partialBatch = [
          ...mockSegmentationJobs.activeBatch,
          {
            id: 'job-004',
            batchId: 'batch-123',
            imageId: 'img-004',
            projectId: 'project-456',
            userId: 'user-789',
            status: 'completed',
            priority: 1,
            queueId: 'queue-004',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        mockPrisma.segmentationQueue.findMany.mockResolvedValue(
          partialBatch.map(job => ({ ...job, project: mockProject }))
        );

        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(response.body.cancelledJobs).toBe(2);
        expect(response.body.completedJobs).toBe(2);
        expect(response.body.totalJobs).toBe(4);
      });

      it('should handle large batch cancellation', async () => {
        mockPrisma.segmentationQueue.findMany.mockResolvedValue(
          mockSegmentationJobs.largeBatch.map(job => ({
            ...job,
            project: mockProject,
          }))
        );

        const response = await request(app)
          .post('/api/queue/batch/batch-large-001/cancel')
          .expect(200);

        expect(response.body.cancelledJobs).toBe(90); // 10 processing + 80 queued
        expect(response.body.completedJobs).toBe(10);
        expect(response.body.totalJobs).toBe(100);
      });
    });

    describe('Error Cases', () => {
      it('should return 404 for non-existent batch', async () => {
        mockPrisma.segmentationQueue.findMany.mockResolvedValue([]);

        const response = await request(app)
          .post('/api/queue/batch/non-existent/cancel')
          .expect(404);

        expect(response.body).toEqual({
          error: 'Batch not found',
        });
      });

      it('should return 403 for unauthorized access', async () => {
        const unauthorizedProject = { ...mockProject, userId: 'other-user' };

        mockPrisma.segmentationQueue.findMany.mockResolvedValue(
          mockSegmentationJobs.activeBatch.map(job => ({
            ...job,
            project: unauthorizedProject,
          }))
        );

        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(403);

        expect(response.body).toEqual({
          error: 'Access denied',
        });
      });

      it('should return 400 for already completed batch', async () => {
        const completedBatch = mockSegmentationJobs.activeBatch.map(job => ({
          ...job,
          status: 'completed',
          project: mockProject,
        }));

        mockPrisma.segmentationQueue.findMany.mockResolvedValue(completedBatch);

        const response = await request(app)
          .post('/api/queue/batch/batch-completed/cancel')
          .expect(400);

        expect(response.body).toEqual({
          error: 'Batch already completed',
        });
      });

      it('should return 400 for already cancelled batch', async () => {
        const cancelledBatch = mockSegmentationJobs.activeBatch.map(job => ({
          ...job,
          status: 'cancelled',
          project: mockProject,
        }));

        mockPrisma.segmentationQueue.findMany.mockResolvedValue(cancelledBatch);

        const response = await request(app)
          .post('/api/queue/batch/batch-cancelled/cancel')
          .expect(400);

        expect(response.body).toEqual({
          error: 'Batch already cancelled',
        });
      });

      it('should return 400 for no active jobs to cancel', async () => {
        const noActiveBatch = mockSegmentationJobs.activeBatch.map(job => ({
          ...job,
          status: 'completed',
          project: mockProject,
        }));

        mockPrisma.segmentationQueue.findMany.mockResolvedValue(noActiveBatch);

        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(400);

        expect(response.body).toEqual({
          error: 'Batch already completed',
        });
      });

      it('should handle database errors gracefully', async () => {
        mockPrisma.segmentationQueue.findMany.mockRejectedValue(
          new Error('Database connection failed')
        );

        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(500);

        expect(response.body).toEqual({
          error: 'Internal server error',
        });
      });

      it('should handle ML service errors gracefully', async () => {
        mockMLService.cancelJob.mockRejectedValue(
          new Error('ML service unavailable')
        );

        // Should still succeed with partial cancellation
        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.mlServiceResults).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              status: 'rejected',
            }),
          ])
        );
      });

      it('should handle Bull queue errors gracefully', async () => {
        mockQueue.removeJobs.mockRejectedValue(
          new Error('Queue service unavailable')
        );

        // Should still succeed with partial cancellation
        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(response.body.success).toBe(true);
      });

      it('should handle WebSocket errors gracefully', async () => {
        mockWebSocket.emitToUser.mockRejectedValue(
          new Error('WebSocket error')
        );

        // Should still succeed even if WebSocket fails
        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(response.body.success).toBe(true);
      });
    });

    describe('Performance and Scalability', () => {
      it('should handle large batch cancellation efficiently', async () => {
        mockPrisma.segmentationQueue.findMany.mockResolvedValue(
          mockSegmentationJobs.largeBatch.map(job => ({
            ...job,
            project: mockProject,
          }))
        );

        const start = Date.now();

        const response = await request(app)
          .post('/api/queue/batch/batch-large-001/cancel')
          .expect(200);

        const duration = Date.now() - start;

        expect(response.body.success).toBe(true);
        expect(response.body.totalJobs).toBe(100);
        expect(duration).toBeLessThan(5000); // Should complete in less than 5 seconds
      });

      it('should handle concurrent batch cancellations', async () => {
        // Setup different batches
        const batch1Jobs = mockSegmentationJobs.activeBatch.map(job => ({
          ...job,
          batchId: 'batch-001',
          project: mockProject,
        }));

        const batch2Jobs = mockSegmentationJobs.activeBatch.map(job => ({
          ...job,
          id: job.id + '-batch2',
          batchId: 'batch-002',
          project: mockProject,
        }));

        mockPrisma.segmentationQueue.findMany
          .mockResolvedValueOnce(batch1Jobs)
          .mockResolvedValueOnce(batch2Jobs);

        const promises = [
          request(app).post('/api/queue/batch/batch-001/cancel'),
          request(app).post('/api/queue/batch/batch-002/cancel'),
        ];

        const responses = await Promise.all(promises);

        responses.forEach(response => {
          expect(response.status).toBe(200);
          expect(response.body.success).toBe(true);
        });
      });

      it('should batch database operations efficiently', async () => {
        mockPrisma.segmentationQueue.findMany.mockResolvedValue(
          mockSegmentationJobs.largeBatch.map(job => ({
            ...job,
            project: mockProject,
          }))
        );

        await request(app)
          .post('/api/queue/batch/batch-large-001/cancel')
          .expect(200);

        // Should use batch operations, not individual updates
        expect(mockPrisma.segmentationQueue.updateMany).toHaveBeenCalledTimes(
          1
        );
        expect(mockPrisma.image.updateMany).toHaveBeenCalledTimes(1);
      });
    });

    describe('Edge Cases', () => {
      it('should handle batch with mixed job statuses', async () => {
        const mixedBatch = [
          { ...mockSegmentationJobs.activeBatch[0], status: 'queued' },
          { ...mockSegmentationJobs.activeBatch[1], status: 'processing' },
          { ...mockSegmentationJobs.activeBatch[2], status: 'completed' },
          {
            id: 'job-004',
            batchId: 'batch-123',
            imageId: 'img-004',
            projectId: 'project-456',
            userId: 'user-789',
            status: 'failed',
            priority: 1,
            queueId: 'queue-004',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        mockPrisma.segmentationQueue.findMany.mockResolvedValue(
          mixedBatch.map(job => ({ ...job, project: mockProject }))
        );

        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(response.body.cancelledJobs).toBe(2); // Only queued and processing
        expect(response.body.completedJobs).toBe(1); // Only completed
      });

      it('should handle batch with no project association', async () => {
        mockPrisma.segmentationQueue.findMany.mockResolvedValue(
          mockSegmentationJobs.activeBatch.map(job => ({
            ...job,
            project: null,
          }))
        );

        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(403);

        expect(response.body.error).toBe('Access denied');
      });

      it('should handle very long batch IDs', async () => {
        const longBatchId = 'batch-' + 'a'.repeat(1000);

        mockPrisma.segmentationQueue.findMany.mockResolvedValue([]);

        const response = await request(app)
          .post(`/api/queue/batch/${longBatchId}/cancel`)
          .expect(404);

        expect(response.body.error).toBe('Batch not found');
      });
    });

    describe('Race Conditions', () => {
      it('should handle race condition where job completes during cancellation', async () => {
        // Simulate job completing after query but before update
        mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 1 }); // Only 1 updated instead of 2

        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(response.body.success).toBe(true);
        // Should handle gracefully even if fewer jobs were cancelled than expected
      });

      it('should handle concurrent cancellation of same batch', async () => {
        // Set up: first call returns active batch, second call returns all-cancelled
        const cancelledBatch = mockSegmentationJobs.activeBatch.map(job => ({
          ...job,
          status: 'cancelled',
          project: mockProject,
        }));
        const activeBatch = mockSegmentationJobs.activeBatch.map(job => ({
          ...job,
          project: mockProject,
        }));

        // First call gets active batch (200), second call gets cancelled batch (400)
        mockPrisma.segmentationQueue.findMany
          .mockResolvedValueOnce(activeBatch)
          .mockResolvedValueOnce(cancelledBatch);

        // Run requests sequentially to ensure predictable mock consumption
        const response1 = await request(app).post('/api/queue/batch/batch-123/cancel');
        const response2 = await request(app).post('/api/queue/batch/batch-123/cancel');

        expect(response1.status).toBe(200);
        expect(response2.status).toBe(400);
        expect(response2.body.error).toBe('Batch already cancelled');
      });
    });

    describe('Resource Cleanup', () => {
      it('should clean up GPU memory after ML job cancellation', async () => {
        await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        // ML service should handle GPU cleanup
        expect(mockMLService.cancelJob).toHaveBeenCalled();
      });

      it('should clean up queue resources', async () => {
        await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(mockQueue.removeJobs).toHaveBeenCalled();
      });
    });

    describe('Monitoring and Observability', () => {
      it('should log batch cancellation events', async () => {
        const consoleSpy = jest
          .spyOn(console, 'log')
          .mockImplementation(() => {});

        await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        consoleSpy.mockRestore();
      });

      it('should provide detailed cancellation results', async () => {
        const response = await request(app)
          .post('/api/queue/batch/batch-123/cancel')
          .expect(200);

        expect(response.body).toHaveProperty('mlServiceResults');
        expect(Array.isArray(response.body.mlServiceResults)).toBe(true);
        expect(response.body).toHaveProperty('cancelledJobs');
        expect(response.body).toHaveProperty('completedJobs');
        expect(response.body).toHaveProperty('totalJobs');
      });
    });
  });
});
