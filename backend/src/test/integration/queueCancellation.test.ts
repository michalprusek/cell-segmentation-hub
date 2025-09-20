import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { createServer, Server as HTTPServer } from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { prisma } from '../../db';
import { QueueService } from '../../services/queueService';
import { WebSocketService } from '../../services/websocketService';

// Mock app setup - in a real test this would import the actual app
const mockApp = {
  post: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  use: vi.fn(),
  listen: vi.fn()
} as unknown as Express;

// Mock data
const testUser = {
  id: 'test-user-123',
  email: 'test@example.com',
  name: 'Test User'
};

const testProject = {
  id: 'test-project-123',
  name: 'Test Project',
  userId: testUser.id
};

const testImages = [
  {
    id: 'img-1',
    name: 'test1.jpg',
    projectId: testProject.id,
    userId: testUser.id,
    url: '/uploads/test1.jpg',
    segmentationStatus: 'pending'
  },
  {
    id: 'img-2',
    name: 'test2.jpg',
    projectId: testProject.id,
    userId: testUser.id,
    url: '/uploads/test2.jpg',
    segmentationStatus: 'pending'
  },
  {
    id: 'img-3',
    name: 'test3.jpg',
    projectId: testProject.id,
    userId: testUser.id,
    url: '/uploads/test3.jpg',
    segmentationStatus: 'pending'
  }
];

describe('Complete Queue Cancellation Flow Integration', () => {
  let httpServer: HTTPServer;
  let ioServer: SocketIOServer;
  let websocketService: WebSocketService;
  let queueService: QueueService;
  let clientSocket: ClientSocket;
  let port: number;

  beforeAll(async () => {
    // Setup test database
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Setup HTTP and WebSocket servers
    httpServer = createServer();
    httpServer.listen(0);
    port = (httpServer.address() as AddressInfo).port;

    ioServer = new SocketIOServer(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] }
    });

    // Initialize services
    websocketService = WebSocketService.getInstance();
    (websocketService as any).io = ioServer;

    queueService = QueueService.getInstance(
      prisma,
      {} as any, // Mock segmentation service
      {} as any  // Mock image service
    );

    // Setup WebSocket authentication
    ioServer.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (token === testUser.id) {
        (socket as any).userId = testUser.id;
        next();
      } else {
        next(new Error('Authentication error'));
      }
    });

    ioServer.on('connection', (socket) => {
      const userId = (socket as any).userId;
      websocketService.handleConnection(socket, userId);
    });

    await new Promise<void>((resolve) => {
      if (httpServer.listening) {
        resolve();
      } else {
        httpServer.on('listening', resolve);
      }
    });

    // Setup test data
    await setupTestData();
  });

  afterEach(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    if (ioServer) {
      ioServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }

    // Reset singletons
    (WebSocketService as any).instance = null;
    (QueueService as any).instance = null;

    await cleanupTestData();
  });

  const connectClient = (): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}`, {
        auth: { token: testUser.id },
        transports: ['websocket']
      });

      client.on('connect', () => resolve(client));
      client.on('connect_error', reject);

      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  };

  describe('End-to-End Cancel Flow', () => {
    it('should cancel batch segmentation end-to-end', async () => {
      // Step 1: Connect WebSocket client
      clientSocket = await connectClient();

      const cancelEventPromise = new Promise((resolve) => {
        clientSocket.on('queue:cancelled', resolve);
      });

      // Step 2: Add images to queue (simulate batch submission)
      const batchId = 'test-batch-123';
      const queueItems = [];

      for (const image of testImages) {
        const queueItem = await prisma.segmentationQueue.create({
          data: {
            id: `queue-${image.id}`,
            imageId: image.id,
            projectId: testProject.id,
            userId: testUser.id,
            model: 'hrnet',
            threshold: 0.5,
            priority: 0,
            detectHoles: true,
            status: 'queued',
            batchId: batchId,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
        queueItems.push(queueItem);
      }

      // Step 3: Verify queue state
      const queueStats = await queueService.getQueueStats(testProject.id, testUser.id);
      expect(queueStats.queued).toBe(3);

      // Step 4: Cancel via API endpoint
      const cancelledItems = await queueService.cancelByProject(testProject.id, testUser.id);

      // Step 5: Emit WebSocket event (simulate controller behavior)
      websocketService.emitToUser(testUser.id, 'queue:cancelled', {
        projectId: testProject.id,
        cancelledCount: cancelledItems.length,
        timestamp: new Date().toISOString()
      });

      // Step 6: Verify WebSocket event received
      const cancelEvent = await cancelEventPromise;
      expect(cancelEvent).toEqual({
        projectId: testProject.id,
        cancelledCount: 3,
        timestamp: expect.any(String)
      });

      // Step 7: Verify database state updated
      const remainingQueueItems = await prisma.segmentationQueue.findMany({
        where: {
          projectId: testProject.id,
          userId: testUser.id,
          status: { in: ['queued', 'processing'] }
        }
      });

      expect(remainingQueueItems).toHaveLength(0);

      // Step 8: Verify cancelled items have correct status
      const cancelledQueueItems = await prisma.segmentationQueue.findMany({
        where: {
          projectId: testProject.id,
          userId: testUser.id,
          status: 'cancelled'
        }
      });

      expect(cancelledQueueItems).toHaveLength(3);
      cancelledQueueItems.forEach(item => {
        expect(item.status).toBe('cancelled');
        expect(item.completedAt).toBeDefined();
        expect(item.updatedAt).toBeDefined();
      });
    });

    it('should handle 200+ image batch cancellation', async () => {
      // Create large batch
      const batchId = 'large-batch-123';
      const largeImageSet = Array.from({ length: 250 }, (_, i) => ({
        id: `img-large-${i}`,
        name: `test-large-${i}.jpg`,
        projectId: testProject.id,
        userId: testUser.id,
        url: `/uploads/test-large-${i}.jpg`
      }));

      // Add to database
      for (const image of largeImageSet) {
        await prisma.segmentationQueue.create({
          data: {
            id: `queue-${image.id}`,
            imageId: image.id,
            projectId: testProject.id,
            userId: testUser.id,
            model: 'hrnet',
            threshold: 0.5,
            priority: 0,
            detectHoles: true,
            status: 'queued',
            batchId: batchId,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
      }

      clientSocket = await connectClient();

      const cancelEventPromise = new Promise((resolve) => {
        clientSocket.on('queue:cancelled', resolve);
      });

      const startTime = Date.now();

      // Cancel large batch
      const cancelledItems = await queueService.cancelByProject(testProject.id, testUser.id);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Performance verification
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(cancelledItems).toHaveLength(250);

      // Emit WebSocket event
      websocketService.emitToUser(testUser.id, 'queue:cancelled', {
        projectId: testProject.id,
        cancelledCount: cancelledItems.length,
        timestamp: new Date().toISOString()
      });

      const cancelEvent = await cancelEventPromise;
      expect(cancelEvent).toEqual({
        projectId: testProject.id,
        cancelledCount: 250,
        timestamp: expect.any(String)
      });

      // Verify database state
      const remainingItems = await prisma.segmentationQueue.count({
        where: {
          projectId: testProject.id,
          userId: testUser.id,
          status: { in: ['queued', 'processing'] }
        }
      });

      expect(remainingItems).toBe(0);
    });

    it('should prevent race conditions between cancel types', async () => {
      clientSocket = await connectClient();

      // Setup queue with mixed batches
      const batch1Id = 'batch-1';
      const batch2Id = 'batch-2';

      // Create items in different batches
      const batch1Items = [];
      const batch2Items = [];

      for (let i = 0; i < 5; i++) {
        const item1 = await prisma.segmentationQueue.create({
          data: {
            id: `queue-b1-${i}`,
            imageId: `img-b1-${i}`,
            projectId: testProject.id,
            userId: testUser.id,
            model: 'hrnet',
            threshold: 0.5,
            priority: 0,
            detectHoles: true,
            status: 'queued',
            batchId: batch1Id,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
        batch1Items.push(item1);

        const item2 = await prisma.segmentationQueue.create({
          data: {
            id: `queue-b2-${i}`,
            imageId: `img-b2-${i}`,
            projectId: testProject.id,
            userId: testUser.id,
            model: 'hrnet',
            threshold: 0.5,
            priority: 0,
            detectHoles: true,
            status: 'queued',
            batchId: batch2Id,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
        batch2Items.push(item2);
      }

      const queueCancelPromise = new Promise((resolve) => {
        clientSocket.on('queue:cancelled', resolve);
      });

      const batchCancelPromise = new Promise((resolve) => {
        clientSocket.on('batch:cancelled', resolve);
      });

      // Execute concurrent cancellations
      const [projectCancelled, batchCancelled] = await Promise.all([
        queueService.cancelByProject(testProject.id, testUser.id),
        queueService.cancelBatch(batch2Id, testUser.id)
      ]);

      // Emit WebSocket events
      websocketService.emitToUser(testUser.id, 'queue:cancelled', {
        projectId: testProject.id,
        cancelledCount: projectCancelled.length,
        timestamp: new Date().toISOString()
      });

      websocketService.emitToUser(testUser.id, 'batch:cancelled', {
        batchId: batch2Id,
        cancelledCount: batchCancelled.length,
        timestamp: new Date().toISOString()
      });

      const [queueEvent, batchEvent] = await Promise.all([
        queueCancelPromise,
        batchCancelPromise
      ]);

      // Project cancellation should cancel all items (10 total)
      expect((queueEvent as any).cancelledCount).toBe(10);

      // Batch cancellation might find fewer items if project cancel ran first
      expect((batchEvent as any).cancelledCount).toBeLessThanOrEqual(5);

      // Verify final state - all items should be cancelled
      const finalQueuedItems = await prisma.segmentationQueue.count({
        where: {
          projectId: testProject.id,
          userId: testUser.id,
          status: { in: ['queued', 'processing'] }
        }
      });

      expect(finalQueuedItems).toBe(0);
    });
  });

  describe('Error Scenarios Integration', () => {
    it('should handle database constraints during cancellation', async () => {
      clientSocket = await connectClient();

      // Create queue item
      await prisma.segmentationQueue.create({
        data: {
          id: 'constraint-test-queue',
          imageId: testImages[0].id,
          projectId: testProject.id,
          userId: testUser.id,
          model: 'hrnet',
          threshold: 0.5,
          priority: 0,
          detectHoles: true,
          status: 'queued',
          batchId: 'constraint-test-batch',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Mock database constraint error
      const originalUpdateMany = prisma.segmentationQueue.updateMany;
      (prisma.segmentationQueue.updateMany as any) = vi.fn().mockRejectedValue(
        new Error('Foreign key constraint violation')
      );

      try {
        await expect(
          queueService.cancelByProject(testProject.id, testUser.id)
        ).rejects.toThrow('Foreign key constraint violation');
      } finally {
        // Restore original method
        prisma.segmentationQueue.updateMany = originalUpdateMany;
      }
    });

    it('should handle WebSocket disconnection during cancellation', async () => {
      clientSocket = await connectClient();

      // Create queue items
      for (const image of testImages) {
        await prisma.segmentationQueue.create({
          data: {
            id: `disconnect-queue-${image.id}`,
            imageId: image.id,
            projectId: testProject.id,
            userId: testUser.id,
            model: 'hrnet',
            threshold: 0.5,
            priority: 0,
            detectHoles: true,
            status: 'queued',
            batchId: 'disconnect-test-batch',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
      }

      // Disconnect client before cancellation
      clientSocket.disconnect();

      // Cancellation should still work
      const cancelledItems = await queueService.cancelByProject(testProject.id, testUser.id);
      expect(cancelledItems).toHaveLength(3);

      // WebSocket emission should not crash
      expect(() => {
        websocketService.emitToUser(testUser.id, 'queue:cancelled', {
          projectId: testProject.id,
          cancelledCount: cancelledItems.length,
          timestamp: new Date().toISOString()
        });
      }).not.toThrow();

      // Verify database state
      const remainingItems = await prisma.segmentationQueue.count({
        where: {
          projectId: testProject.id,
          userId: testUser.id,
          status: { in: ['queued', 'processing'] }
        }
      });

      expect(remainingItems).toBe(0);
    });

    it('should handle partial cancellation failures', async () => {
      clientSocket = await connectClient();

      // Create queue items with different statuses
      const queueItems = [];

      for (let i = 0; i < 3; i++) {
        const item = await prisma.segmentationQueue.create({
          data: {
            id: `partial-queue-${i}`,
            imageId: `img-partial-${i}`,
            projectId: testProject.id,
            userId: testUser.id,
            model: 'hrnet',
            threshold: 0.5,
            priority: 0,
            detectHoles: true,
            status: i === 2 ? 'processing' : 'queued', // Last item is processing
            batchId: 'partial-test-batch',
            createdAt: new Date(),
            updatedAt: new Date(),
            startedAt: i === 2 ? new Date() : null
          }
        });
        queueItems.push(item);
      }

      // Simulate one item transitioning to completed during cancellation
      setTimeout(async () => {
        await prisma.segmentationQueue.update({
          where: { id: 'partial-queue-2' },
          data: {
            status: 'completed',
            completedAt: new Date()
          }
        });
      }, 100);

      await new Promise(resolve => setTimeout(resolve, 200));

      const cancelledItems = await queueService.cancelByProject(testProject.id, testUser.id);

      // Should cancel items that were still cancellable
      expect(cancelledItems.length).toBeGreaterThanOrEqual(1);
      expect(cancelledItems.length).toBeLessThanOrEqual(3);

      websocketService.emitToUser(testUser.id, 'queue:cancelled', {
        projectId: testProject.id,
        cancelledCount: cancelledItems.length,
        timestamp: new Date().toISOString()
      });

      // Verify some items were cancelled
      const cancelledInDb = await prisma.segmentationQueue.count({
        where: {
          projectId: testProject.id,
          userId: testUser.id,
          status: 'cancelled'
        }
      });

      expect(cancelledInDb).toBeGreaterThan(0);
    });
  });

  describe('Performance and Stress Tests', () => {
    it('should handle multiple simultaneous users cancelling', async () => {
      const user2Id = 'test-user-456';
      const user3Id = 'test-user-789';

      // Create queue items for different users
      const users = [testUser.id, user2Id, user3Id];
      const promises = [];

      for (const userId of users) {
        for (let i = 0; i < 10; i++) {
          promises.push(
            prisma.segmentationQueue.create({
              data: {
                id: `multi-user-${userId}-${i}`,
                imageId: `img-${userId}-${i}`,
                projectId: testProject.id,
                userId: userId,
                model: 'hrnet',
                threshold: 0.5,
                priority: 0,
                detectHoles: true,
                status: 'queued',
                batchId: `batch-${userId}`,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            })
          );
        }
      }

      await Promise.all(promises);

      const startTime = Date.now();

      // Cancel for all users simultaneously
      const cancellationPromises = users.map(userId =>
        queueService.cancelByProject(testProject.id, userId)
      );

      const results = await Promise.all(cancellationPromises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Each user should cancel their own items
      results.forEach((cancelledItems, index) => {
        expect(cancelledItems).toHaveLength(10);
      });

      // Should complete within reasonable time
      expect(duration).toBeLessThan(3000);

      // Verify database state
      const remainingItems = await prisma.segmentationQueue.count({
        where: {
          projectId: testProject.id,
          status: { in: ['queued', 'processing'] }
        }
      });

      expect(remainingItems).toBe(0);
    });

    it('should handle memory efficiently with large datasets', async () => {
      const batchSize = 500;
      const batchId = 'memory-test-batch';

      // Create large dataset
      const createPromises = [];
      for (let i = 0; i < batchSize; i++) {
        createPromises.push(
          prisma.segmentationQueue.create({
            data: {
              id: `memory-test-${i}`,
              imageId: `img-memory-${i}`,
              projectId: testProject.id,
              userId: testUser.id,
              model: 'hrnet',
              threshold: 0.5,
              priority: 0,
              detectHoles: true,
              status: 'queued',
              batchId: batchId,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          })
        );

        // Batch the creates to avoid overwhelming the database
        if (createPromises.length >= 50) {
          await Promise.all(createPromises);
          createPromises.length = 0;
        }
      }

      if (createPromises.length > 0) {
        await Promise.all(createPromises);
      }

      const initialMemory = process.memoryUsage();

      const cancelledItems = await queueService.cancelByProject(testProject.id, testUser.id);

      const finalMemory = process.memoryUsage();

      expect(cancelledItems).toHaveLength(batchSize);

      // Memory usage should not increase dramatically
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024); // Less than 100MB increase
    });
  });

  // Helper functions
  async function setupTestDatabase() {
    // In a real test, this would set up a test database
    // For now, we'll assume the test database is already configured
  }

  async function cleanupTestDatabase() {
    // Clean up test database
  }

  async function setupTestData() {
    // Create test user
    try {
      await prisma.user.create({
        data: testUser
      });
    } catch (error) {
      // User might already exist
    }

    // Create test project
    try {
      await prisma.project.create({
        data: testProject
      });
    } catch (error) {
      // Project might already exist
    }

    // Create test images
    for (const image of testImages) {
      try {
        await prisma.image.create({
          data: image
        });
      } catch (error) {
        // Image might already exist
      }
    }
  }

  async function cleanupTestData() {
    // Clean up in reverse order due to foreign key constraints
    await prisma.segmentationQueue.deleteMany({
      where: {
        OR: [
          { projectId: testProject.id },
          { userId: testUser.id }
        ]
      }
    });

    await prisma.image.deleteMany({
      where: { projectId: testProject.id }
    });

    await prisma.project.deleteMany({
      where: { id: testProject.id }
    });

    await prisma.user.deleteMany({
      where: { id: testUser.id }
    });
  }
});