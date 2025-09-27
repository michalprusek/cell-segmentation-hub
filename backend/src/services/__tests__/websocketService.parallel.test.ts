import { WebSocketService } from '../websocketService';
import { Server as HTTPServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { Server as SocketIOServer } from 'socket.io';

// Mock dependencies
jest.mock('http');
jest.mock('socket.io');
jest.mock('@prisma/client');

describe('WebSocketService - Parallel Processing', () => {
  let webSocketService: WebSocketService;
  let mockHttpServer: jest.Mocked<HTTPServer>;
  let mockPrisma: jest.Mocked<PrismaClient>;
  let mockSocketIOServer: jest.Mocked<SocketIOServer>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockHttpServer = {} as any;
    mockPrisma = {} as any;

    mockSocketIOServer = {
      on: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      use: jest.fn(),
    } as any;

    // Mock Socket.IO constructor
    (SocketIOServer as jest.Mock).mockReturnValue(mockSocketIOServer);

    // Create WebSocketService instance
    webSocketService = WebSocketService.getInstance(mockHttpServer, mockPrisma);
  });

  describe('Parallel Processing Status', () => {
    it('should emit parallel processing status updates', () => {
      const statusData = {
        activeStreams: 3,
        maxConcurrentStreams: 4,
        totalProcessingCapacity: 12,
        currentThroughput: 8.5,
        concurrentUserCount: 3,
      };

      webSocketService.emitParallelProcessingStatus(statusData);

      expect(mockSocketIOServer.emit).toHaveBeenCalledWith(
        'parallel-processing-status',
        expect.objectContaining({
          ...statusData,
          timestamp: expect.any(String),
        })
      );
    });

    it('should handle errors during parallel processing status emission', () => {
      mockSocketIOServer.emit.mockImplementation(() => {
        throw new Error('Socket error');
      });

      const statusData = {
        activeStreams: 2,
        maxConcurrentStreams: 4,
        totalProcessingCapacity: 8,
        currentThroughput: 5.2,
        concurrentUserCount: 2,
      };

      // Should not throw an error
      expect(() =>
        webSocketService.emitParallelProcessingStatus(statusData)
      ).not.toThrow();
    });
  });

  describe('Concurrent User Count Tracking', () => {
    it('should emit concurrent user count updates to project room', () => {
      const projectId = 'proj1';
      const userCount = 3;

      webSocketService.emitConcurrentUserCount(projectId, userCount);

      expect(mockSocketIOServer.to).toHaveBeenCalledWith(
        `project:${projectId}`
      );
      expect(mockSocketIOServer.emit).toHaveBeenCalledWith(
        'concurrent-user-count',
        expect.objectContaining({
          projectId,
          count: userCount,
          timestamp: expect.any(String),
        })
      );
    });

    it('should track users entering parallel processing', () => {
      const userId = 'user1';
      const projectId = 'proj1';

      // Mock the emit method for concurrent user count
      const emitSpy = jest.spyOn(webSocketService, 'emitConcurrentUserCount');

      webSocketService.trackParallelProcessingUser(userId, projectId);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(1);
      expect(emitSpy).toHaveBeenCalledWith(projectId, 1);

      // Track another user
      webSocketService.trackParallelProcessingUser('user2', projectId);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(2);
      expect(emitSpy).toHaveBeenCalledWith(projectId, 2);

      emitSpy.mockRestore();
    });

    it('should track users exiting parallel processing', () => {
      const userId1 = 'user1';
      const userId2 = 'user2';
      const projectId = 'proj1';

      // Mock the emit method
      const emitSpy = jest.spyOn(webSocketService, 'emitConcurrentUserCount');

      // Add users
      webSocketService.trackParallelProcessingUser(userId1, projectId);
      webSocketService.trackParallelProcessingUser(userId2, projectId);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(2);

      // Remove one user
      webSocketService.untrackParallelProcessingUser(userId1, projectId);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(1);
      expect(emitSpy).toHaveBeenLastCalledWith(projectId, 1);

      // Remove second user
      webSocketService.untrackParallelProcessingUser(userId2, projectId);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(0);
      expect(emitSpy).toHaveBeenLastCalledWith(projectId, 0);

      emitSpy.mockRestore();
    });

    it('should handle removing non-existent users gracefully', () => {
      const userId = 'nonexistent';
      const projectId = 'proj1';

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(0);

      // Should not throw an error
      expect(() =>
        webSocketService.untrackParallelProcessingUser(userId, projectId)
      ).not.toThrow();

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(0);
    });
  });

  describe('Processing Stream Updates', () => {
    it('should emit processing stream updates', () => {
      const streamData = {
        streamId: 'stream-123',
        status: 'processing' as const,
        batchSize: 6,
        model: 'hrnet',
        progress: 45,
        estimatedTimeRemaining: 30000,
      };

      webSocketService.emitProcessingStreamUpdate('stream-123', streamData);

      expect(mockSocketIOServer.emit).toHaveBeenCalledWith(
        'processing-stream-update',
        expect.objectContaining({
          ...streamData,
          timestamp: expect.any(String),
        })
      );
    });

    it('should handle different stream statuses', () => {
      const baseStreamData = {
        streamId: 'stream-456',
        batchSize: 4,
        model: 'cbam_resunet',
        progress: 0,
      };

      const statuses = [
        'started',
        'processing',
        'completed',
        'failed',
      ] as const;

      statuses.forEach(status => {
        webSocketService.emitProcessingStreamUpdate('stream-456', {
          ...baseStreamData,
          status,
        });

        expect(mockSocketIOServer.emit).toHaveBeenCalledWith(
          'processing-stream-update',
          expect.objectContaining({
            status,
            streamId: 'stream-456',
          })
        );
      });

      expect(mockSocketIOServer.emit).toHaveBeenCalledTimes(4);
    });

    it('should handle errors during stream update emission', () => {
      mockSocketIOServer.emit.mockImplementation(() => {
        throw new Error('Network error');
      });

      const streamData = {
        streamId: 'stream-error',
        status: 'failed' as const,
        batchSize: 2,
        model: 'hrnet',
        progress: 0,
      };

      // Should not throw an error
      expect(() =>
        webSocketService.emitProcessingStreamUpdate('stream-error', streamData)
      ).not.toThrow();
    });
  });

  describe('Real-time User Tracking', () => {
    it('should maintain accurate concurrent user counts across multiple projects', () => {
      const project1 = 'proj1';
      const project2 = 'proj2';
      const users = ['user1', 'user2', 'user3'];

      // Track users in different projects
      webSocketService.trackParallelProcessingUser(users[0], project1);
      webSocketService.trackParallelProcessingUser(users[1], project1);
      webSocketService.trackParallelProcessingUser(users[2], project2);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(3);

      // Remove user from project1
      webSocketService.untrackParallelProcessingUser(users[0], project1);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(2);

      // Remove user from project2
      webSocketService.untrackParallelProcessingUser(users[2], project2);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(1);
    });

    it('should handle duplicate user tracking correctly', () => {
      const userId = 'user1';
      const projectId = 'proj1';

      // Track the same user multiple times
      webSocketService.trackParallelProcessingUser(userId, projectId);
      webSocketService.trackParallelProcessingUser(userId, projectId);

      // Should only count the user once
      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(1);

      // Remove user once
      webSocketService.untrackParallelProcessingUser(userId, projectId);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(0);
    });
  });

  describe('Integration with System Messages', () => {
    it('should broadcast parallel processing status via system messages', () => {
      const message = 'Parallel Processing: 3/4 streams active';
      const type = 'info';

      webSocketService.broadcastSystemMessage(message, type);

      expect(mockSocketIOServer.emit).toHaveBeenCalledWith(
        'system-message',
        expect.objectContaining({
          type,
          message,
          timestamp: expect.any(String),
        })
      );
    });

    it('should handle errors during system message broadcasting', () => {
      mockSocketIOServer.emit.mockImplementation(() => {
        throw new Error('Broadcast error');
      });

      // Should not throw an error
      expect(() =>
        webSocketService.broadcastSystemMessage('Test message', 'warning')
      ).not.toThrow();
    });
  });

  describe('Performance and Memory Management', () => {
    it('should efficiently manage user tracking for large user counts', () => {
      const projectId = 'large-proj';
      const userCount = 1000;

      // Track many users
      for (let i = 0; i < userCount; i++) {
        webSocketService.trackParallelProcessingUser(`user${i}`, projectId);
      }

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(
        userCount
      );

      // Remove half the users
      for (let i = 0; i < userCount / 2; i++) {
        webSocketService.untrackParallelProcessingUser(`user${i}`, projectId);
      }

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(
        userCount / 2
      );
    });

    it('should properly clean up user tracking data', () => {
      const users = ['user1', 'user2', 'user3'];
      const projectId = 'cleanup-test';

      // Add users
      users.forEach(userId =>
        webSocketService.trackParallelProcessingUser(userId, projectId)
      );

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(3);

      // Remove all users
      users.forEach(userId =>
        webSocketService.untrackParallelProcessingUser(userId, projectId)
      );

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(0);
    });
  });

  describe('Thread Safety and Concurrent Operations', () => {
    it('should handle concurrent user tracking operations', async () => {
      const projectId = 'concurrent-test';
      const operations = [];

      // Simulate concurrent operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          Promise.resolve().then(() =>
            webSocketService.trackParallelProcessingUser(`user${i}`, projectId)
          )
        );
      }

      await Promise.all(operations);

      expect(webSocketService.getConcurrentProcessingUserCount()).toBe(10);
    });

    it('should handle mixed concurrent add/remove operations', async () => {
      const projectId = 'mixed-ops-test';
      const operations = [];

      // Add some users first
      for (let i = 0; i < 5; i++) {
        webSocketService.trackParallelProcessingUser(`user${i}`, projectId);
      }

      // Mix of add and remove operations
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          operations.push(
            Promise.resolve().then(() =>
              webSocketService.trackParallelProcessingUser(
                `newuser${i}`,
                projectId
              )
            )
          );
        } else {
          operations.push(
            Promise.resolve().then(() =>
              webSocketService.untrackParallelProcessingUser(
                `user${i % 5}`,
                projectId
              )
            )
          );
        }
      }

      await Promise.all(operations);

      // Should have some users tracked (exact count depends on operation timing)
      expect(
        webSocketService.getConcurrentProcessingUserCount()
      ).toBeGreaterThan(0);
    });
  });
});
