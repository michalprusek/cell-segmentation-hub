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
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      testEnv.mockSocket.connected = true;
      const connectHandler = testEnv.mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      const listener = vi.fn();
      wsManager.on('segmentation-update', listener);

      const startTime = performance.now();

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

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(listener).toHaveBeenCalledTimes(1000);
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    }, 15000); // 15 second timeout

    it('should handle 500 rapid queue stats updates without memory leaks', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      const listener = vi.fn();
      wsManager.on('queue-stats-update', listener);

      const startTime = performance.now();

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

      const endTime = performance.now();

      expect(listener).toHaveBeenCalledTimes(500);
      expect(endTime - startTime).toBeLessThan(50);

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

      const startTime = performance.now();

      // Send 100 updates to all listeners
      for (let i = 0; i < 100; i++) {
        const update = testEnv.createSegmentationUpdate({
          imageId: `perf-image-${i}`,
          progress: i,
        });
        testEnv.mockSocket.__simulateSegmentationUpdate(update);
      }

      const endTime = performance.now();

      // Each listener should have been called 100 times
      listeners.forEach(listener => {
        expect(listener).toHaveBeenCalledTimes(100);
      });

      expect(endTime - startTime).toBeLessThan(200); // Should handle 5000 total calls efficiently
    });
  });

  describe('Message Queue Performance', () => {
    it('should efficiently queue and flush 1000 messages', async () => {
      // Start disconnected
      const messages = [];
      const startTime = performance.now();

      // Queue 1000 messages while disconnected
      for (let i = 0; i < 1000; i++) {
        wsManager.emit(`event-${i}`, { data: i, timestamp: Date.now() });
        messages.push({
          event: `event-${i}`,
          data: { data: i, timestamp: Date.now() },
        });
      }

      const queueTime = performance.now();

      // Connect and flush queue
      const connectPromise = wsManager.connect(testEnv.user);
      testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise; // Wait for connection to complete

      const flushTime = performance.now();

      // Verify all messages were emitted
      expect(testEnv.mockSocket.emit).toHaveBeenCalledTimes(1000);

      expect(queueTime - startTime).toBeLessThan(50); // Queuing should be fast
      expect(flushTime - queueTime).toBeLessThan(100); // Flushing should be efficient
    });

    it('should handle queue operations during rapid connect/disconnect cycles', async () => {
      const operations = [];
      const startTime = performance.now();

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

      const endTime = performance.now();

      expect(operations.length).toBe(300); // 50 cycles * (5 emits + 1 disconnect)
      expect(endTime - startTime).toBeLessThan(500); // Should complete efficiently
    });
  });

  describe('Memory Usage Optimization', () => {
    it('should not accumulate memory with extensive listener registration/removal', () => {
      const initialMemoryUsage = process.memoryUsage().heapUsed;
      const listeners = [];

      // Create and register 1000 listeners
      for (let i = 0; i < 1000; i++) {
        const listener = vi.fn();
        listeners.push(listener);
        wsManager.on('segmentation-update', listener);
      }

      const _afterRegistrationMemory = process.memoryUsage().heapUsed;

      // Remove all listeners
      listeners.forEach(listener => {
        wsManager.off('segmentation-update', listener);
      });

      const afterRemovalMemory = process.memoryUsage().heapUsed;

      // Memory after removal should be close to initial (within reasonable bounds)
      const memoryIncrease = afterRemovalMemory - initialMemoryUsage;
      expect(memoryIncrease).toBeLessThan(1024 * 1024); // Less than 1MB increase
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

      const startTime = performance.now();

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

      const endTime = performance.now();

      // Verify all events were processed
      expect(segmentationListener).toHaveBeenCalledTimes(250);
      expect(queueStatsListener).toHaveBeenCalledTimes(250);
      expect(notificationListener).toHaveBeenCalledTimes(250);
      expect(systemMessageListener).toHaveBeenCalledTimes(250);

      expect(endTime - startTime).toBeLessThan(100);
    });

    it('should handle rapid project room switching efficiently', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      const startTime = performance.now();

      // Rapidly switch between 100 project rooms
      for (let i = 0; i < 100; i++) {
        wsManager.joinProject(`project-${i}`);
        wsManager.leaveProject(`project-${i}`);
      }

      const endTime = performance.now();

      // Verify all operations were emitted
      expect(testEnv.mockSocket.emit).toHaveBeenCalledTimes(200); // 100 joins + 100 leaves

      expect(endTime - startTime).toBeLessThan(50);
    });

    it('should maintain stability during extended operation simulation', async () => {
      // Connect
      const connectPromise = wsManager.connect(testEnv.user);
      await testEnv.scenarios.simulateSuccessfulConnection();
      await connectPromise;

      const segmentationListener = vi.fn();
      wsManager.on('segmentation-update', segmentationListener);

      const startTime = performance.now();

      // Simulate 24 hours of processing (compressed into rapid events)
      // Assume 1 update every 10 seconds = 8640 updates per day
      const totalUpdates = 8640;
      const batchSize = 100;

      for (let batch = 0; batch < totalUpdates / batchSize; batch++) {
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

      const endTime = performance.now();

      expect(segmentationListener).toHaveBeenCalledTimes(totalUpdates);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second

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
