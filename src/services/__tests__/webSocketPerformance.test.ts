import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocketManager, {
  QueueStats,
  SegmentationUpdate,
} from '@/services/webSocketManager';
import { io } from 'socket.io-client';
import { createWebSocketTestEnvironment } from '@/test-utils/webSocketTestUtils';

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

// Mock logger to prevent console spam
vi.mock('@/lib/api', () => ({
  apiClient: {
    refreshAccessToken: vi.fn().mockResolvedValue(undefined),
  },
}));

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

describe('WebSocket Performance Tests', () => {
  let testEnv: ReturnType<typeof createWebSocketTestEnvironment>;
  let wsManager: WebSocketManager;

  beforeEach(() => {
    testEnv = createWebSocketTestEnvironment();
    vi.mocked(io).mockReturnValue(testEnv.mockSocket);
    wsManager = WebSocketManager.getInstance();
  });

  afterEach(() => {
    testEnv.cleanup();
    wsManager.disconnect();
    WebSocketManager.cleanup();
  });

  describe('High-Frequency Event Processing', () => {
    it('should handle 1000 rapid segmentation updates efficiently', async () => {
      // Connect - use __simulateConnect to fire ALL connect handlers (including Promise resolver)
      const connectPromise = wsManager.connect(testEnv.user);
      testEnv.mockSocket.__simulateConnect();
      await connectPromise;

      const listener = vi.fn();
      wsManager.on('segmentation-update', listener);

      // Send 1000 rapid updates
      for (let i = 0; i < 1000; i++) {
        const update: SegmentationUpdate = {
          imageId: `image-${i}`,
          projectId: 'performance-test',
          status: 'processing',
          progress: i % 101,
        };
        testEnv.mockSocket.__simulateSegmentationUpdate(update);
      }

      expect(listener).toHaveBeenCalledTimes(1000);
    }, 15000); // 15 second timeout

    it('should handle 500 rapid queue stats updates without memory leaks', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      const listener = vi.fn();
      wsManager.on('queue-stats-update', listener);

      // Send 500 queue updates
      for (let i = 0; i < 500; i++) {
        const stats: QueueStats = {
          projectId: 'performance-test',
          queued: Math.max(0, 100 - i),
          processing: Math.min(i, 10),
          total: 100,
        };
        testEnv.mockSocket.__simulateQueueStatsUpdate(stats);
      }

      expect(listener).toHaveBeenCalledTimes(500);

      // Verify no memory leaks by checking listener cleanup
      wsManager.off('queue-stats-update', listener);
      testEnv.mockSocket.__simulateQueueStatsUpdate(testEnv.createQueueStats());
      expect(listener).toHaveBeenCalledTimes(500); // No additional calls
    });

    it('should maintain performance with multiple concurrent listeners', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      // Register 50 listeners
      const listeners: Array<ReturnType<typeof vi.fn>> = [];
      for (let i = 0; i < 50; i++) {
        const listener = vi.fn();
        listeners.push(listener);
        wsManager.on('segmentation-update', listener);
      }

      // Send 100 updates to all listeners
      for (let i = 0; i < 100; i++) {
        const update = testEnv.createSegmentationUpdate({
          imageId: `perf-image-${i}`,
          progress: i,
        });
        testEnv.mockSocket.__simulateSegmentationUpdate(update);
      }

      // Each listener should have been called 100 times
      listeners.forEach(listener => {
        expect(listener).toHaveBeenCalledTimes(100);
      });
    });
  });

  describe('Message Queue Performance', () => {
    it('should efficiently queue and flush 1000 messages', async () => {
      // Start disconnected
      const messages = [];

      // Queue 1000 messages while disconnected
      for (let i = 0; i < 1000; i++) {
        wsManager.emit(`event-${i}`, { data: i, timestamp: Date.now() });
        messages.push({
          event: `event-${i}`,
          data: { data: i, timestamp: Date.now() },
        });
      }

      // Connect and flush queue
      const connectPromise = wsManager.connect(testEnv.user);
      testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise; // Wait for connection to complete

      // Verify all messages were emitted
      expect(testEnv.mockSocket.emit).toHaveBeenCalledTimes(1000);
    });

    it('should handle queue operations during rapid connect/disconnect cycles', async () => {
      const operations = [];

      // Perform 50 rapid connect/disconnect cycles with message emissions
      for (let cycle = 0; cycle < 50; cycle++) {
        // Connect
        const connectPromise = wsManager.connect(testEnv.user);
        testEnv.scenarios.simulateSuccessfulConnection();
        await connectPromise;

        // Send some messages
        for (let msg = 0; msg < 5; msg++) {
          wsManager.emit(`cycle-${cycle}-msg-${msg}`, { cycle, msg });
          operations.push('emit');
        }

        // Disconnect
        wsManager.disconnect();
        operations.push('disconnect');
      }

      expect(operations.length).toBe(300); // 50 cycles * (5 emits + 1 disconnect)
    });
  });

  describe('Memory Usage Optimization', () => {
    it('detaches every listener that off() is called for', async () => {
      // Was 'should not accumulate memory with extensive listener
      // registration/removal', asserting `heapUsed` grew by less than 20MB.
      // Its own comment conceded "v8 GC is non-deterministic", which is exactly
      // why the assertion was worthless: 1000 vi.fn() mocks are nowhere near
      // 20MB, so it passed whether or not off() detached anything, and a real
      // leak of 1000 closures would still have passed.
      //
      // The leak is OBSERVABLE without measuring the heap: a listener that was
      // not detached still gets invoked. Assert that instead.
      const connectPromise = wsManager.connect(testEnv.user);
      testEnv.mockSocket.__simulateConnect();
      await connectPromise;

      const listeners = Array.from({ length: 1000 }, () => vi.fn());
      listeners.forEach(listener =>
        wsManager.on('segmentation-update', listener)
      );

      // Sanity: they really were attached, so the check below is meaningful.
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId: 'image-attached',
        projectId: 'leak-test',
        status: 'processing',
        timestamp: Date.now(),
      });
      listeners.forEach((listener, i) =>
        expect(
          listener,
          `listener ${i} was never attached`
        ).toHaveBeenCalledTimes(1)
      );

      listeners.forEach(listener =>
        wsManager.off('segmentation-update', listener)
      );

      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId: 'image-after-off',
        projectId: 'leak-test',
        status: 'completed',
        timestamp: Date.now(),
      });

      // Still exactly 1 — none of the 1000 survived off().
      listeners.forEach((listener, i) =>
        expect(
          listener,
          `listener ${i} is still attached`
        ).toHaveBeenCalledTimes(1)
      );
    });

    it('should properly clean up resources on repeated connect/disconnect', async () => {
      const initialConnections = 10;

      for (let i = 0; i < initialConnections; i++) {
        const connectPromise = wsManager.connect({
          id: `user-${i}`,
          token: `token-${i}`,
        });

        testEnv.scenarios.simulateSuccessfulConnection();
        await connectPromise;

        // Add some listeners
        const listener = vi.fn();
        wsManager.on('segmentation-update', listener);
        wsManager.on('queue-stats-update', listener);

        // Disconnect (should clean up listeners)
        wsManager.disconnect();
      }

      // After all operations, verify clean state
      expect(wsManager.isConnected).toBe(false);
      expect(wsManager.user).toBeNull();
      expect(wsManager.getSocket()).toBeNull();
    });
  });

  describe('Stress Testing', () => {
    it('should handle mixed event types at high frequency', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      const segmentationListener = vi.fn();
      const queueStatsListener = vi.fn();
      const notificationListener = vi.fn();
      const systemMessageListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('queue-stats-update', queueStatsListener);
      wsManager.on('notification', notificationListener);
      wsManager.on('system-message', systemMessageListener);

      // Send mixed high-frequency events
      for (let i = 0; i < 1000; i++) {
        const eventType = i % 4;

        switch (eventType) {
          case 0:
            testEnv.mockSocket.__simulateSegmentationUpdate(
              testEnv.createSegmentationUpdate({ progress: i % 101 })
            );
            break;
          case 1:
            testEnv.mockSocket.__simulateQueueStatsUpdate(
              testEnv.createQueueStats({ queued: i % 50 })
            );
            break;
          case 2:
            testEnv.mockSocket.__simulateNotification(
              testEnv.createNotification({ polygonCount: i % 100 })
            );
            break;
          case 3:
            testEnv.mockSocket.__simulateSystemMessage(
              testEnv.createSystemMessage({ message: `Message ${i}` })
            );
            break;
        }
      }

      // Verify all events were processed
      expect(segmentationListener).toHaveBeenCalledTimes(250);
      expect(queueStatsListener).toHaveBeenCalledTimes(250);
      expect(notificationListener).toHaveBeenCalledTimes(250);
      expect(systemMessageListener).toHaveBeenCalledTimes(250);
    });

    it('should handle rapid project room switching efficiently', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      // Rapidly switch between 100 project rooms
      for (let i = 0; i < 100; i++) {
        wsManager.joinProject(`project-${i}`);
        wsManager.leaveProject(`project-${i}`);
      }

      // Verify all operations were emitted
      expect(testEnv.mockSocket.emit).toHaveBeenCalledTimes(200); // 100 joins + 100 leaves
    });

    it('should maintain stability during extended operation simulation', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      const segmentationListener = vi.fn();
      wsManager.on('segmentation-update', segmentationListener);

      // Simulate 24 hours of processing (compressed into rapid events)
      // Assume 1 update every 10 seconds ≈ 8600 updates per day (86 batches × 100)
      const batchSize = 100;
      const numBatches = 86;
      const totalUpdates = numBatches * batchSize; // 8600 (exact multiple of batchSize)

      for (let batch = 0; batch < numBatches; batch++) {
        for (let i = 0; i < batchSize; i++) {
          const update: SegmentationUpdate = {
            imageId: `long-running-${batch}-${i}`,
            projectId: 'long-running-test',
            status:
              i % 3 === 0 ? 'processing' : i % 3 === 1 ? 'completed' : 'failed',
            progress: i % 101,
          };
          testEnv.mockSocket.__simulateSegmentationUpdate(update);
        }

        // Simulate brief pause between batches
        if (batch % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }

      expect(segmentationListener).toHaveBeenCalledTimes(totalUpdates);

      // Verify WebSocket manager is still in good state
      expect(wsManager.isConnected).toBe(true);
      expect(wsManager.user).toEqual(testEnv.user);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent listener modifications during event processing', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      const listeners = [];
      const callCounts = [];

      // Register initial listeners
      for (let i = 0; i < 50; i++) {
        const listener = vi.fn();
        listeners.push(listener);
        callCounts.push(0);
        wsManager.on('segmentation-update', listener);
      }

      // Process events while modifying listeners
      for (let round = 0; round < 100; round++) {
        // Send event
        const update = testEnv.createSegmentationUpdate({ progress: round });
        testEnv.mockSocket.__simulateSegmentationUpdate(update);

        // Occasionally modify listeners during processing
        if (round % 10 === 0 && round > 0) {
          // Remove a listener
          const toRemove = listeners.pop();
          if (toRemove) {
            wsManager.off('segmentation-update', toRemove);
          }

          // Add a new listener
          if (listeners.length < 30) {
            const newListener = vi.fn();
            listeners.push(newListener);
            wsManager.on('segmentation-update', newListener);
          }
        }
      }

      // Verify system remained stable
      expect(listeners.length).toBeGreaterThan(0);
      listeners.forEach(listener => {
        expect(listener).toHaveBeenCalled();
      });
    });
  });
});
