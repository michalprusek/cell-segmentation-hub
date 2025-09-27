import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocketManager, {
  QueueStats,
  SegmentationUpdate,
} from '@/services/webSocketManager';
import { io } from 'socket.io-client';
import { webSocketEventEmitter } from '@/lib/websocketEvents';

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock config
vi.mock('@/lib/config', () => ({
  default: {
    apiBaseUrl: 'http://localhost:3001/api',
  },
}));

// Mock websocket event emitter
vi.mock('@/lib/websocketEvents', () => ({
  webSocketEventEmitter: {
    emit: vi.fn(),
  },
}));

describe('WebSocket Integration Tests', () => {
  let mockSocket: any;
  let wsManager: WebSocketManager;

  beforeEach(() => {
    // Create comprehensive mock socket
    mockSocket = {
      connected: false,
      id: 'socket-123',
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn(),
      io: {
        on: vi.fn(),
        off: vi.fn(),
      },
    };

    vi.mocked(io).mockReturnValue(mockSocket);
    wsManager = WebSocketManager.getInstance();
    vi.clearAllMocks();
  });

  afterEach(() => {
    wsManager.disconnect();
    WebSocketManager.cleanup();
    vi.clearAllMocks();
  });

  describe('Queue Processing Workflow', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };
    const projectId = 'project-456';

    beforeEach(async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;
    });

    it('should handle complete segmentation queue workflow', async () => {
      const queueStatsListener = vi.fn();
      const segmentationUpdateListener = vi.fn();
      const notificationListener = vi.fn();

      wsManager.on('queue-stats-update', queueStatsListener);
      wsManager.on('segmentation-update', segmentationUpdateListener);
      wsManager.on('notification', notificationListener);

      // Join project room
      wsManager.joinProject(projectId);
      expect(mockSocket.emit).toHaveBeenCalledWith('join-project', projectId);

      // Request initial queue stats
      wsManager.requestQueueStats(projectId);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'request-queue-stats',
        projectId
      );

      // Simulate initial queue stats response
      const initialStats: QueueStats = {
        projectId,
        queued: 5,
        processing: 0,
        total: 5,
      };

      const queueStatsHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'queue-stats-update'
      )?.[1];
      queueStatsHandler?.(initialStats);

      expect(queueStatsListener).toHaveBeenCalledWith(initialStats);

      // Simulate processing start
      const processingUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId,
        status: 'processing',
        queueId: 'queue-item-1',
        progress: 0,
      };

      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      segmentationHandler?.(processingUpdate);

      expect(segmentationUpdateListener).toHaveBeenCalledWith(processingUpdate);

      // Simulate processing progress updates
      const progressUpdates = [25, 50, 75, 100];

      for (const progress of progressUpdates) {
        const progressUpdate: SegmentationUpdate = {
          imageId: 'image-1',
          projectId,
          status: 'processing',
          queueId: 'queue-item-1',
          progress,
        };

        segmentationHandler?.(progressUpdate);
        expect(segmentationUpdateListener).toHaveBeenCalledWith(progressUpdate);
      }

      // Simulate processing completion
      const completionUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId,
        status: 'completed',
        queueId: 'queue-item-1',
        progress: 100,
      };

      segmentationHandler?.(completionUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(completionUpdate);

      // Simulate completion notification
      const notification = {
        type: 'segmentation-complete',
        imageId: 'image-1',
        projectId,
        polygonCount: 15,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const notificationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'notification'
      )?.[1];
      notificationHandler?.(notification);

      expect(notificationListener).toHaveBeenCalledWith(notification);

      // Simulate updated queue stats
      const updatedStats: QueueStats = {
        projectId,
        queued: 4,
        processing: 0,
        total: 5,
      };

      queueStatsHandler?.(updatedStats);
      expect(queueStatsListener).toHaveBeenCalledWith(updatedStats);

      // Verify all expected calls
      expect(segmentationUpdateListener).toHaveBeenCalledTimes(6); // start + 4 progress + completion
      expect(queueStatsListener).toHaveBeenCalledTimes(2); // initial + updated
      expect(notificationListener).toHaveBeenCalledTimes(1);
    });

    it('should handle processing errors in queue workflow', async () => {
      const segmentationUpdateListener = vi.fn();
      const systemMessageListener = vi.fn();

      wsManager.on('segmentation-update', segmentationUpdateListener);
      wsManager.on('system-message', systemMessageListener);

      // Join project and start processing
      wsManager.joinProject(projectId);

      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      const systemMessageHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'system-message'
      )?.[1];

      // Simulate processing start
      const startUpdate: SegmentationUpdate = {
        imageId: 'image-2',
        projectId,
        status: 'processing',
        queueId: 'queue-item-2',
        progress: 0,
      };

      segmentationHandler?.(startUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(startUpdate);

      // Simulate processing error
      const errorUpdate: SegmentationUpdate = {
        imageId: 'image-2',
        projectId,
        status: 'failed',
        queueId: 'queue-item-2',
        error: 'Out of memory during segmentation',
      };

      segmentationHandler?.(errorUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(errorUpdate);

      // Simulate system error message
      const systemMessage = {
        type: 'error' as const,
        message: 'Processing failed for image-2: Out of memory',
        timestamp: '2024-01-01T00:05:00Z',
      };

      systemMessageHandler?.(systemMessage);
      expect(systemMessageListener).toHaveBeenCalledWith(systemMessage);
    });

    it('should handle batch processing workflow', async () => {
      const queueStatsListener = vi.fn();
      const segmentationUpdateListener = vi.fn();

      wsManager.on('queue-stats-update', queueStatsListener);
      wsManager.on('segmentation-update', segmentationUpdateListener);

      wsManager.joinProject(projectId);

      const queueStatsHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'queue-stats-update'
      )?.[1];
      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];

      // Initial batch stats
      const batchStats: QueueStats = {
        projectId,
        queued: 10,
        processing: 0,
        total: 10,
      };

      queueStatsHandler?.(batchStats);

      // Simulate concurrent processing of multiple images
      const imageIds = ['img-1', 'img-2', 'img-3'];

      // Start processing all images
      imageIds.forEach((imageId, index) => {
        const startUpdate: SegmentationUpdate = {
          imageId,
          projectId,
          status: 'processing',
          queueId: `queue-${index + 1}`,
          progress: 0,
        };
        segmentationHandler?.(startUpdate);
      });

      expect(segmentationUpdateListener).toHaveBeenCalledTimes(3);

      // Complete processing in random order
      const completionOrder = [2, 0, 1]; // Complete img-3, img-1, img-2

      completionOrder.forEach(index => {
        const completionUpdate: SegmentationUpdate = {
          imageId: imageIds[index],
          projectId,
          status: 'completed',
          queueId: `queue-${index + 1}`,
          progress: 100,
        };
        segmentationHandler?.(completionUpdate);

        // Update queue stats after each completion
        const updatedStats: QueueStats = {
          projectId,
          queued: 10 - (completionOrder.indexOf(index) + 1),
          processing: 0,
          total: 10,
        };
        queueStatsHandler?.(updatedStats);
      });

      // Verify all processing completed
      expect(segmentationUpdateListener).toHaveBeenCalledTimes(6); // 3 starts + 3 completions
      expect(queueStatsListener).toHaveBeenCalledTimes(4); // initial + 3 updates
    });
  });

  describe('Real-time Connection Management', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    it('should handle connection loss and reconnection during queue processing', async () => {
      const disconnectListener = vi.fn();
      const connectListener = vi.fn();
      const segmentationUpdateListener = vi.fn();

      wsManager.on('disconnect', disconnectListener);
      wsManager.on('connect', connectListener);
      wsManager.on('segmentation-update', segmentationUpdateListener);

      // Initial connection
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Start processing
      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];

      const processingUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'processing',
        progress: 50,
      };

      segmentationHandler?.(processingUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(processingUpdate);

      vi.clearAllMocks();

      // Simulate connection loss
      mockSocket.connected = false;
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.('transport close');

      expect(disconnectListener).toHaveBeenCalledWith('transport close');

      // Simulate reconnection
      const reconnectHandler = mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect'
      )?.[1];
      mockSocket.connected = true;
      reconnectHandler?.(2); // Reconnected after 2 attempts

      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'reconnected',
      });

      // Simulate processing continuation after reconnection
      const continuedUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'processing',
        progress: 75,
      };

      segmentationHandler?.(continuedUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(continuedUpdate);
    });

    it('should handle message queuing during disconnection', async () => {
      // Connect initially
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Disconnect
      mockSocket.connected = false;
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.('transport close');

      vi.clearAllMocks();

      // Try to emit messages while disconnected
      wsManager.emit('join-project', 'project-1');
      wsManager.emit('request-queue-stats', 'project-1');
      wsManager.emit('custom-event', { data: 'test' });

      // Messages should not be emitted immediately
      expect(mockSocket.emit).not.toHaveBeenCalled();

      // Reconnect
      mockSocket.connected = true;
      connectHandler?.(); // Simulate reconnection

      // All queued messages should be flushed
      expect(mockSocket.emit).toHaveBeenCalledWith('join-project', 'project-1');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'request-queue-stats',
        'project-1'
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('custom-event', {
        data: 'test',
      });
      expect(mockSocket.emit).toHaveBeenCalledTimes(3);
    });

    it('should handle multiple rapid reconnections', async () => {
      const connectListener = vi.fn();
      const disconnectListener = vi.fn();

      wsManager.on('connect', connectListener);
      wsManager.on('disconnect', disconnectListener);

      // Initial connection
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Simulate rapid disconnect/reconnect cycles
      for (let i = 0; i < 5; i++) {
        mockSocket.connected = false;
        disconnectHandler?.(`disconnect-${i}`);

        mockSocket.connected = true;
        connectHandler?.();
      }

      expect(connectListener).toHaveBeenCalledTimes(6); // Initial + 5 reconnections
      expect(disconnectListener).toHaveBeenCalledTimes(5);
    });
  });

  describe('Multi-Project Real-time Updates', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };
    const project1 = 'project-1';
    const project2 = 'project-2';

    beforeEach(async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;
    });

    it('should handle updates for multiple projects simultaneously', async () => {
      const queueStatsListener = vi.fn();
      const segmentationUpdateListener = vi.fn();

      wsManager.on('queue-stats-update', queueStatsListener);
      wsManager.on('segmentation-update', segmentationUpdateListener);

      // Join multiple project rooms
      wsManager.joinProject(project1);
      wsManager.joinProject(project2);

      expect(mockSocket.emit).toHaveBeenCalledWith('join-project', project1);
      expect(mockSocket.emit).toHaveBeenCalledWith('join-project', project2);

      const queueStatsHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'queue-stats-update'
      )?.[1];
      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];

      // Simulate concurrent processing in both projects
      const project1Update: SegmentationUpdate = {
        imageId: 'image-1-1',
        projectId: project1,
        status: 'processing',
        progress: 25,
      };

      const project2Update: SegmentationUpdate = {
        imageId: 'image-2-1',
        projectId: project2,
        status: 'processing',
        progress: 50,
      };

      segmentationHandler?.(project1Update);
      segmentationHandler?.(project2Update);

      expect(segmentationUpdateListener).toHaveBeenCalledWith(project1Update);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(project2Update);

      // Simulate queue stats updates for both projects
      const project1Stats: QueueStats = {
        projectId: project1,
        queued: 3,
        processing: 1,
        total: 4,
      };

      const project2Stats: QueueStats = {
        projectId: project2,
        queued: 2,
        processing: 1,
        total: 3,
      };

      queueStatsHandler?.(project1Stats);
      queueStatsHandler?.(project2Stats);

      expect(queueStatsListener).toHaveBeenCalledWith(project1Stats);
      expect(queueStatsListener).toHaveBeenCalledWith(project2Stats);
    });

    it('should handle project room switching', async () => {
      const segmentationUpdateListener = vi.fn();
      wsManager.on('segmentation-update', segmentationUpdateListener);

      // Join project1
      wsManager.joinProject(project1);
      expect(mockSocket.emit).toHaveBeenLastCalledWith(
        'join-project',
        project1
      );

      // Leave project1 and join project2
      wsManager.leaveProject(project1);
      wsManager.joinProject(project2);

      expect(mockSocket.emit).toHaveBeenCalledWith('leave-project', project1);
      expect(mockSocket.emit).toHaveBeenLastCalledWith(
        'join-project',
        project2
      );

      // Should only receive updates for project2
      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];

      const project2Update: SegmentationUpdate = {
        imageId: 'image-2-1',
        projectId: project2,
        status: 'completed',
        progress: 100,
      };

      segmentationHandler?.(project2Update);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(project2Update);
    });
  });

  describe('Error Recovery and Resilience', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    beforeEach(async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;
    });

    it('should recover from malformed server messages', async () => {
      const segmentationUpdateListener = vi.fn();
      const queueStatsListener = vi.fn();

      wsManager.on('segmentation-update', segmentationUpdateListener);
      wsManager.on('queue-stats-update', queueStatsListener);

      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      const queueStatsHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'queue-stats-update'
      )?.[1];

      // Ensure handlers are defined
      expect(segmentationHandler).toBeDefined();
      expect(queueStatsHandler).toBeDefined();

      // Send malformed messages
      expect(() => segmentationHandler!(null)).not.toThrow();
      expect(() => segmentationHandler!(undefined)).not.toThrow();
      expect(() => segmentationHandler!('invalid-string')).not.toThrow();
      expect(() => segmentationHandler!({})).not.toThrow();

      expect(() => queueStatsHandler!(null)).not.toThrow();
      expect(() => queueStatsHandler!({})).not.toThrow();

      // Send valid message after malformed ones
      const validUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'completed',
        progress: 100,
      };

      segmentationHandler!(validUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(validUpdate);
    });

    it('should handle server disconnection during processing', async () => {
      const segmentationUpdateListener = vi.fn();
      wsManager.on('segmentation-update', segmentationUpdateListener);

      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];

      // Start processing
      const processingUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'processing',
        progress: 25,
      };

      segmentationHandler?.(processingUpdate);

      // Server forcefully disconnects
      mockSocket.connected = false;
      disconnectHandler?.('io server disconnect');

      // Should emit connection lost event
      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'connection_lost',
      });

      // Should attempt manual reconnection for server disconnects
      // (This would be handled by the reconnection logic in the actual implementation)
    });

    it('should handle listener exceptions during event processing', async () => {
      const goodListener = vi.fn();
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const anotherGoodListener = vi.fn();

      wsManager.on('segmentation-update', goodListener);
      wsManager.on('segmentation-update', errorListener);
      wsManager.on('segmentation-update', anotherGoodListener);

      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];

      const update: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'completed',
        progress: 100,
      };

      // Should not throw despite error in middle listener
      expect(() => segmentationHandler?.(update)).not.toThrow();

      // Good listeners should still be called
      expect(goodListener).toHaveBeenCalledWith(update);
      expect(anotherGoodListener).toHaveBeenCalledWith(update);
    });
  });

  describe('Performance and Memory', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    beforeEach(async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;
    });

    it('should handle high-frequency updates without memory leaks', async () => {
      const segmentationUpdateListener = vi.fn();
      wsManager.on('segmentation-update', segmentationUpdateListener);

      const segmentationHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];

      // Send many rapid updates
      for (let i = 0; i < 1000; i++) {
        const update: SegmentationUpdate = {
          imageId: `image-${i}`,
          projectId: 'project-1',
          status: 'processing',
          progress: i % 101,
        };
        segmentationHandler?.(update);
      }

      expect(segmentationUpdateListener).toHaveBeenCalledTimes(1000);

      // Remove listener to test cleanup
      wsManager.off('segmentation-update', segmentationUpdateListener);

      // Send more updates
      for (let i = 0; i < 100; i++) {
        const update: SegmentationUpdate = {
          imageId: `cleanup-image-${i}`,
          projectId: 'project-1',
          status: 'processing',
          progress: i,
        };
        segmentationHandler?.(update);
      }

      // Listener should not be called after removal
      expect(segmentationUpdateListener).toHaveBeenCalledTimes(1000);
    });

    it('should handle large message queue without performance degradation', async () => {
      // Disconnect to queue messages
      mockSocket.connected = false;
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.('transport close');

      // Queue many messages
      for (let i = 0; i < 500; i++) {
        wsManager.emit(`event-${i}`, { data: i });
      }

      vi.clearAllMocks();

      // Reconnect and measure performance
      const startTime = performance.now();
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      const endTime = performance.now();

      // All messages should be flushed
      expect(mockSocket.emit).toHaveBeenCalledTimes(500);

      // Should complete in reasonable time (less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});
