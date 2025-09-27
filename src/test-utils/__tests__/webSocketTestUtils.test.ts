import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSocket,
  createWebSocketTestEnvironment,
  WebSocketTestScenarios,
  createSegmentationUpdate,
  createQueueStats,
  createNotification,
  createSystemMessage,
  createMockUser,
  assertEventHandlerRegistered,
  waitForWebSocketOperation,
} from '@/test-utils/webSocketTestUtils';

describe('WebSocket Test Utilities', () => {
  describe('createMockSocket', () => {
    it('should create a comprehensive mock socket', () => {
      const mockSocket = createMockSocket();

      expect(mockSocket).toHaveProperty('connected', false);
      expect(mockSocket).toHaveProperty('id', 'mock-socket-id');
      expect(mockSocket).toHaveProperty('connect');
      expect(mockSocket).toHaveProperty('disconnect');
      expect(mockSocket).toHaveProperty('on');
      expect(mockSocket).toHaveProperty('off');
      expect(mockSocket).toHaveProperty('emit');
      expect(mockSocket).toHaveProperty('removeAllListeners');
      expect(mockSocket).toHaveProperty('io');

      // Helper methods
      expect(mockSocket).toHaveProperty('__simulateConnect');
      expect(mockSocket).toHaveProperty('__simulateDisconnect');
      expect(mockSocket).toHaveProperty('__simulateSegmentationUpdate');
      expect(mockSocket).toHaveProperty('__reset');
    });

    it('should simulate connection events', () => {
      const mockSocket = createMockSocket();
      const connectHandler = vi.fn();

      mockSocket.on('connect', connectHandler);
      mockSocket.__simulateConnect();

      expect(mockSocket.connected).toBe(true);
      expect(connectHandler).toHaveBeenCalled();
    });

    it('should simulate disconnection events', () => {
      const mockSocket = createMockSocket();
      const disconnectHandler = vi.fn();

      mockSocket.on('disconnect', disconnectHandler);
      mockSocket.__simulateDisconnect('test reason');

      expect(mockSocket.connected).toBe(false);
      expect(disconnectHandler).toHaveBeenCalledWith('test reason');
    });

    it('should simulate segmentation updates', () => {
      const mockSocket = createMockSocket();
      const updateHandler = vi.fn();
      const update = createSegmentationUpdate();

      mockSocket.on('segmentation-update', updateHandler);
      mockSocket.__simulateSegmentationUpdate(update);

      expect(updateHandler).toHaveBeenCalledWith(update);
    });

    it('should reset properly', () => {
      const mockSocket = createMockSocket();

      mockSocket.connected = true;
      mockSocket.id = 'changed-id';
      mockSocket.on('test', vi.fn());

      mockSocket.__reset();

      expect(mockSocket.connected).toBe(false);
      expect(mockSocket.id).toBe('mock-socket-id');
      expect(mockSocket.on).toHaveBeenCalledTimes(0);
    });
  });

  describe('Data Factory Functions', () => {
    it('should create segmentation update with defaults', () => {
      const update = createSegmentationUpdate();

      expect(update).toEqual({
        imageId: 'test-image-1',
        projectId: 'test-project-1',
        status: 'processing',
        progress: 50,
      });
    });

    it('should create segmentation update with overrides', () => {
      const update = createSegmentationUpdate({
        imageId: 'custom-image',
        status: 'completed',
        progress: 100,
      });

      expect(update).toEqual({
        imageId: 'custom-image',
        projectId: 'test-project-1',
        status: 'completed',
        progress: 100,
      });
    });

    it('should create queue stats with defaults', () => {
      const stats = createQueueStats();

      expect(stats).toEqual({
        projectId: 'test-project-1',
        queued: 3,
        processing: 1,
        total: 4,
      });
    });

    it('should create notification with defaults', () => {
      const notification = createNotification();

      expect(notification).toEqual({
        type: 'segmentation-complete',
        imageId: 'test-image-1',
        projectId: 'test-project-1',
        polygonCount: 15,
        timestamp: '2024-01-01T00:00:00Z',
      });
    });

    it('should create system message with defaults', () => {
      const message = createSystemMessage();

      expect(message).toEqual({
        type: 'info',
        message: 'System message',
        timestamp: '2024-01-01T00:00:00Z',
      });
    });

    it('should create mock user with defaults', () => {
      const user = createMockUser();

      expect(user).toEqual({
        id: 'test-user-123',
        token: 'test-token-abc',
      });
    });
  });

  describe('WebSocketTestScenarios', () => {
    let mockSocket: any;
    let scenarios: WebSocketTestScenarios;

    beforeEach(() => {
      mockSocket = createMockSocket();
      scenarios = new WebSocketTestScenarios(mockSocket);
    });

    it('should simulate successful connection', async () => {
      const connectHandler = vi.fn();
      mockSocket.on('connect', connectHandler);

      await scenarios.simulateSuccessfulConnection();

      expect(mockSocket.connected).toBe(true);
      expect(connectHandler).toHaveBeenCalled();
    });

    it('should simulate segmentation workflow', () => {
      const updateHandler = vi.fn();
      const notificationHandler = vi.fn();

      mockSocket.on('segmentation-update', updateHandler);
      mockSocket.on('notification', notificationHandler);

      const updates = scenarios.simulateSegmentationWorkflow('img-1', 'proj-1');

      expect(updateHandler).toHaveBeenCalledTimes(6); // start + 4 progress + completion
      expect(notificationHandler).toHaveBeenCalledTimes(1);
      expect(updates).toHaveLength(6);
      expect(updates[0].status).toBe('processing');
      expect(updates[updates.length - 1].status).toBe('completed');
    });

    it('should simulate segmentation error', () => {
      const updateHandler = vi.fn();
      const systemMessageHandler = vi.fn();

      mockSocket.on('segmentation-update', updateHandler);
      mockSocket.on('system-message', systemMessageHandler);

      const errorUpdate = scenarios.simulateSegmentationError(
        'img-1',
        'proj-1',
        'Out of memory'
      );

      expect(updateHandler).toHaveBeenCalledWith(errorUpdate);
      expect(systemMessageHandler).toHaveBeenCalled();
      expect(errorUpdate.status).toBe('failed');
      expect(errorUpdate.error).toBe('Out of memory');
    });

    it('should simulate connection loss and recovery', () => {
      const disconnectHandler = vi.fn();
      const reconnectHandler = vi.fn();

      mockSocket.on('disconnect', disconnectHandler);
      mockSocket.io.on('reconnect', reconnectHandler);

      scenarios.simulateConnectionLossAndRecovery('network error', 3);

      expect(disconnectHandler).toHaveBeenCalledWith('network error');
      expect(reconnectHandler).toHaveBeenCalledWith(3);
    });

    it('should simulate batch processing', () => {
      const updateHandler = vi.fn();
      const statsHandler = vi.fn();

      mockSocket.on('segmentation-update', updateHandler);
      mockSocket.on('queue-stats-update', statsHandler);

      scenarios.simulateBatchProcessing('proj-1', 3);

      // Should have start + completion for each image
      expect(updateHandler).toHaveBeenCalledTimes(6); // 3 starts + 3 completions
      // Should have initial stats + update after each completion
      expect(statsHandler).toHaveBeenCalledTimes(4);
    });

    it('should simulate rapid reconnections', () => {
      const connectHandler = vi.fn();
      const disconnectHandler = vi.fn();

      mockSocket.on('connect', connectHandler);
      mockSocket.on('disconnect', disconnectHandler);

      scenarios.simulateRapidReconnections(5);

      expect(connectHandler).toHaveBeenCalledTimes(5);
      expect(disconnectHandler).toHaveBeenCalledTimes(5);
    });

    it('should simulate malformed messages without throwing', () => {
      const updateHandler = vi.fn();
      const statsHandler = vi.fn();
      const notificationHandler = vi.fn();

      mockSocket.on('segmentation-update', updateHandler);
      mockSocket.on('queue-stats-update', statsHandler);
      mockSocket.on('notification', notificationHandler);

      expect(() => scenarios.simulateMalformedMessages()).not.toThrow();

      // Handlers should be called with malformed data
      expect(updateHandler).toHaveBeenCalledWith(null);
      expect(updateHandler).toHaveBeenCalledWith(undefined);
      expect(statsHandler).toHaveBeenCalledWith('');
      expect(notificationHandler).toHaveBeenCalledWith({});
    });
  });

  describe('Helper Functions', () => {
    it('should assert event handler registration', () => {
      const mockSocket = createMockSocket();
      const handler = vi.fn();

      mockSocket.on('test-event', handler);

      const registeredHandler = assertEventHandlerRegistered(
        mockSocket,
        'test-event'
      );
      expect(registeredHandler).toBe(handler);
    });

    it('should throw when event handler not registered', () => {
      const mockSocket = createMockSocket();

      expect(() =>
        assertEventHandlerRegistered(mockSocket, 'non-existent-event')
      ).toThrow("Event handler for 'non-existent-event' was not registered");
    });

    it('should wait for WebSocket operation', async () => {
      const startTime = Date.now();
      await waitForWebSocketOperation(50);
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThanOrEqual(50);
    });
  });

  describe('createWebSocketTestEnvironment', () => {
    it('should create complete test environment', () => {
      const env = createWebSocketTestEnvironment();

      expect(env).toHaveProperty('mockSocket');
      expect(env).toHaveProperty('scenarios');
      expect(env).toHaveProperty('timers');
      expect(env).toHaveProperty('user');
      expect(env).toHaveProperty('createSegmentationUpdate');
      expect(env).toHaveProperty('assertEventHandlerRegistered');
      expect(env).toHaveProperty('cleanup');
    });

    it('should provide working scenarios', () => {
      const env = createWebSocketTestEnvironment();
      const updateHandler = vi.fn();

      env.mockSocket.on('segmentation-update', updateHandler);
      env.scenarios.simulateSegmentationWorkflow();

      expect(updateHandler).toHaveBeenCalled();
    });

    it('should clean up properly', () => {
      const env = createWebSocketTestEnvironment();

      env.mockSocket.connected = true;
      env.mockSocket.on('test', vi.fn());

      env.cleanup();

      expect(env.mockSocket.connected).toBe(false);
      expect(env.mockSocket.on).toHaveBeenCalledTimes(0);
    });

    it('should provide assertion helpers', () => {
      const env = createWebSocketTestEnvironment();
      const handler = vi.fn();

      env.mockSocket.on('test-event', handler);

      const registeredHandler = env.assertEventHandlerRegistered('test-event');
      expect(registeredHandler).toBe(handler);
    });
  });

  describe('Real Usage Examples', () => {
    it('should demonstrate typical test workflow', async () => {
      const env = createWebSocketTestEnvironment();

      // Set up event listeners
      const updateHandler = vi.fn();
      const statsHandler = vi.fn();
      env.mockSocket.on('segmentation-update', updateHandler);
      env.mockSocket.on('queue-stats-update', statsHandler);

      // Simulate connection
      await env.scenarios.simulateSuccessfulConnection();
      expect(env.mockSocket.connected).toBe(true);

      // Simulate processing workflow
      env.scenarios.simulateSegmentationWorkflow('test-image', 'test-project');

      // Verify results
      expect(updateHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          imageId: 'test-image',
          projectId: 'test-project',
          status: 'processing',
        })
      );

      // Clean up
      env.cleanup();
    });

    it('should demonstrate error scenario testing', () => {
      const env = createWebSocketTestEnvironment();

      const errorHandler = vi.fn();
      const systemMessageHandler = vi.fn();

      env.mockSocket.on('segmentation-update', errorHandler);
      env.mockSocket.on('system-message', systemMessageHandler);

      // Simulate error scenario
      const errorUpdate = env.scenarios.simulateSegmentationError(
        'failed-image',
        'test-project',
        'GPU memory exhausted'
      );

      expect(errorHandler).toHaveBeenCalledWith(errorUpdate);
      expect(errorUpdate.status).toBe('failed');
      expect(errorUpdate.error).toBe('GPU memory exhausted');

      expect(systemMessageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('GPU memory exhausted'),
        })
      );

      env.cleanup();
    });

    it('should demonstrate timer-based testing', () => {
      const env = createWebSocketTestEnvironment();
      env.timers.setup();

      const pingHandler = vi.fn();
      // Simulate ping setup
      const pingInterval = setInterval(() => {
        if (env.mockSocket.connected) {
          pingHandler();
        }
      }, 25000);

      env.mockSocket.connected = true;

      // Advance timers
      env.timers.advanceTime(25000);
      expect(pingHandler).toHaveBeenCalledTimes(1);

      env.timers.advanceTime(25000);
      expect(pingHandler).toHaveBeenCalledTimes(2);

      // Clean up
      clearInterval(pingInterval);
      env.timers.cleanup();
      env.cleanup();
    });
  });
});
