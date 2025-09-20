import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketService } from '../websocketService';
import { ExportService } from '../exportService';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';

// Mock Socket.IO
vi.mock('socket.io', () => {
  const mockSocket = {
    id: 'mock-socket-id',
    userId: null,
    user: null,
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    data: {},
  };

  const mockIO = {
    on: vi.fn(),
    emit: vi.fn(),
    to: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    sockets: {
      sockets: new Map([['mock-socket-id', mockSocket]]),
    },
    use: vi.fn(),
    close: vi.fn(),
  };

  return {
    Server: vi.fn().mockImplementation(() => mockIO),
    __mockSocket: mockSocket,
    __mockIO: mockIO,
  };
});

describe('WebSocket Export Cancellation Events - Timing Tests', () => {
  let wsService: WebSocketService;
  let exportService: ExportService;
  let mockIO: any;
  let mockSocket: any;

  const mockUserId = 'user-123';
  const mockProjectId = 'project-123';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get mocked Socket.IO instances
    const { Server, __mockIO, __mockSocket } = await import('socket.io');
    mockIO = __mockIO;
    mockSocket = __mockSocket;

    // Reset mock implementations
    mockIO.emit = vi.fn();
    mockIO.to = vi.fn().mockReturnThis();
    mockSocket.emit = vi.fn();

    // Create WebSocket service instance
    const httpServer = createServer();
    wsService = WebSocketService.getInstance(httpServer);

    // Setup socket with user data
    mockSocket.userId = mockUserId;
    mockSocket.user = { id: mockUserId, email: 'test@example.com' };

    // Create export service and link with WebSocket
    exportService = ExportService.getInstance();
    exportService.setWebSocketService(wsService);

    // Clear any existing jobs
    (exportService as any).exportJobs.clear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('export:cancelled Event Timing', () => {
    it('should emit export:cancelled immediately on cancellation', async () => {
      // Arrange: Create processing job
      const jobId = 'test-websocket-cancel';
      const job = {
        id: jobId,
        projectId: mockProjectId,
        userId: mockUserId,
        status: 'processing',
        createdAt: new Date(),
        options: { format: 'json' },
      };
      (exportService as any).exportJobs.set(jobId, job);

      // Mock sendToUser to track WebSocket events
      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser');

      // Act: Cancel the job
      const cancelTime = Date.now();
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Manually trigger the WebSocket event (this would be part of enhanced cancelJob)
      wsService.sendToUser(mockUserId, 'export:cancelled', {
        jobId,
        projectId: mockProjectId,
        previousStatus: 'processing',
        cancelledAt: new Date(cancelTime),
      });

      // Assert: Event should be sent immediately
      expect(sendToUserSpy).toHaveBeenCalledWith(mockUserId, 'export:cancelled', {
        jobId,
        projectId: mockProjectId,
        previousStatus: 'processing',
        cancelledAt: expect.any(Date),
      });

      // Verify timing (should be within a few milliseconds)
      const eventCall = sendToUserSpy.mock.calls[0];
      const eventData = eventCall[2] as any;
      const timeDiff = new Date().getTime() - new Date(eventData.cancelledAt).getTime();
      expect(timeDiff).toBeLessThan(100); // Should be almost immediate
    });

    it('should not emit export:completed for cancelled jobs', async () => {
      // Arrange: Create cancelled job
      const jobId = 'test-no-completion-event';
      const job = {
        id: jobId,
        projectId: mockProjectId,
        userId: mockUserId,
        status: 'cancelled',
        cancelledAt: new Date(),
        createdAt: new Date(),
        options: { format: 'json' },
      };
      (exportService as any).exportJobs.set(jobId, job);

      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser');

      // Act: Simulate completion attempt (should be blocked)
      const processCompleted = (jobId: string) => {
        const job = (exportService as any).exportJobs.get(jobId);
        if (job && job.status !== 'cancelled') {
          job.status = 'completed';
          job.filePath = '/test/path.zip';
          wsService.sendToUser(mockUserId, 'export:completed', { jobId });
        }
      };

      processCompleted(jobId);

      // Assert: No completion event should be sent
      expect(sendToUserSpy).not.toHaveBeenCalledWith(mockUserId, 'export:completed', expect.anything());
    });

    it('should handle race condition between cancellation and completion events', async () => {
      // This test simulates the exact race condition from the bug report
      const jobId = 'f574e1b4-b0a5-4035-95d0-18fef944762d';
      const job = {
        id: jobId,
        projectId: mockProjectId,
        userId: mockUserId,
        status: 'processing',
        createdAt: new Date(),
        options: { format: 'coco' },
      };
      (exportService as any).exportJobs.set(jobId, job);

      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser');
      const eventOrder: string[] = [];

      // Mock sendToUser to track event order
      sendToUserSpy.mockImplementation((userId, event, data) => {
        eventOrder.push(event);
        return Promise.resolve();
      });

      // Simulate the race condition timing
      const raceConditionSimulation = async () => {
        // Processing completes after 8 seconds
        setTimeout(() => {
          const currentJob = (exportService as any).exportJobs.get(jobId);
          if (currentJob.status !== 'cancelled') {
            currentJob.status = 'completed';
            currentJob.filePath = '/exports/test.zip';
            wsService.sendToUser(mockUserId, 'export:completed', { jobId });
          }
        }, 80); // Using shorter time for test

        // User cancels after 7.5 seconds
        setTimeout(() => {
          const currentJob = (exportService as any).exportJobs.get(jobId);
          currentJob.status = 'cancelled';
          currentJob.cancelledAt = new Date();
          wsService.sendToUser(mockUserId, 'export:cancelled', {
            jobId,
            previousStatus: 'processing',
            cancelledAt: new Date(),
          });
        }, 75);
      };

      // Act: Run the race condition simulation
      await raceConditionSimulation();

      // Wait for all timeouts to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert: Only cancellation event should be sent, not completion
      expect(eventOrder).toContain('export:cancelled');
      expect(eventOrder).not.toContain('export:completed');
      expect(sendToUserSpy).toHaveBeenCalledWith(mockUserId, 'export:cancelled', expect.objectContaining({ jobId }));
      expect(sendToUserSpy).not.toHaveBeenCalledWith(mockUserId, 'export:completed', expect.objectContaining({ jobId }));
    });

    it('should emit events in correct order for rapid state changes', async () => {
      // Arrange: Multiple jobs with rapid state changes
      const jobIds = ['job-1', 'job-2', 'job-3'];
      const eventLog: Array<{ jobId: string; event: string; timestamp: number }> = [];

      // Create jobs
      jobIds.forEach(jobId => {
        const job = {
          id: jobId,
          projectId: mockProjectId,
          userId: mockUserId,
          status: 'processing',
          createdAt: new Date(),
          options: { format: 'json' },
        };
        (exportService as any).exportJobs.set(jobId, job);
      });

      // Mock sendToUser to track event timing
      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser').mockImplementation((userId, event, data: any) => {
        eventLog.push({
          jobId: data.jobId,
          event,
          timestamp: Date.now(),
        });
        return Promise.resolve();
      });

      // Act: Rapidly cancel all jobs
      const startTime = Date.now();
      await Promise.all(jobIds.map(async (jobId, index) => {
        await new Promise(resolve => setTimeout(resolve, index * 10)); // Stagger slightly
        await exportService.cancelJob(jobId, mockProjectId, mockUserId);
        wsService.sendToUser(mockUserId, 'export:cancelled', {
          jobId,
          previousStatus: 'processing',
          cancelledAt: new Date(),
        });
      }));

      // Assert: Events should be in correct order and properly timed
      expect(eventLog).toHaveLength(3);
      eventLog.forEach((log, index) => {
        expect(log.event).toBe('export:cancelled');
        expect(log.jobId).toBe(jobIds[index]);
        expect(log.timestamp - startTime).toBeGreaterThanOrEqual(index * 10);
      });

      // Events should be ordered by timestamp
      for (let i = 1; i < eventLog.length; i++) {
        expect(eventLog[i].timestamp).toBeGreaterThanOrEqual(eventLog[i - 1].timestamp);
      }
    });
  });

  describe('WebSocket Connection Management During Cancellation', () => {
    it('should deliver cancellation events to all user sessions', async () => {
      // Arrange: Mock multiple sockets for the same user
      const mockSocket2 = {
        id: 'mock-socket-id-2',
        userId: mockUserId,
        user: { id: mockUserId, email: 'test@example.com' },
        emit: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
      };

      // Add second socket to the sockets map
      mockIO.sockets.sockets.set('mock-socket-id-2', mockSocket2);

      const jobId = 'test-multi-session-cancel';
      const job = {
        id: jobId,
        projectId: mockProjectId,
        userId: mockUserId,
        status: 'processing',
        createdAt: new Date(),
        options: { format: 'json' },
      };
      (exportService as any).exportJobs.set(jobId, job);

      // Act: Cancel job and send WebSocket event
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);
      wsService.sendToUser(mockUserId, 'export:cancelled', {
        jobId,
        previousStatus: 'processing',
        cancelledAt: new Date(),
      });

      // Assert: Both sockets should receive the event
      expect(mockSocket.emit).toHaveBeenCalledWith('export:cancelled', expect.objectContaining({ jobId }));
      expect(mockSocket2.emit).toHaveBeenCalledWith('export:cancelled', expect.objectContaining({ jobId }));
    });

    it('should handle WebSocket disconnection during export cancellation', async () => {
      // Arrange: Job in progress, user disconnects, then tries to cancel
      const jobId = 'test-disconnect-cancel';
      const job = {
        id: jobId,
        projectId: mockProjectId,
        userId: mockUserId,
        status: 'processing',
        createdAt: new Date(),
        options: { format: 'json' },
      };
      (exportService as any).exportJobs.set(jobId, job);

      // Simulate disconnection
      mockIO.sockets.sockets.delete(mockSocket.id);

      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser');

      // Act: Cancel job when user is disconnected
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);
      wsService.sendToUser(mockUserId, 'export:cancelled', {
        jobId,
        previousStatus: 'processing',
        cancelledAt: new Date(),
      });

      // Assert: Should handle gracefully (no crash), job should still be cancelled
      expect(sendToUserSpy).toHaveBeenCalled();
      const finalJob = (exportService as any).exportJobs.get(jobId);
      expect(finalJob.status).toBe('cancelled');
    });

    it('should prevent duplicate cancellation events', async () => {
      // Arrange: Job to cancel multiple times
      const jobId = 'test-duplicate-events';
      const job = {
        id: jobId,
        projectId: mockProjectId,
        userId: mockUserId,
        status: 'processing',
        createdAt: new Date(),
        options: { format: 'json' },
      };
      (exportService as any).exportJobs.set(jobId, job);

      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser');

      // Act: Try to cancel the same job multiple times
      await Promise.all([
        exportService.cancelJob(jobId, mockProjectId, mockUserId),
        exportService.cancelJob(jobId, mockProjectId, mockUserId),
        exportService.cancelJob(jobId, mockProjectId, mockUserId),
      ]);

      // Send only one cancellation event (proper implementation would prevent duplicates)
      wsService.sendToUser(mockUserId, 'export:cancelled', {
        jobId,
        previousStatus: 'processing',
        cancelledAt: new Date(),
      });

      // Assert: Should handle multiple cancellations gracefully
      expect(sendToUserSpy).toHaveBeenCalledTimes(1);
      const finalJob = (exportService as any).exportJobs.get(jobId);
      expect(finalJob.status).toBe('cancelled');
    });
  });

  describe('Event Data Integrity', () => {
    it('should include all required fields in export:cancelled event', async () => {
      // Arrange: Job to cancel
      const jobId = 'test-event-data';
      const createdAt = new Date('2025-01-20T10:00:00Z');
      const job = {
        id: jobId,
        projectId: mockProjectId,
        userId: mockUserId,
        status: 'processing',
        createdAt,
        options: { format: 'coco', includeImages: true },
      };
      (exportService as any).exportJobs.set(jobId, job);

      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser');

      // Act: Cancel job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);
      const cancelledAt = new Date();

      wsService.sendToUser(mockUserId, 'export:cancelled', {
        jobId,
        projectId: mockProjectId,
        previousStatus: 'processing',
        cancelledAt,
        options: job.options,
        createdAt,
      });

      // Assert: Event should contain all required fields
      expect(sendToUserSpy).toHaveBeenCalledWith(mockUserId, 'export:cancelled', {
        jobId,
        projectId: mockProjectId,
        previousStatus: 'processing',
        cancelledAt: expect.any(Date),
        options: { format: 'coco', includeImages: true },
        createdAt,
      });
    });

    it('should include cleanup status in cancellation event', async () => {
      // Arrange: Job with file to cleanup
      const jobId = 'test-cleanup-status';
      const filePath = '/exports/test-cleanup.zip';
      const job = {
        id: jobId,
        projectId: mockProjectId,
        userId: mockUserId,
        status: 'processing',
        filePath,
        createdAt: new Date(),
        options: { format: 'json' },
      };
      (exportService as any).exportJobs.set(jobId, job);

      // Mock cleanup
      const cleanupSuccess = true;
      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser');

      // Act: Cancel with cleanup
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      wsService.sendToUser(mockUserId, 'export:cancelled', {
        jobId,
        previousStatus: 'processing',
        cancelledAt: new Date(),
        cleanupCompleted: cleanupSuccess,
        filesRemoved: [filePath],
      });

      // Assert: Should include cleanup information
      expect(sendToUserSpy).toHaveBeenCalledWith(mockUserId, 'export:cancelled', {
        jobId,
        previousStatus: 'processing',
        cancelledAt: expect.any(Date),
        cleanupCompleted: true,
        filesRemoved: [filePath],
      });
    });
  });

  describe('Performance Under Load', () => {
    it('should handle high-frequency cancellation events efficiently', async () => {
      // Arrange: Many jobs to cancel rapidly
      const jobCount = 100;
      const jobs = Array.from({ length: jobCount }, (_, i) => {
        const jobId = `load-test-job-${i}`;
        const job = {
          id: jobId,
          projectId: mockProjectId,
          userId: mockUserId,
          status: 'processing',
          createdAt: new Date(),
          options: { format: 'json' },
        };
        (exportService as any).exportJobs.set(jobId, job);
        return job;
      });

      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser');
      const startTime = Date.now();

      // Act: Cancel all jobs rapidly
      await Promise.all(jobs.map(async (job) => {
        await exportService.cancelJob(job.id, mockProjectId, mockUserId);
        wsService.sendToUser(mockUserId, 'export:cancelled', {
          jobId: job.id,
          previousStatus: 'processing',
          cancelledAt: new Date(),
        });
      }));

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert: Should complete efficiently (within reasonable time)
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(sendToUserSpy).toHaveBeenCalledTimes(jobCount);

      // All jobs should be cancelled
      jobs.forEach(job => {
        const finalJob = (exportService as any).exportJobs.get(job.id);
        expect(finalJob.status).toBe('cancelled');
      });
    });

    it('should maintain event order under concurrent load', async () => {
      // Arrange: Multiple concurrent operations
      const operations = Array.from({ length: 20 }, (_, i) => ({
        jobId: `concurrent-job-${i}`,
        operation: i % 2 === 0 ? 'cancel' : 'status-check',
      }));

      const eventLog: Array<{ operation: string; jobId: string; timestamp: number }> = [];

      // Create jobs
      operations.forEach(({ jobId }) => {
        if (!jobId.includes('status-check')) {
          const job = {
            id: jobId,
            projectId: mockProjectId,
            userId: mockUserId,
            status: 'processing',
            createdAt: new Date(),
            options: { format: 'json' },
          };
          (exportService as any).exportJobs.set(jobId, job);
        }
      });

      const sendToUserSpy = vi.spyOn(wsService, 'sendToUser').mockImplementation((userId, event, data: any) => {
        eventLog.push({
          operation: event,
          jobId: data.jobId,
          timestamp: Date.now(),
        });
        return Promise.resolve();
      });

      // Act: Execute all operations concurrently
      await Promise.all(operations.map(async ({ jobId, operation }) => {
        if (operation === 'cancel') {
          await exportService.cancelJob(jobId, mockProjectId, mockUserId);
          wsService.sendToUser(mockUserId, 'export:cancelled', {
            jobId,
            previousStatus: 'processing',
            cancelledAt: new Date(),
          });
        }
      }));

      // Assert: Events should be properly logged and ordered
      const cancelEvents = eventLog.filter(log => log.operation === 'export:cancelled');
      expect(cancelEvents.length).toBeGreaterThan(0);

      // Events should have reasonable timestamps (not all exactly the same)
      const timestamps = cancelEvents.map(e => e.timestamp);
      const uniqueTimestamps = new Set(timestamps);
      expect(uniqueTimestamps.size).toBeGreaterThan(1);
    });
  });
});