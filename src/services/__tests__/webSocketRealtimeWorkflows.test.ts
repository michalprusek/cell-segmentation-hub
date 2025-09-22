import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocketManager, {
  QueueStats,
  SegmentationUpdate,
} from '@/services/webSocketManager';
import { io } from 'socket.io-client';
import { webSocketEventEmitter } from '@/lib/websocketEvents';
import {
  createWebSocketTestEnvironment,
  WebSocketTestScenarios,
} from '@/test-utils/webSocketTestUtils';

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/config', () => ({
  default: {
    apiBaseUrl: 'http://localhost:3001/api',
  },
}));

vi.mock('@/lib/websocketEvents', () => ({
  webSocketEventEmitter: {
    emit: vi.fn(),
  },
}));

describe('WebSocket Real-time Workflows', () => {
  let testEnv: ReturnType<typeof createWebSocketTestEnvironment>;
  let wsManager: WebSocketManager;
  let scenarios: WebSocketTestScenarios;

  beforeEach(() => {
    testEnv = createWebSocketTestEnvironment();
    vi.mocked(io).mockReturnValue(testEnv.mockSocket);
    wsManager = WebSocketManager.getInstance();
    scenarios = testEnv.scenarios;
  });

  afterEach(() => {
    testEnv.cleanup();
    wsManager.disconnect();
    WebSocketManager.cleanup();
  });

  describe('Complete Segmentation Workflows', () => {
    beforeEach(async () => {
      const connectPromise = wsManager.connect(testEnv.user);

      // Wait a bit for the manager to setup handlers
      await new Promise(resolve => setTimeout(resolve, 10));

      testEnv.mockSocket.__simulateConnect();
      await connectPromise;
    });

    it('should handle complete image processing workflow with progress tracking', async () => {
      const segmentationListener = vi.fn();
      const queueStatsListener = vi.fn();
      const notificationListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('queue-stats-update', queueStatsListener);
      wsManager.on('notification', notificationListener);

      const projectId = 'workflow-test-project';
      const imageId = 'test-image-workflow';

      // Join project room
      wsManager.joinProject(projectId);

      // Initial queue state
      testEnv.mockSocket.__simulateQueueStatsUpdate({
        projectId,
        queued: 5,
        processing: 0,
        total: 5,
      });

      // Start processing
      const processingStates = [
        { status: 'queued', progress: 0 },
        { status: 'processing', progress: 0 },
        { status: 'processing', progress: 25 },
        { status: 'processing', progress: 50 },
        { status: 'processing', progress: 75 },
        { status: 'processing', progress: 100 },
        { status: 'completed', progress: 100 },
      ] as const;

      // Simulate each processing stage
      for (let i = 0; i < processingStates.length; i++) {
        const state = processingStates[i];
        const update: SegmentationUpdate = {
          imageId,
          projectId,
          status: state.status,
          progress: state.progress,
          queueId: 'queue-item-1',
        };

        testEnv.mockSocket.__simulateSegmentationUpdate(update);

        // Update queue stats accordingly
        const isProcessing = state.status === 'processing';
        const isCompleted = state.status === 'completed';

        testEnv.mockSocket.__simulateQueueStatsUpdate({
          projectId,
          queued: isCompleted ? 4 : 5,
          processing: isProcessing ? 1 : 0,
          total: 5,
        });
      }

      // Final completion notification
      testEnv.mockSocket.__simulateNotification({
        type: 'segmentation-complete',
        imageId,
        projectId,
        polygonCount: 42,
        timestamp: new Date().toISOString(),
      });

      // Verify complete workflow
      expect(segmentationListener).toHaveBeenCalledTimes(7);
      expect(queueStatsListener).toHaveBeenCalledTimes(8); // Initial + 7 updates
      expect(notificationListener).toHaveBeenCalledTimes(1);

      // Verify final state
      const finalUpdate = segmentationListener.mock.calls[6][0];
      expect(finalUpdate.status).toBe('completed');
      expect(finalUpdate.progress).toBe(100);
    });

    it('should handle batch processing workflow with concurrent images', async () => {
      const segmentationListener = vi.fn();
      const queueStatsListener = vi.fn();
      const notificationListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('queue-stats-update', queueStatsListener);
      wsManager.on('notification', notificationListener);

      const projectId = 'batch-workflow-project';
      const imageIds = ['img1', 'img2', 'img3', 'img4', 'img5'];

      wsManager.joinProject(projectId);

      // Initial batch queue state
      testEnv.mockSocket.__simulateQueueStatsUpdate({
        projectId,
        queued: 5,
        processing: 0,
        total: 5,
      });

      // Simulate concurrent processing of 3 images
      const concurrentImages = imageIds.slice(0, 3);

      // Start all concurrent processing
      concurrentImages.forEach((imageId, index) => {
        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId,
          projectId,
          status: 'processing',
          progress: 0,
          queueId: `queue-${index + 1}`,
        });
      });

      // Update queue to show 3 processing
      testEnv.mockSocket.__simulateQueueStatsUpdate({
        projectId,
        queued: 2,
        processing: 3,
        total: 5,
      });

      // Complete images at different times
      setTimeout(() => {
        // Complete first image
        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId: concurrentImages[0],
          projectId,
          status: 'completed',
          progress: 100,
          queueId: 'queue-1',
        });

        testEnv.mockSocket.__simulateNotification({
          type: 'segmentation-complete',
          imageId: concurrentImages[0],
          projectId,
          polygonCount: 25,
          timestamp: new Date().toISOString(),
        });
      }, 10);

      setTimeout(() => {
        // Complete second image
        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId: concurrentImages[1],
          projectId,
          status: 'completed',
          progress: 100,
          queueId: 'queue-2',
        });

        testEnv.mockSocket.__simulateNotification({
          type: 'segmentation-complete',
          imageId: concurrentImages[1],
          projectId,
          polygonCount: 30,
          timestamp: new Date().toISOString(),
        });
      }, 20);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify batch processing occurred
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId: concurrentImages[0],
          status: 'processing',
        })
      );
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId: concurrentImages[1],
          status: 'processing',
        })
      );
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId: concurrentImages[2],
          status: 'processing',
        })
      );

      expect(notificationListener).toHaveBeenCalledTimes(2);
    });

    it('should handle processing failures and recovery', async () => {
      const segmentationListener = vi.fn();
      const systemMessageListener = vi.fn();
      const queueStatsListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('system-message', systemMessageListener);
      wsManager.on('queue-stats-update', queueStatsListener);

      const projectId = 'failure-recovery-project';
      const imageId = 'failing-image';

      wsManager.joinProject(projectId);

      // Start processing
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId,
        projectId,
        status: 'processing',
        progress: 0,
        queueId: 'queue-fail-1',
      });

      // Simulate progress
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId,
        projectId,
        status: 'processing',
        progress: 50,
        queueId: 'queue-fail-1',
      });

      // Simulate failure
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId,
        projectId,
        status: 'failed',
        error: 'Out of memory during segmentation',
        queueId: 'queue-fail-1',
      });

      // System error message
      testEnv.mockSocket.__simulateSystemMessage({
        type: 'error',
        message: `Processing failed for ${imageId}: Out of memory during segmentation`,
        timestamp: new Date().toISOString(),
      });

      // Queue stats after failure
      testEnv.mockSocket.__simulateQueueStatsUpdate({
        projectId,
        queued: 4,
        processing: 0,
        total: 5,
      });

      // Simulate retry
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId,
        projectId,
        status: 'processing',
        progress: 0,
        queueId: 'queue-retry-1',
      });

      // Successful completion after retry
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId,
        projectId,
        status: 'completed',
        progress: 100,
        queueId: 'queue-retry-1',
      });

      // Verify failure and recovery workflow
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId,
          status: 'failed',
          error: 'Out of memory during segmentation',
        })
      );

      expect(systemMessageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('Processing failed'),
        })
      );

      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId,
          status: 'completed',
          progress: 100,
        })
      );
    });
  });

  describe('Multi-Project Real-time Coordination', () => {
    beforeEach(async () => {
      const connectPromise = wsManager.connect(testEnv.user);

      // Wait a bit for the manager to setup handlers
      await new Promise(resolve => setTimeout(resolve, 10));

      testEnv.mockSocket.__simulateConnect();
      await connectPromise;
    });

    it('should coordinate processing across multiple active projects', async () => {
      const segmentationListener = vi.fn();
      const queueStatsListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('queue-stats-update', queueStatsListener);

      const projects = ['project-a', 'project-b', 'project-c'];

      // Join all project rooms
      projects.forEach(projectId => {
        wsManager.joinProject(projectId);
      });

      // Simulate concurrent processing across projects
      projects.forEach((projectId, index) => {
        // Initial queue stats
        testEnv.mockSocket.__simulateQueueStatsUpdate({
          projectId,
          queued: 3 + index,
          processing: 0,
          total: 3 + index,
        });

        // Start processing in each project
        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId: `${projectId}-img-1`,
          projectId,
          status: 'processing',
          progress: 25 * (index + 1),
          queueId: `${projectId}-queue-1`,
        });
      });

      // Verify all projects received updates
      expect(queueStatsListener).toHaveBeenCalledTimes(3);
      expect(segmentationListener).toHaveBeenCalledTimes(3);

      // Verify project-specific data
      projects.forEach((projectId, index) => {
        expect(queueStatsListener).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId,
            total: 3 + index,
          })
        );

        expect(segmentationListener).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId,
            imageId: `${projectId}-img-1`,
          })
        );
      });
    });

    it('should handle project switching during active processing', async () => {
      const segmentationListener = vi.fn();
      const queueStatsListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('queue-stats-update', queueStatsListener);

      const projectA = 'project-switch-a';
      const projectB = 'project-switch-b';

      // Start in project A
      wsManager.joinProject(projectA);

      // Start processing in project A
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId: 'project-a-img-1',
        projectId: projectA,
        status: 'processing',
        progress: 25,
        queueId: 'project-a-queue-1',
      });

      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: projectA,
          progress: 25,
        })
      );

      // Clear only the listener, not the mock socket handlers
      segmentationListener.mockClear();

      // Switch to project B
      wsManager.leaveProject(projectA);
      wsManager.joinProject(projectB);

      expect(testEnv.mockSocket.emit).toHaveBeenCalledWith(
        'leave-project',
        projectA
      );
      expect(testEnv.mockSocket.emit).toHaveBeenCalledWith(
        'join-project',
        projectB
      );

      // Continue processing in project A (should still receive updates)
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId: 'project-a-img-1',
        projectId: projectA,
        status: 'completed',
        progress: 100,
        queueId: 'project-a-queue-1',
      });

      // Start processing in project B
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId: 'project-b-img-1',
        projectId: projectB,
        status: 'processing',
        progress: 10,
        queueId: 'project-b-queue-1',
      });

      // Should receive both project updates (WebSocket receives all, filtering happens in UI)
      expect(segmentationListener).toHaveBeenCalledTimes(2);
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: projectA, status: 'completed' })
      );
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: projectB, progress: 10 })
      );
    });
  });

  describe('Connection Resilience During Workflows', () => {
    it('should maintain workflow state through connection interruptions', async () => {
      const segmentationListener = vi.fn();
      const connectListener = vi.fn();
      const disconnectListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('connect', connectListener);
      wsManager.on('disconnect', disconnectListener);

      // Initial connection
      const connectPromise = wsManager.connect(testEnv.user);

      // Wait a bit for the manager to setup handlers
      await new Promise(resolve => setTimeout(resolve, 10));

      testEnv.mockSocket.__simulateConnect();
      await connectPromise;

      const projectId = 'resilience-test-project';
      const imageId = 'resilience-test-image';

      wsManager.joinProject(projectId);

      // Start processing
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId,
        projectId,
        status: 'processing',
        progress: 25,
        queueId: 'resilience-queue-1',
      });

      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({ progress: 25 })
      );

      // Clear only the specific listeners, not the mock socket handlers
      segmentationListener.mockClear();
      testEnv.mockSocket.emit.mockClear(); // Clear emit calls from setup

      // Simulate connection loss
      testEnv.mockSocket.__simulateDisconnect('transport close');
      expect(disconnectListener).toHaveBeenCalledWith('transport close');

      // Try to send updates during disconnection (should be queued)
      wsManager.emit('heartbeat', { timestamp: Date.now() });
      wsManager.emit('status-check', { projectId });

      // Simulate reconnection
      testEnv.mockSocket.connected = true;
      const reconnectHandler =
        testEnv.mockSocket.__getIoEventHandler('reconnect');
      reconnectHandler?.(2); // Reconnected after 2 attempts

      // Also simulate the connect event which triggers queue flush
      const connectHandlers = testEnv.mockSocket.on.mock.calls
        .filter(call => call[0] === 'connect')
        .map(call => call[1]);
      connectHandlers.forEach(handler => handler?.());

      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'reconnected',
      });

      // Continue processing after reconnection
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId,
        projectId,
        status: 'processing',
        progress: 75,
        queueId: 'resilience-queue-1',
      });

      // Complete processing
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId,
        projectId,
        status: 'completed',
        progress: 100,
        queueId: 'resilience-queue-1',
      });

      // Verify workflow continued after reconnection
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({ progress: 75 })
      );
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', progress: 100 })
      );

      // Verify queued messages were sent after reconnection
      expect(testEnv.mockSocket.emit).toHaveBeenCalledWith('heartbeat', {
        timestamp: expect.any(Number),
      });
      expect(testEnv.mockSocket.emit).toHaveBeenCalledWith('status-check', {
        projectId,
      });
    }, 15000);

    it('should handle rapid reconnections during high-throughput workflows', async () => {
      const segmentationListener = vi.fn();
      const disconnectListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('disconnect', disconnectListener);

      // Initial connection (before fake timers)
      const connectPromise = wsManager.connect(testEnv.user);

      // Wait a bit for the manager to setup handlers
      await new Promise(resolve => setTimeout(resolve, 10));

      testEnv.mockSocket.__simulateConnect();
      await connectPromise;

      // Now set up fake timers
      vi.useFakeTimers();

      const projectId = 'high-throughput-project';

      // Simulate high-throughput processing with intermittent disconnections
      for (let cycle = 0; cycle < 10; cycle++) {
        // Process some images
        for (let img = 0; img < 5; img++) {
          const imageId = `cycle-${cycle}-img-${img}`;

          testEnv.mockSocket.__simulateSegmentationUpdate({
            imageId,
            projectId,
            status: 'processing',
            progress: 50,
            queueId: `${imageId}-queue`,
          });

          testEnv.mockSocket.__simulateSegmentationUpdate({
            imageId,
            projectId,
            status: 'completed',
            progress: 100,
            queueId: `${imageId}-queue`,
          });
        }

        // Simulate brief disconnection every few cycles
        if (cycle % 3 === 2) {
          testEnv.mockSocket.__simulateDisconnect('ping timeout');

          // Fast reconnection
          vi.advanceTimersByTime(1000);
          testEnv.mockSocket.connected = true;
          const reconnectHandler =
            testEnv.mockSocket.__getIoEventHandler('reconnect');
          reconnectHandler?.(1);
        }
      }

      // Verify all updates were processed despite disconnections
      expect(segmentationListener).toHaveBeenCalledTimes(100); // 10 cycles * 5 images * 2 updates each
      expect(disconnectListener).toHaveBeenCalledTimes(3); // Every 3rd cycle

      vi.useRealTimers();
    }, 20000);
  });

  describe('Error Recovery Workflows', () => {
    beforeEach(async () => {
      const connectPromise = wsManager.connect(testEnv.user);

      // Wait a bit for the manager to setup handlers
      await new Promise(resolve => setTimeout(resolve, 10));

      testEnv.mockSocket.__simulateConnect();
      await connectPromise;
    });

    it('should handle system-wide processing errors gracefully', async () => {
      const systemMessageListener = vi.fn();
      const segmentationListener = vi.fn();
      const queueStatsListener = vi.fn();

      wsManager.on('system-message', systemMessageListener);
      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('queue-stats-update', queueStatsListener);

      const projectId = 'system-error-project';

      wsManager.joinProject(projectId);

      // Simulate system-wide error
      testEnv.mockSocket.__simulateSystemMessage({
        type: 'error',
        message: 'ML service temporarily unavailable',
        timestamp: new Date().toISOString(),
      });

      // All processing should fail
      const imageIds = ['img1', 'img2', 'img3'];
      imageIds.forEach((imageId, index) => {
        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId,
          projectId,
          status: 'failed',
          error: 'Service unavailable',
          queueId: `error-queue-${index}`,
        });
      });

      // Queue should reflect failures
      testEnv.mockSocket.__simulateQueueStatsUpdate({
        projectId,
        queued: 0,
        processing: 0,
        total: 3,
      });

      // System recovery message
      testEnv.mockSocket.__simulateSystemMessage({
        type: 'info',
        message: 'ML service restored - resuming processing',
        timestamp: new Date().toISOString(),
      });

      // Retry failed images
      imageIds.forEach((imageId, index) => {
        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId,
          projectId,
          status: 'processing',
          progress: 0,
          queueId: `retry-queue-${index}`,
        });

        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId,
          projectId,
          status: 'completed',
          progress: 100,
          queueId: `retry-queue-${index}`,
        });
      });

      // Verify error handling and recovery
      expect(systemMessageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: 'ML service temporarily unavailable',
        })
      );

      expect(systemMessageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          message: 'ML service restored - resuming processing',
        })
      );

      // Verify all images eventually completed
      imageIds.forEach(imageId => {
        expect(segmentationListener).toHaveBeenCalledWith(
          expect.objectContaining({
            imageId,
            status: 'failed',
          })
        );

        expect(segmentationListener).toHaveBeenCalledWith(
          expect.objectContaining({
            imageId,
            status: 'completed',
            progress: 100,
          })
        );
      });
    });

    it('should handle malformed data during critical processing', async () => {
      const segmentationListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);

      const projectId = 'malformed-data-project';
      wsManager.joinProject(projectId);

      // Send valid update
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId: 'valid-image',
        projectId,
        status: 'processing',
        progress: 25,
        queueId: 'valid-queue',
      });

      // Send malformed updates
      const malformedData = [
        null,
        undefined,
        'invalid-string',
        { invalid: 'structure' },
        { imageId: null, projectId: undefined },
        { progress: 'not-a-number' },
      ];

      malformedData.forEach(data => {
        const handler =
          testEnv.mockSocket.__getEventHandler('segmentationUpdate');
        // Handler should exist and be callable (may throw for malformed data, which is acceptable)
        expect(handler).toBeDefined();
        expect(typeof handler).toBe('function');

        // Some malformed data might throw, which is acceptable behavior
        // The important thing is the system continues to function after
        try {
          handler(data);
        } catch (_error) {
          // Malformed data causing errors is acceptable
        }
      });

      // Send another valid update to ensure system is still functioning
      testEnv.mockSocket.__simulateSegmentationUpdate({
        imageId: 'valid-image',
        projectId,
        status: 'completed',
        progress: 100,
        queueId: 'valid-queue',
      });

      // Verify valid updates were processed correctly
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId: 'valid-image',
          status: 'processing',
          progress: 25,
        })
      );

      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId: 'valid-image',
          status: 'completed',
          progress: 100,
        })
      );

      // Should have received the valid calls plus some malformed data that was processed
      // The important thing is that the system continues to function after malformed data
      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId: 'valid-image',
          status: 'processing',
          progress: 25,
        })
      );

      expect(segmentationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId: 'valid-image',
          status: 'completed',
          progress: 100,
        })
      );

      // System should have processed at least the 2 valid updates
      expect(segmentationListener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Workflow Performance Optimization', () => {
    beforeEach(async () => {
      const connectPromise = wsManager.connect(testEnv.user);

      // Wait a bit for the manager to setup handlers
      await new Promise(resolve => setTimeout(resolve, 10));

      testEnv.mockSocket.__simulateConnect();
      await connectPromise;
    });

    it('should optimize performance during large batch processing workflows', async () => {
      const segmentationListener = vi.fn();
      const queueStatsListener = vi.fn();

      wsManager.on('segmentation-update', segmentationListener);
      wsManager.on('queue-stats-update', queueStatsListener);

      const projectId = 'large-batch-project';
      const imageCount = 1000;

      wsManager.joinProject(projectId);

      const startTime = performance.now();

      // Simulate large batch processing
      for (let i = 0; i < imageCount; i++) {
        const imageId = `batch-img-${i}`;

        // Processing start
        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId,
          projectId,
          status: 'processing',
          progress: 0,
          queueId: `batch-queue-${i}`,
        });

        // Processing completion
        testEnv.mockSocket.__simulateSegmentationUpdate({
          imageId,
          projectId,
          status: 'completed',
          progress: 100,
          queueId: `batch-queue-${i}`,
        });

        // Update queue stats every 100 images
        if (i % 100 === 99) {
          testEnv.mockSocket.__simulateQueueStatsUpdate({
            projectId,
            queued: Math.max(0, imageCount - i - 1),
            processing: 0,
            total: imageCount,
          });
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Verify all updates were processed
      expect(segmentationListener).toHaveBeenCalledTimes(imageCount * 2);
      expect(queueStatsListener).toHaveBeenCalledTimes(10); // Every 100 images

      // Performance should be reasonable (less than 3 seconds for 1000 images)
      expect(duration).toBeLessThan(3000);
    });
  });
});
