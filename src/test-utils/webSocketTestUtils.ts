import { vi } from 'vitest';
import { QueueStats, SegmentationUpdate } from '@/services/webSocketManager';

/**
 * Comprehensive mock Socket.io client for testing WebSocket functionality
 */
export const createMockSocket = () => {
  const mockSocket = {
    // Connection state
    connected: false,
    id: 'mock-socket-id',

    // Core methods
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),

    // Socket.io manager methods
    io: {
      on: vi.fn(),
      off: vi.fn(),
      reconnectionAttempts: vi.fn().mockReturnValue(5),
      reconnectionDelay: vi.fn().mockReturnValue(1000),
    },

    // Helper methods for testing
    __simulateConnect: () => {
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
    },

    __simulateDisconnect: (reason = 'transport close') => {
      mockSocket.connected = false;
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.(reason);
    },

    __simulateConnectionError: (error: Error) => {
      const errorHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect_error'
      )?.[1];
      errorHandler?.(error);
    },

    __simulateReconnect: (attemptNumber: number) => {
      mockSocket.connected = true;
      const reconnectHandler = mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect'
      )?.[1];
      reconnectHandler?.(attemptNumber);
    },

    __simulateSegmentationUpdate: (update: SegmentationUpdate) => {
      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      handler?.(update);
    },

    __simulateQueueStatsUpdate: (stats: QueueStats) => {
      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'queue-stats-update'
      )?.[1];
      handler?.(stats);
    },

    __simulateNotification: (notification: any) => {
      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'notification'
      )?.[1];
      handler?.(notification);
    },

    __simulateSystemMessage: (message: any) => {
      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'system-message'
      )?.[1];
      handler?.(message);
    },

    __getEventHandler: (eventName: string) => {
      return mockSocket.on.mock.calls.find(call => call[0] === eventName)?.[1];
    },

    __getIoEventHandler: (eventName: string) => {
      return mockSocket.io.on.mock.calls.find(
        call => call[0] === eventName
      )?.[1];
    },

    __reset: () => {
      mockSocket.connected = false;
      mockSocket.id = 'mock-socket-id';
      vi.clearAllMocks();
    },
  };

  return mockSocket;
};

/**
 * Factory for creating test segmentation updates
 */
export const createSegmentationUpdate = (
  overrides: Partial<SegmentationUpdate> = {}
): SegmentationUpdate => ({
  imageId: 'test-image-1',
  projectId: 'test-project-1',
  status: 'processing',
  progress: 50,
  ...overrides,
});

/**
 * Factory for creating test queue stats
 */
export const createQueueStats = (
  overrides: Partial<QueueStats> = {}
): QueueStats => ({
  projectId: 'test-project-1',
  queued: 3,
  processing: 1,
  total: 4,
  ...overrides,
});

/**
 * Factory for creating test notifications
 */
export const createNotification = (overrides: any = {}) => ({
  type: 'segmentation-complete',
  imageId: 'test-image-1',
  projectId: 'test-project-1',
  polygonCount: 15,
  timestamp: '2024-01-01T00:00:00Z',
  ...overrides,
});

/**
 * Factory for creating test system messages
 */
export const createSystemMessage = (overrides: any = {}) => ({
  type: 'info' as const,
  message: 'System message',
  timestamp: '2024-01-01T00:00:00Z',
  ...overrides,
});

/**
 * Mock user credentials for testing
 */
export const createMockUser = (overrides: any = {}) => ({
  id: 'test-user-123',
  token: 'test-token-abc',
  ...overrides,
});

/**
 * WebSocket test scenarios helper
 */
export class WebSocketTestScenarios {
  constructor(private mockSocket: any) {}

  /**
   * Simulates a complete successful connection flow
   */
  async simulateSuccessfulConnection() {
    this.mockSocket.connected = true;
    this.mockSocket.__simulateConnect();
  }

  /**
   * Simulates connection timeout scenario
   */
  simulateConnectionTimeout() {
    // Don't call connect handler to simulate timeout
    if (vi.isFakeTimers()) {
      vi.advanceTimersByTime(15000); // Default timeout
    }
  }

  /**
   * Simulates a complete segmentation processing workflow
   */
  simulateSegmentationWorkflow(
    imageId = 'test-image',
    projectId = 'test-project'
  ) {
    const updates = [
      // Processing start
      createSegmentationUpdate({
        imageId,
        projectId,
        status: 'processing',
        progress: 0,
        queueId: 'queue-1',
      }),
      // Progress updates
      ...([25, 50, 75, 100] as const).map(progress =>
        createSegmentationUpdate({
          imageId,
          projectId,
          status: 'processing',
          progress,
          queueId: 'queue-1',
        })
      ),
      // Completion
      createSegmentationUpdate({
        imageId,
        projectId,
        status: 'completed',
        progress: 100,
        queueId: 'queue-1',
      }),
    ];

    updates.forEach(update => {
      this.mockSocket.__simulateSegmentationUpdate(update);
    });

    // Completion notification
    this.mockSocket.__simulateNotification(
      createNotification({
        imageId,
        projectId,
      })
    );

    return updates;
  }

  /**
   * Simulates segmentation processing error
   */
  simulateSegmentationError(
    imageId = 'test-image',
    projectId = 'test-project',
    error = 'Processing failed'
  ) {
    const errorUpdate = createSegmentationUpdate({
      imageId,
      projectId,
      status: 'failed',
      error,
      queueId: 'queue-1',
    });

    this.mockSocket.__simulateSegmentationUpdate(errorUpdate);

    this.mockSocket.__simulateSystemMessage(
      createSystemMessage({
        type: 'error',
        message: `Processing failed for ${imageId}: ${error}`,
      })
    );

    return errorUpdate;
  }

  /**
   * Simulates connection loss and recovery cycle
   */
  simulateConnectionLossAndRecovery(
    disconnectReason = 'transport close',
    reconnectAttempts = 2
  ) {
    // Disconnect
    this.mockSocket.__simulateDisconnect(disconnectReason);

    // Reconnection attempts
    for (let i = 1; i <= reconnectAttempts; i++) {
      const reconnectAttemptHandler = this.mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect_attempt'
      )?.[1];
      reconnectAttemptHandler?.(i);
    }

    // Successful reconnection
    this.mockSocket.__simulateReconnect(reconnectAttempts);
  }

  /**
   * Simulates batch queue processing
   */
  simulateBatchProcessing(projectId = 'test-project', imageCount = 3) {
    const imageIds = Array.from(
      { length: imageCount },
      (_, i) => `image-${i + 1}`
    );

    // Initial queue stats
    this.mockSocket.__simulateQueueStatsUpdate(
      createQueueStats({
        projectId,
        queued: imageCount,
        processing: 0,
        total: imageCount,
      })
    );

    // Process each image
    imageIds.forEach((imageId, index) => {
      // Start processing
      this.mockSocket.__simulateSegmentationUpdate(
        createSegmentationUpdate({
          imageId,
          projectId,
          status: 'processing',
          progress: 0,
          queueId: `queue-${index + 1}`,
        })
      );

      // Complete processing
      this.mockSocket.__simulateSegmentationUpdate(
        createSegmentationUpdate({
          imageId,
          projectId,
          status: 'completed',
          progress: 100,
          queueId: `queue-${index + 1}`,
        })
      );

      // Update queue stats
      this.mockSocket.__simulateQueueStatsUpdate(
        createQueueStats({
          projectId,
          queued: imageCount - index - 1,
          processing: 0,
          total: imageCount,
        })
      );
    });
  }

  /**
   * Simulates rapid disconnect/reconnect cycles
   */
  simulateRapidReconnections(cycles = 3) {
    for (let i = 0; i < cycles; i++) {
      this.mockSocket.__simulateDisconnect(`cycle-${i}`);
      this.mockSocket.__simulateConnect();
    }
  }

  /**
   * Simulates malformed message handling
   */
  simulateMalformedMessages() {
    const segmentationHandler = this.mockSocket.__getEventHandler(
      'segmentation-update'
    );
    const queueStatsHandler =
      this.mockSocket.__getEventHandler('queue-stats-update');
    const notificationHandler =
      this.mockSocket.__getEventHandler('notification');

    // Send various malformed data
    const malformedData = [
      null,
      undefined,
      '',
      'invalid-string',
      {},
      { invalid: 'data' },
    ];

    malformedData.forEach(data => {
      segmentationHandler?.(data);
      queueStatsHandler?.(data);
      notificationHandler?.(data);
    });
  }
}

/**
 * Helper to wait for async WebSocket operations in tests
 */
export const waitForWebSocketOperation = async (timeout = 100) => {
  await new Promise(resolve => setTimeout(resolve, timeout));
};

/**
 * Helper to create a fake timer context for testing time-based operations
 */
export const createFakeTimerContext = () => ({
  setup: () => vi.useFakeTimers(),
  cleanup: () => vi.useRealTimers(),
  advanceTime: (ms: number) => vi.advanceTimersByTime(ms),
  advanceToNextTimer: () => vi.advanceTimersToNextTimer(),
});

/**
 * Helper to assert event handler registration
 */
export const assertEventHandlerRegistered = (
  mockSocket: any,
  eventName: string
) => {
  const call = mockSocket.on.mock.calls.find(
    (call: any) => call[0] === eventName
  );
  if (!call) {
    throw new Error(`Event handler for '${eventName}' was not registered`);
  }
  return call[1]; // Return the handler function
};

/**
 * Helper to assert io event handler registration
 */
export const assertIoEventHandlerRegistered = (
  mockSocket: any,
  eventName: string
) => {
  const call = mockSocket.io.on.mock.calls.find(
    (call: any) => call[0] === eventName
  );
  if (!call) {
    throw new Error(`IO event handler for '${eventName}' was not registered`);
  }
  return call[1]; // Return the handler function
};

/**
 * Helper to create a complete WebSocket testing environment
 */
export const createWebSocketTestEnvironment = () => {
  const mockSocket = createMockSocket();
  const scenarios = new WebSocketTestScenarios(mockSocket);
  const timers = createFakeTimerContext();

  return {
    mockSocket,
    scenarios,
    timers,
    user: createMockUser(),

    // Common test data factories
    createSegmentationUpdate,
    createQueueStats,
    createNotification,
    createSystemMessage,

    // Assertion helpers
    assertEventHandlerRegistered: (eventName: string) =>
      assertEventHandlerRegistered(mockSocket, eventName),
    assertIoEventHandlerRegistered: (eventName: string) =>
      assertIoEventHandlerRegistered(mockSocket, eventName),

    // Cleanup
    cleanup: () => {
      mockSocket.__reset();
      timers.cleanup();
      vi.clearAllMocks();
    },
  };
};

/**
 * Type definitions for test utilities
 */
export type MockSocket = ReturnType<typeof createMockSocket>;
export type WebSocketTestEnvironment = ReturnType<
  typeof createWebSocketTestEnvironment
>;
