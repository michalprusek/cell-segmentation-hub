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
    // Create reactive mock socket with proper connection lifecycle simulation
    let _connected = false;
    const _eventHandlers = new Map<string, Function[]>();
    const _ioEventHandlers = new Map<string, Function[]>();

    mockSocket = {
      // Reactive connected property using getter
      get connected() {
        return _connected;
      },

      id: 'socket-123',

      // Connect method that sets connected=true AND triggers handlers
      connect: vi.fn(() => {
        _connected = true;
        // Auto-call connect handlers
        const connectHandlers = _eventHandlers.get('connect') || [];
        connectHandlers.forEach(handler => handler());
        return mockSocket;
      }),

      // Disconnect method that sets connected=false AND triggers handlers
      disconnect: vi.fn(() => {
        _connected = false;
        const disconnectHandlers = _eventHandlers.get('disconnect') || [];
        disconnectHandlers.forEach(handler => handler('manual'));
        return mockSocket;
      }),

      // Event registration that stores handlers
      on: vi.fn((event: string, handler: Function) => {
        if (!_eventHandlers.has(event)) {
          _eventHandlers.set(event, []);
        }
        _eventHandlers.get(event)!.push(handler);
        return mockSocket;
      }),

      off: vi.fn((event: string, handler?: Function) => {
        if (handler) {
          const handlers = _eventHandlers.get(event) || [];
          const index = handlers.indexOf(handler);
          if (index > -1) {
            handlers.splice(index, 1);
          }
        } else {
          _eventHandlers.delete(event);
        }
        return mockSocket;
      }),

      // Emit helper to send events to server
      emit: vi.fn(),

      removeAllListeners: vi.fn(() => {
        _eventHandlers.clear();
        return mockSocket;
      }),

      io: {
        on: vi.fn((event: string, handler: Function) => {
          if (!_ioEventHandlers.has(event)) {
            _ioEventHandlers.set(event, []);
          }
          _ioEventHandlers.get(event)!.push(handler);
          return mockSocket.io;
        }),

        off: vi.fn((event: string, handler?: Function) => {
          if (handler) {
            const handlers = _ioEventHandlers.get(event) || [];
            const index = handlers.indexOf(handler);
            if (index > -1) {
              handlers.splice(index, 1);
            }
          } else {
            _ioEventHandlers.delete(event);
          }
          return mockSocket.io;
        }),
      },

      // Helper methods for testing - trigger events manually
      __triggerConnect: () => {
        _connected = true;
        const handlers = _eventHandlers.get('connect') || [];
        handlers.forEach(handler => handler());
      },

      __triggerDisconnect: (reason = 'transport close') => {
        _connected = false;
        const handlers = _eventHandlers.get('disconnect') || [];
        handlers.forEach(handler => handler(reason));
      },

      __triggerEvent: (event: string, ...args: any[]) => {
        const handlers = _eventHandlers.get(event) || [];
        handlers.forEach(handler => handler(...args));
      },

      __triggerIoEvent: (event: string, ...args: any[]) => {
        const handlers = _ioEventHandlers.get(event) || [];
        handlers.forEach(handler => handler(...args));
      },

      __setConnected: (value: boolean) => {
        _connected = value;
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
      // Start connection (io() gets called, event handlers registered)
      const connectPromise = wsManager.connect(mockUser);

      // Simulate successful connection immediately
      mockSocket.__triggerConnect();

      // Wait for connection to complete
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

      // Simulate initial queue stats response (backend emits 'queueStats')
      const initialStats: QueueStats = {
        projectId,
        queued: 5,
        processing: 0,
        total: 5,
      };
      mockSocket.__triggerEvent('queueStats', initialStats);
      expect(queueStatsListener).toHaveBeenCalledWith(initialStats);

      // Simulate processing start (backend emits 'segmentation-update')
      const processingUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId,
        status: 'processing',
        queueId: 'queue-item-1',
        progress: 0,
      };
      mockSocket.__triggerEvent('segmentation-update', processingUpdate);
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
        mockSocket.__triggerEvent('segmentation-update', progressUpdate);
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
      mockSocket.__triggerEvent('segmentation-update', completionUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(completionUpdate);

      // Simulate completion notification
      const notification = {
        type: 'segmentation-complete',
        imageId: 'image-1',
        projectId,
        polygonCount: 15,
        timestamp: '2024-01-01T00:00:00Z',
      };
      mockSocket.__triggerEvent('notification', notification);
      expect(notificationListener).toHaveBeenCalledWith(notification);

      // Simulate updated queue stats
      const updatedStats: QueueStats = {
        projectId,
        queued: 4,
        processing: 0,
        total: 5,
      };
      mockSocket.__triggerEvent('queueStats', updatedStats);
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

      // Simulate processing start
      const startUpdate: SegmentationUpdate = {
        imageId: 'image-2',
        projectId,
        status: 'processing',
        queueId: 'queue-item-2',
        progress: 0,
      };
      mockSocket.__triggerEvent('segmentation-update', startUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(startUpdate);

      // Simulate processing error
      const errorUpdate: SegmentationUpdate = {
        imageId: 'image-2',
        projectId,
        status: 'failed',
        queueId: 'queue-item-2',
        error: 'Out of memory during segmentation',
      };
      mockSocket.__triggerEvent('segmentation-update', errorUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(errorUpdate);

      // Simulate system error message
      const systemMessage = {
        type: 'error' as const,
        message: 'Processing failed for image-2: Out of memory',
        timestamp: '2024-01-01T00:05:00Z',
      };
      mockSocket.__triggerEvent('system-message', systemMessage);
      expect(systemMessageListener).toHaveBeenCalledWith(systemMessage);
    });

    it('should handle batch processing workflow', async () => {
      const queueStatsListener = vi.fn();
      const segmentationUpdateListener = vi.fn();

      wsManager.on('queue-stats-update', queueStatsListener);
      wsManager.on('segmentation-update', segmentationUpdateListener);

      wsManager.joinProject(projectId);

      // Initial batch stats
      const batchStats: QueueStats = {
        projectId,
        queued: 10,
        processing: 0,
        total: 10,
      };
      mockSocket.__triggerEvent('queueStats', batchStats);

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
        mockSocket.__triggerEvent('segmentation-update', startUpdate);
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
        mockSocket.__triggerEvent('segmentation-update', completionUpdate);

        // Update queue stats after each completion
        const updatedStats: QueueStats = {
          projectId,
          queued: 10 - (completionOrder.indexOf(index) + 1),
          processing: 0,
          total: 10,
        };
        mockSocket.__triggerEvent('queueStats', updatedStats);
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
      mockSocket.__triggerConnect();
      await connectPromise;

      // Start processing
      const processingUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'processing',
        progress: 50,
      };
      mockSocket.__triggerEvent('segmentation-update', processingUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(processingUpdate);

      vi.clearAllMocks();

      // Simulate connection loss
      mockSocket.__triggerDisconnect('transport close');
      expect(disconnectListener).toHaveBeenCalledWith('transport close');

      // Simulate reconnection
      mockSocket.__triggerIoEvent('reconnect', 2); // Reconnected after 2 attempts

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
      mockSocket.__triggerEvent('segmentation-update', continuedUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(continuedUpdate);
    });

    it('should handle message queuing during disconnection', async () => {
      // Connect initially
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.__triggerConnect();
      await connectPromise;

      // Disconnect
      mockSocket.__triggerDisconnect('transport close');

      vi.clearAllMocks();

      // Try to emit messages while disconnected
      wsManager.emit('join-project', 'project-1');
      wsManager.emit('request-queue-stats', 'project-1');
      wsManager.emit('custom-event', { data: 'test' });

      // Messages should not be emitted immediately
      expect(mockSocket.emit).not.toHaveBeenCalled();

      // Reconnect
      mockSocket.__triggerConnect();

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
      mockSocket.__triggerConnect();
      await connectPromise;

      // Simulate rapid disconnect/reconnect cycles
      for (let i = 0; i < 5; i++) {
        mockSocket.__triggerDisconnect(`disconnect-${i}`);
        mockSocket.__triggerConnect();
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
      mockSocket.__triggerConnect();
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

      mockSocket.__triggerEvent('segmentation-update', project1Update);
      mockSocket.__triggerEvent('segmentation-update', project2Update);

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

      mockSocket.__triggerEvent('queueStats', project1Stats);
      mockSocket.__triggerEvent('queueStats', project2Stats);

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

      // Should receive updates for project2
      const project2Update: SegmentationUpdate = {
        imageId: 'image-2-1',
        projectId: project2,
        status: 'completed',
        progress: 100,
      };

      mockSocket.__triggerEvent('segmentation-update', project2Update);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(project2Update);
    });
  });

  describe('Error Recovery and Resilience', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    beforeEach(async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.__triggerConnect();
      await connectPromise;
    });

    it('should recover from malformed server messages', async () => {
      const segmentationUpdateListener = vi.fn();
      const queueStatsListener = vi.fn();

      wsManager.on('segmentation-update', segmentationUpdateListener);
      wsManager.on('queue-stats-update', queueStatsListener);

      // Send malformed messages - should not throw
      expect(() =>
        mockSocket.__triggerEvent('segmentation-update', null)
      ).not.toThrow();
      expect(() =>
        mockSocket.__triggerEvent('segmentation-update', undefined)
      ).not.toThrow();
      expect(() =>
        mockSocket.__triggerEvent('segmentation-update', 'invalid-string')
      ).not.toThrow();
      expect(() =>
        mockSocket.__triggerEvent('segmentation-update', {})
      ).not.toThrow();

      expect(() => mockSocket.__triggerEvent('queueStats', null)).not.toThrow();
      expect(() => mockSocket.__triggerEvent('queueStats', {})).not.toThrow();

      // Send valid message after malformed ones
      const validUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'completed',
        progress: 100,
      };

      mockSocket.__triggerEvent('segmentation-update', validUpdate);
      expect(segmentationUpdateListener).toHaveBeenCalledWith(validUpdate);
    });

    it('should handle server disconnection during processing', async () => {
      const segmentationUpdateListener = vi.fn();
      wsManager.on('segmentation-update', segmentationUpdateListener);

      // Start processing
      const processingUpdate: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'processing',
        progress: 25,
      };

      mockSocket.__triggerEvent('segmentation-update', processingUpdate);

      // Server forcefully disconnects
      mockSocket.__triggerDisconnect('io server disconnect');

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

      const update: SegmentationUpdate = {
        imageId: 'image-1',
        projectId: 'project-1',
        status: 'completed',
        progress: 100,
      };

      // Should not throw despite error in middle listener
      expect(() =>
        mockSocket.__triggerEvent('segmentation-update', update)
      ).not.toThrow();

      // Good listeners should still be called
      expect(goodListener).toHaveBeenCalledWith(update);
      expect(anotherGoodListener).toHaveBeenCalledWith(update);
    });
  });

  describe('Performance and Memory', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    beforeEach(async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.__triggerConnect();
      await connectPromise;
    });

    it('should handle high-frequency updates without memory leaks', async () => {
      const segmentationUpdateListener = vi.fn();
      wsManager.on('segmentation-update', segmentationUpdateListener);

      // Send many rapid updates
      for (let i = 0; i < 1000; i++) {
        const update: SegmentationUpdate = {
          imageId: `image-${i}`,
          projectId: 'project-1',
          status: 'processing',
          progress: i % 101,
        };
        mockSocket.__triggerEvent('segmentation-update', update);
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
        mockSocket.__triggerEvent('segmentation-update', update);
      }

      // Listener should not be called after removal
      expect(segmentationUpdateListener).toHaveBeenCalledTimes(1000);
    });

    it('should handle large message queue without performance degradation', async () => {
      // Disconnect to queue messages
      mockSocket.__triggerDisconnect('transport close');

      // Queue many messages
      for (let i = 0; i < 500; i++) {
        wsManager.emit(`event-${i}`, { data: i });
      }

      vi.clearAllMocks();

      // Reconnect and measure performance
      const startTime = performance.now();
      mockSocket.__triggerConnect();
      const endTime = performance.now();

      // All messages should be flushed
      expect(mockSocket.emit).toHaveBeenCalledTimes(500);

      // Should complete in reasonable time (less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});
