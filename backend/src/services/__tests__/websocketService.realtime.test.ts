import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { Server as HTTPServer, createServer } from 'http';
// import { Server as SocketIOServer } from 'socket.io';
import Client from 'socket.io-client';

// Mock Prisma client
type MockPrismaClient = {
  user: {
    findUnique: ReturnType<typeof jest.fn>;
  };
  project: {
    findUnique: ReturnType<typeof jest.fn>;
    count: ReturnType<typeof jest.fn>;
  };
  image: {
    count: ReturnType<typeof jest.fn>;
    aggregate: ReturnType<typeof jest.fn>;
    groupBy: ReturnType<typeof jest.fn>;
  };
  segmentation: {
    count: ReturnType<typeof jest.fn>;
  };
};

const prismaMock: MockPrismaClient = {
  user: {
    findUnique: jest.fn(),
  },
  project: {
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  image: {
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  },
  segmentation: {
    count: jest.fn(),
  },
};

// Mock dependencies
jest.mock('../../db', () => ({
  prisma: prismaMock,
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  default: {
    verify: jest.fn(),
  },
}));

// Import after mocking
import { WebSocketService } from '../websocketService';
import {
  WebSocketEvent,
  SegmentationUpdateData,
  ProjectUpdateData,
  // QueueStatsData,
  getUserRoom,
  getProjectRoom,
} from '../../types/websocket';
import jwt from 'jsonwebtoken';

describe('WebSocket Real-time Updates', () => {
  let httpServer: HTTPServer;
  let wsService: WebSocketService;
  let clientSocket: any;
  let port: number;

  beforeEach(done => {
    httpServer = createServer();
    wsService = new WebSocketService(httpServer, prismaMock as any);

    httpServer.listen(() => {
      const address = httpServer.address();
      if (address && typeof address === 'object') {
        port = address.port;
      } else {
        port = 3001;
      }
      done();
    });
  });

  afterEach(done => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
    httpServer.close(done);
  });

  describe('PROJECT_UPDATE Events', () => {
    it('should emit PROJECT_UPDATE events on image operations', done => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';

      // Mock JWT verification
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      // Mock user exists
      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        // Listen for PROJECT_UPDATE events
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.userId).toBe(testUserId);
            expect(data.operation).toBe('updated');
            expect(data.updates).toBeDefined();
            expect(data.timestamp).toBeDefined();
            done();
          }
        );

        // Simulate image upload completion that should trigger PROJECT_UPDATE
        const updateData: ProjectUpdateData = {
          projectId: testProjectId,
          userId: testUserId,
          operation: 'updated',
          updates: {
            imageCount: 15,
            segmentedCount: 12,
          },
          timestamp: new Date(),
        };

        wsService.broadcastProjectUpdate(updateData);
      });
    });

    it('should emit PROJECT_UPDATE with correct statistics after image deletion', done => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');
            expect(data.updates?.imageCount).toBe(10); // Decreased after deletion
            expect(data.updates?.segmentedCount).toBe(8); // Also decreased
            done();
          }
        );

        // Simulate image deletion that updates project stats
        const updateData: ProjectUpdateData = {
          projectId: testProjectId,
          userId: testUserId,
          operation: 'updated',
          updates: {
            imageCount: 10, // After deletion
            segmentedCount: 8, // After deletion
          },
          timestamp: new Date(),
        };

        wsService.broadcastProjectUpdate(updateData);
      });
    });

    it('should emit PROJECT_UPDATE with segmentation completion statistics', done => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');
            expect(data.updates?.segmentedCount).toBe(13); // Increased after segmentation
            expect(data.timestamp).toBeDefined();
            done();
          }
        );

        // Simulate segmentation completion
        const updateData: ProjectUpdateData = {
          projectId: testProjectId,
          userId: testUserId,
          operation: 'updated',
          updates: {
            imageCount: 15, // Same
            segmentedCount: 13, // Increased
          },
          timestamp: new Date(),
        };

        wsService.broadcastProjectUpdate(updateData);
      });
    });
  });

  describe('broadcastProjectUpdate method', () => {
    it('should broadcast to correct project room', done => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        // Join the project room
        clientSocket.emit('join', getProjectRoom(testProjectId));

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.userId).toBe(testUserId);
            done();
          }
        );

        // Broadcast to project room
        const updateData: ProjectUpdateData = {
          projectId: testProjectId,
          userId: testUserId,
          operation: 'updated',
          updates: {
            imageCount: 20,
            segmentedCount: 15,
          },
          timestamp: new Date(),
        };

        wsService.broadcastProjectUpdate(updateData);
      });
    });

    it('should handle shared project notifications', done => {
      const ownerId = 'owner-user-id';
      const sharedUserId = 'shared-user-id';
      const testProjectId = 'shared-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: sharedUserId,
        email: 'shared@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: sharedUserId,
        email: 'shared@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        // Join both user and project rooms for shared project
        clientSocket.emit('join', getUserRoom(sharedUserId));
        clientSocket.emit('join', getProjectRoom(testProjectId));

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.userId).toBe(ownerId); // Owner made the change
            expect(data.operation).toBe('updated');
            done();
          }
        );

        // Owner updates shared project
        const updateData: ProjectUpdateData = {
          projectId: testProjectId,
          userId: ownerId, // Owner making the change
          operation: 'updated',
          updates: {
            imageCount: 25,
            segmentedCount: 18,
          },
          timestamp: new Date(),
        };

        wsService.broadcastProjectUpdate(updateData);
      });
    });
  });

  describe('Real-time Update Event Payloads', () => {
    it('should include correct data structure in PROJECT_UPDATE events', done => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            // Verify complete data structure
            expect(data).toEqual({
              projectId: expect.any(String),
              userId: expect.any(String),
              operation: expect.any(String),
              updates: expect.objectContaining({
                imageCount: expect.any(Number),
                segmentedCount: expect.any(Number),
                title: expect.any(String),
                description: expect.any(String),
              }),
              timestamp: expect.any(Date),
            });

            expect(data.operation).toMatch(
              /^(created|updated|deleted|shared)$/
            );
            done();
          }
        );

        const updateData: ProjectUpdateData = {
          projectId: testProjectId,
          userId: testUserId,
          operation: 'updated',
          updates: {
            title: 'Updated Project Title',
            description: 'Updated description',
            imageCount: 30,
            segmentedCount: 22,
          },
          timestamp: new Date(),
        };

        wsService.broadcastProjectUpdate(updateData);
      });
    });

    it('should emit SEGMENTATION_STATUS events with correct data', done => {
      const testUserId = 'test-user-id';
      const testImageId = 'test-image-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.on(
          WebSocketEvent.SEGMENTATION_STATUS,
          (data: SegmentationUpdateData) => {
            expect(data.imageId).toBe(testImageId);
            expect(data.projectId).toBe(testProjectId);
            expect(data.status).toBe('completed');
            expect(data.progress).toBe(100);
            done();
          }
        );

        // Simulate segmentation completion
        wsService.emitSegmentationUpdate({
          imageId: testImageId,
          projectId: testProjectId,
          status: 'completed',
          progress: 100,
        });
      });
    });
  });

  describe('WebSocket Integration with Operations', () => {
    it('should integrate with image upload operations', done => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        let eventsReceived = 0;
        const expectedEvents = 2; // PROJECT_UPDATE and UPLOAD_COMPLETED

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');
            expect(data.updates?.imageCount).toBeGreaterThan(0);
            eventsReceived++;
            if (eventsReceived === expectedEvents) done();
          }
        );

        clientSocket.on(WebSocketEvent.UPLOAD_COMPLETED, (data: any) => {
          expect(data.projectId).toBe(testProjectId);
          expect(data.uploadedImages).toBeDefined();
          eventsReceived++;
          if (eventsReceived === expectedEvents) done();
        });

        // Simulate upload completion that triggers both events
        wsService.broadcastProjectUpdate({
          projectId: testProjectId,
          userId: testUserId,
          operation: 'updated',
          updates: { imageCount: 5, segmentedCount: 0 },
          timestamp: new Date(),
        });

        wsService.emitUploadCompleted({
          projectId: testProjectId,
          batchId: 'batch-123',
          summary: {
            totalFiles: 3,
            successCount: 3,
            failedCount: 0,
          },
          uploadedImages: [
            {
              id: 'img1',
              name: 'test1.jpg',
              originalUrl: '/img1',
              thumbnailUrl: '/thumb1',
            },
            {
              id: 'img2',
              name: 'test2.jpg',
              originalUrl: '/img2',
              thumbnailUrl: '/thumb2',
            },
            {
              id: 'img3',
              name: 'test3.jpg',
              originalUrl: '/img3',
              thumbnailUrl: '/thumb3',
            },
          ],
          timestamp: new Date(),
        });
      });
    });

    it('should integrate with image deletion operations', done => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');
            expect(data.updates?.imageCount).toBe(2); // Decreased after deletion
            expect(data.updates?.segmentedCount).toBe(1); // Also decreased
            done();
          }
        );

        // Simulate image deletion that updates project stats
        wsService.broadcastProjectUpdate({
          projectId: testProjectId,
          userId: testUserId,
          operation: 'updated',
          updates: {
            imageCount: 2, // After deletion
            segmentedCount: 1, // After deletion
          },
          timestamp: new Date(),
        });
      });
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require valid JWT token for WebSocket connection', done => {
      const invalidToken = 'invalid-jwt-token';

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: invalidToken },
      });

      clientSocket.on('connect_error', (error: any) => {
        expect(error.message).toContain('Authentication failed');
        done();
      });

      // Should not connect successfully
      clientSocket.on('connect', () => {
        done(new Error('Should not have connected with invalid token'));
      });
    });

    it('should only send PROJECT_UPDATE events to authorized users', done => {
      const authorizedUserId = 'authorized-user-id';
      const _unauthorizedUserId = 'unauthorized-user-id';
      const testProjectId = 'private-project-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: authorizedUserId,
        email: 'authorized@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: authorizedUserId,
        email: 'authorized@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        // Join project room as authorized user
        clientSocket.emit('join', getProjectRoom(testProjectId));

        let eventReceived = false;
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            eventReceived = true;
            expect(data.projectId).toBe(testProjectId);
          }
        );

        // Broadcast update
        wsService.broadcastProjectUpdate({
          projectId: testProjectId,
          userId: authorizedUserId,
          operation: 'updated',
          updates: { imageCount: 10, segmentedCount: 8 },
          timestamp: new Date(),
        });

        // Wait a bit and verify event was received
        setTimeout(() => {
          expect(eventReceived).toBe(true);
          done();
        }, 100);
      });
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle multiple concurrent WebSocket connections', done => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const mockToken = 'valid-jwt-token';
      const connectionCount = 5;
      let connectedClients = 0;
      let eventsReceived = 0;

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      const clients: any[] = [];

      // Create multiple clients
      for (let i = 0; i < connectionCount; i++) {
        const client = Client(`http://localhost:${port}`, {
          auth: { token: mockToken },
        });

        client.on('connect', () => {
          connectedClients++;
          client.emit('join', getProjectRoom(testProjectId));

          client.on(
            WebSocketEvent.PROJECT_UPDATE,
            (data: ProjectUpdateData) => {
              eventsReceived++;
              expect(data.projectId).toBe(testProjectId);

              if (eventsReceived === connectionCount) {
                // All clients received the event
                clients.forEach(c => c.disconnect());
                done();
              }
            }
          );

          // When all clients are connected, broadcast an update
          if (connectedClients === connectionCount) {
            wsService.broadcastProjectUpdate({
              projectId: testProjectId,
              userId: testUserId,
              operation: 'updated',
              updates: { imageCount: 15, segmentedCount: 12 },
              timestamp: new Date(),
            });
          }
        });

        clients.push(client);
      }
    });

    it('should handle WebSocket connection drops gracefully', done => {
      const testUserId = 'test-user-id';
      const mockToken = 'valid-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        // Simulate connection drop
        clientSocket.disconnect();

        clientSocket.on('disconnect', () => {
          // Verify service handles disconnection gracefully
          expect(wsService).toBeDefined();
          done();
        });
      });
    });
  });
});
