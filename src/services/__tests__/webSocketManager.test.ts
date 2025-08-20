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

// Mock logger to prevent console spam in tests
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

describe('WebSocketManager', () => {
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
        reconnectionAttempts: vi.fn().mockReturnValue(5),
        reconnectionDelay: vi.fn().mockReturnValue(1000),
      },
    };

    // Setup io mock to return our mock socket
    vi.mocked(io).mockReturnValue(mockSocket);

    // Get fresh WebSocketManager instance
    wsManager = WebSocketManager.getInstance();

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    wsManager.disconnect();
    WebSocketManager.cleanup();
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers(); // Ensure real timers are restored
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = WebSocketManager.getInstance();
      const instance2 = WebSocketManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after cleanup', () => {
      const instance1 = WebSocketManager.getInstance();
      WebSocketManager.cleanup();
      const instance2 = WebSocketManager.getInstance();
      // Should be different instances after cleanup
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('connection management', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    it('should establish connection with correct configuration', async () => {
      const connectPromise = wsManager.connect(mockUser);

      // Simulate successful connection
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      await connectPromise;

      expect(io).toHaveBeenCalledWith('http://localhost:3001', {
        auth: {
          token: mockUser.token,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        autoConnect: true,
      });
    });

    it('should not reconnect if already connected with same user', async () => {
      // First connection
      mockSocket.connected = true;
      const connectPromise1 = wsManager.connect(mockUser);
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise1;

      vi.clearAllMocks();

      // Second connection attempt with same user
      await wsManager.connect(mockUser);

      expect(io).not.toHaveBeenCalled();
    });

    it('should disconnect before connecting with different user', async () => {
      // First connection
      const user1 = { id: 'user-1', token: 'token-1' };
      mockSocket.connected = true;
      const connectPromise1 = wsManager.connect(user1);
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise1;

      vi.clearAllMocks();

      // Second connection with different user
      const user2 = { id: 'user-2', token: 'token-2' };
      const connectPromise2 = wsManager.connect(user2);
      connectHandler?.();
      await connectPromise2;

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(io).toHaveBeenCalledWith(
        'http://localhost:3001',
        expect.objectContaining({
          auth: { token: user2.token },
        })
      );
    });

    it('should handle connection timeout', async () => {
      vi.useFakeTimers();

      const connectPromise = wsManager.connect(mockUser);

      // Fast-forward past timeout (15 seconds)
      vi.advanceTimersByTime(15000);

      await expect(connectPromise).rejects.toThrow('Connection timeout');

      vi.useRealTimers();
    });

    it('should handle connection error', async () => {
      const error = new Error('Connection failed');
      const connectPromise = wsManager.connect(mockUser);

      const connectErrorHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect_error'
      )?.[1];
      connectErrorHandler?.(error);

      await expect(connectPromise).rejects.toThrow('Connection failed');
    });

    it('should prevent concurrent connection attempts', async () => {
      const connectPromise1 = wsManager.connect(mockUser);
      const connectPromise2 = wsManager.connect(mockUser);

      // Simulate connection
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      await Promise.all([connectPromise1, connectPromise2]);

      // io should only be called once
      expect(io).toHaveBeenCalledTimes(1);
    });
  });

  describe('event handling', () => {
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

    it('should register and call segmentation-update listeners', () => {
      const listener = vi.fn();
      wsManager.on('segmentation-update', listener);

      const updateData: SegmentationUpdate = {
        imageId: 'image-123',
        projectId: 'project-456',
        status: 'completed',
        progress: 100,
      };

      // Find and call the segmentation-update handler
      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      handler?.(updateData);

      expect(listener).toHaveBeenCalledWith(updateData);
    });

    it('should register and call queue-stats-update listeners', () => {
      const listener = vi.fn();
      wsManager.on('queue-stats-update', listener);

      const statsData: QueueStats = {
        projectId: 'project-456',
        queued: 3,
        processing: 1,
        total: 4,
      };

      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'queue-stats-update'
      )?.[1];
      handler?.(statsData);

      expect(listener).toHaveBeenCalledWith(statsData);
    });

    it('should register and call notification listeners', () => {
      const listener = vi.fn();
      wsManager.on('notification', listener);

      const notificationData = {
        type: 'success',
        imageId: 'image-123',
        projectId: 'project-456',
        polygonCount: 42,
        timestamp: '2024-01-01T00:00:00Z',
      };

      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'notification'
      )?.[1];
      handler?.(notificationData);

      expect(listener).toHaveBeenCalledWith(notificationData);
    });

    it('should register and call system-message listeners', () => {
      const listener = vi.fn();
      wsManager.on('system-message', listener);

      const messageData = {
        type: 'info' as const,
        message: 'System maintenance scheduled',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'system-message'
      )?.[1];
      handler?.(messageData);

      expect(listener).toHaveBeenCalledWith(messageData);
    });

    it('should remove event listeners', () => {
      const listener = vi.fn();
      wsManager.on('segmentation-update', listener);
      wsManager.off('segmentation-update', listener);

      const updateData: SegmentationUpdate = {
        imageId: 'image-123',
        projectId: 'project-456',
        status: 'completed',
      };

      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      handler?.(updateData);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle multiple listeners for same event', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      wsManager.on('segmentation-update', listener1);
      wsManager.on('segmentation-update', listener2);

      const updateData: SegmentationUpdate = {
        imageId: 'image-123',
        projectId: 'project-456',
        status: 'completed',
      };

      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      handler?.(updateData);

      expect(listener1).toHaveBeenCalledWith(updateData);
      expect(listener2).toHaveBeenCalledWith(updateData);
    });

    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      wsManager.on('segmentation-update', errorListener);
      wsManager.on('segmentation-update', goodListener);

      const updateData: SegmentationUpdate = {
        imageId: 'image-123',
        projectId: 'project-456',
        status: 'completed',
      };

      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];

      // Should not throw despite error in first listener
      expect(() => handler?.(updateData)).not.toThrow();
      expect(goodListener).toHaveBeenCalledWith(updateData);
    });
  });

  describe('message emission and queuing', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    it('should emit messages when connected', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      const testData = { test: 'data' };
      wsManager.emit('test-event', testData);

      expect(mockSocket.emit).toHaveBeenCalledWith('test-event', testData);
    });

    it('should queue messages when disconnected', () => {
      // Don't connect
      const testData = { test: 'data' };
      wsManager.emit('test-event', testData);

      // Should not emit immediately
      expect(mockSocket.emit).not.toHaveBeenCalled();

      // Should emit after connection
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      expect(mockSocket.emit).toHaveBeenCalledWith('test-event', testData);
    });

    it('should flush multiple queued messages on connect', async () => {
      // Queue multiple messages
      wsManager.emit('event1', { data: 1 });
      wsManager.emit('event2', { data: 2 });
      wsManager.emit('event3', { data: 3 });

      // Connect
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // All messages should be emitted
      expect(mockSocket.emit).toHaveBeenCalledWith('event1', { data: 1 });
      expect(mockSocket.emit).toHaveBeenCalledWith('event2', { data: 2 });
      expect(mockSocket.emit).toHaveBeenCalledWith('event3', { data: 3 });
    });
  });

  describe('project room management', () => {
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

    it('should join project room', () => {
      wsManager.joinProject('project-123');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'join-project',
        'project-123'
      );
    });

    it('should leave project room', () => {
      wsManager.leaveProject('project-123');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'leave-project',
        'project-123'
      );
    });

    it('should request queue stats', () => {
      wsManager.requestQueueStats('project-123');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'request-queue-stats',
        'project-123'
      );
    });
  });

  describe('reconnection handling', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    it('should handle disconnect events', async () => {
      const disconnectListener = vi.fn();
      wsManager.on('disconnect', disconnectListener);

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Simulate disconnect
      mockSocket.connected = false;
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.('transport close');

      expect(disconnectListener).toHaveBeenCalledWith('transport close');
    });

    it('should emit reconnecting event on connection error', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      vi.clearAllMocks();

      // Simulate connection error after a few attempts
      const error = new Error('Connection failed');
      const connectErrorHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect_error'
      )?.[1];

      // Mock a few reconnection attempts
      for (let i = 0; i < 3; i++) {
        connectErrorHandler?.(error);
      }

      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'reconnecting',
      });
    });

    it('should emit reconnected event on successful reconnection', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Simulate reconnection
      const reconnectHandler = mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect'
      )?.[1];
      reconnectHandler?.(3);

      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'reconnected',
      });
    });

    it('should emit reconnect_failed event on failure', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Simulate reconnection failure
      const reconnectFailedHandler = mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect_failed'
      )?.[1];
      reconnectFailedHandler?.();

      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'reconnect_failed',
      });
    });
  });

  describe('ping keep-alive mechanism', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start ping interval on connect', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      vi.clearAllMocks();

      // Fast-forward 25 seconds (ping interval)
      vi.advanceTimersByTime(25000);

      expect(mockSocket.emit).toHaveBeenCalledWith('ping');
    });

    it('should send periodic pings', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      vi.clearAllMocks();

      // Fast-forward multiple ping intervals
      vi.advanceTimersByTime(75000); // 3 intervals

      expect(mockSocket.emit).toHaveBeenCalledTimes(3);
      expect(mockSocket.emit).toHaveBeenCalledWith('ping');
    });

    it('should not send ping when disconnected', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Disconnect
      mockSocket.connected = false;
      vi.clearAllMocks();

      // Fast-forward
      vi.advanceTimersByTime(25000);

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should stop ping interval on disconnect', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Disconnect
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.('transport close');

      vi.clearAllMocks();

      // Fast-forward
      vi.advanceTimersByTime(25000);

      expect(mockSocket.emit).not.toHaveBeenCalledWith('ping');
    });
  });

  describe('connection state', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    it('should track connection state correctly', async () => {
      expect(wsManager.isConnected).toBe(false);

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      expect(wsManager.isConnected).toBe(true);

      wsManager.disconnect();
      expect(wsManager.isConnected).toBe(false);
    });

    it('should return current user credentials', async () => {
      expect(wsManager.user).toBeNull();

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      expect(wsManager.user).toEqual(mockUser);

      wsManager.disconnect();
      expect(wsManager.user).toBeNull();
    });

    it('should return socket instance', async () => {
      expect(wsManager.getSocket()).toBeNull();

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      expect(wsManager.getSocket()).toBe(mockSocket);

      wsManager.disconnect();
      expect(wsManager.getSocket()).toBeNull();
    });
  });

  describe('cleanup and disconnect', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    it('should clean up all resources on disconnect', async () => {
      const listener = vi.fn();
      wsManager.on('segmentation-update', listener);

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      wsManager.disconnect();

      expect(mockSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(wsManager.isConnected).toBe(false);
      expect(wsManager.user).toBeNull();
      expect(wsManager.getSocket()).toBeNull();

      // Should not call listener after cleanup
      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];
      handler?.({ imageId: 'test', projectId: 'test', status: 'completed' });
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle cleanup without errors when not connected', () => {
      expect(() => wsManager.disconnect()).not.toThrow();
    });

    it('should clean up static instance on cleanup', () => {
      const instance1 = WebSocketManager.getInstance();
      WebSocketManager.cleanup();
      const instance2 = WebSocketManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('error handling', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    it('should handle connection errors gracefully', async () => {
      const errorListener = vi.fn();
      wsManager.on('connect_error', errorListener);

      const connectPromise = wsManager.connect(mockUser);

      const error = new Error('Connection failed');
      const connectErrorHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect_error'
      )?.[1];
      connectErrorHandler?.(error);

      await expect(connectPromise).rejects.toThrow('Connection failed');
      expect(errorListener).toHaveBeenCalledWith(error);
    });

    it('should handle general errors', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      const error = new Error('Socket error');
      const errorHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'error'
      )?.[1];

      // Should not throw
      expect(() => errorHandler?.(error)).not.toThrow();
    });

    it('should handle malformed event data', async () => {
      const listener = vi.fn();
      wsManager.on('segmentation-update', listener);

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      const handler = mockSocket.on.mock.calls.find(
        call => call[0] === 'segmentation-update'
      )?.[1];

      // Test various malformed data
      expect(() => handler?.(null)).not.toThrow();
      expect(() => handler?.(undefined)).not.toThrow();
      expect(() => handler?.('invalid-data')).not.toThrow();
      expect(() => handler?.({})).not.toThrow();
    });

    it('should handle authentication token expiry', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Simulate token expiry
      const connectErrorHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect_error'
      )?.[1];
      const authError = new Error('Authentication failed');
      connectErrorHandler?.(authError);

      // Should not show reconnecting toast for auth errors
      expect(webSocketEventEmitter.emit).not.toHaveBeenCalledWith({
        type: 'reconnecting',
      });
    });

    it('should handle connection wait timeout', async () => {
      vi.useFakeTimers();

      const connectPromise1 = wsManager.connect(mockUser);

      // Start second connection attempt immediately
      const connectPromise2 = wsManager.connect(mockUser);

      // Advance past wait timeout
      vi.advanceTimersByTime(30000);

      await expect(connectPromise2).rejects.toThrow('Connection wait timeout');

      vi.useRealTimers();
    });

    it('should handle missing user credentials', async () => {
      // Try to connect without user
      await expect(wsManager.connect(null as any)).rejects.toThrow(
        'User is required for WebSocket connection'
      );
    });
  });

  describe('advanced scenarios', () => {
    const mockUser = { id: 'user-123', token: 'test-token' };

    it('should handle manual reconnection with exponential backoff', async () => {
      vi.useFakeTimers();

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Simulate server disconnect (triggers manual reconnect)
      mockSocket.connected = false;
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.('io server disconnect');

      vi.clearAllMocks();

      // Mock createConnection to track reconnection attempts
      const createConnectionSpy = vi
        .spyOn(wsManager as any, 'createConnection')
        .mockImplementation(() => {
          throw new Error('Reconnection failed');
        });

      // Fast-forward to trigger reconnection attempts
      // First attempt: 1000ms delay
      vi.advanceTimersByTime(1000);
      expect(createConnectionSpy).toHaveBeenCalledTimes(1);

      // Second attempt: 2000ms delay
      vi.advanceTimersByTime(2000);
      expect(createConnectionSpy).toHaveBeenCalledTimes(2);

      // Third attempt: 4000ms delay
      vi.advanceTimersByTime(4000);
      expect(createConnectionSpy).toHaveBeenCalledTimes(3);

      createConnectionSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should prevent max reconnection attempts overflow', async () => {
      vi.useFakeTimers();

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Simulate server disconnect
      mockSocket.connected = false;
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.('io server disconnect');

      // Mock createConnection to always fail
      const createConnectionSpy = vi
        .spyOn(wsManager as any, 'createConnection')
        .mockImplementation(() => {
          throw new Error('Reconnection failed');
        });

      // Trigger enough reconnection attempts to hit the max
      for (let i = 0; i < 15; i++) {
        vi.advanceTimersByTime(30000); // Max delay
      }

      // Should emit connection_lost after max attempts
      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'connection_lost',
      });

      createConnectionSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should reset reconnection attempts on successful connection', async () => {
      vi.useFakeTimers();

      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // First disconnect and reconnect
      mockSocket.connected = false;
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.('io server disconnect');

      // Let one reconnection attempt happen
      vi.advanceTimersByTime(1000);

      // Simulate successful reconnection
      mockSocket.connected = true;
      connectHandler?.();

      // Second disconnect should start from attempt 1 again
      mockSocket.connected = false;
      disconnectHandler?.('io server disconnect');

      const createConnectionSpy = vi
        .spyOn(wsManager as any, 'createConnection')
        .mockImplementation(() => {
          throw new Error('Reconnection failed');
        });

      // Should start with 1000ms delay again (not 2000ms)
      vi.advanceTimersByTime(1000);
      expect(createConnectionSpy).toHaveBeenCalledTimes(1);

      createConnectionSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should handle rapid user switching', async () => {
      const user1 = { id: 'user-1', token: 'token-1' };
      const user2 = { id: 'user-2', token: 'token-2' };
      const user3 = { id: 'user-3', token: 'token-3' };

      // Connect as user1
      const connectPromise1 = wsManager.connect(user1);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise1;

      expect(wsManager.user).toEqual(user1);

      // Switch to user2
      vi.clearAllMocks();
      const connectPromise2 = wsManager.connect(user2);
      connectHandler?.();
      await connectPromise2;

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(wsManager.user).toEqual(user2);

      // Switch to user3
      vi.clearAllMocks();
      const connectPromise3 = wsManager.connect(user3);
      connectHandler?.();
      await connectPromise3;

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(wsManager.user).toEqual(user3);
    });

    it('should handle concurrent connection attempts with different users', async () => {
      const user1 = { id: 'user-1', token: 'token-1' };
      const user2 = { id: 'user-2', token: 'token-2' };

      // Start connection for user1
      const connectPromise1 = wsManager.connect(user1);

      // Immediately try to connect as user2 (should wait)
      const connectPromise2 = wsManager.connect(user2);

      // Complete user1 connection
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      await connectPromise1;

      // Should automatically switch to user2
      await connectPromise2;

      expect(wsManager.user).toEqual(user2);
    });

    it('should handle socket.io reconnection events properly', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Test all socket.io reconnection events
      const reconnectHandler = mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect'
      )?.[1];
      const reconnectAttemptHandler = mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect_attempt'
      )?.[1];
      const reconnectErrorHandler = mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect_error'
      )?.[1];
      const reconnectFailedHandler = mockSocket.io.on.mock.calls.find(
        call => call[0] === 'reconnect_failed'
      )?.[1];

      // Test reconnect success
      reconnectHandler?.(3);
      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'reconnected',
      });

      // Test reconnect attempt (should not throw)
      expect(() => reconnectAttemptHandler?.(2)).not.toThrow();

      // Test reconnect error (should not throw)
      expect(() =>
        reconnectErrorHandler?.(new Error('Reconnect failed'))
      ).not.toThrow();

      // Test reconnect failed
      reconnectFailedHandler?.();
      expect(webSocketEventEmitter.emit).toHaveBeenCalledWith({
        type: 'reconnect_failed',
      });
    });

    it('should handle edge case with empty project ID', async () => {
      const connectPromise = wsManager.connect(mockUser);
      mockSocket.connected = true;
      const connectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];
      connectHandler?.();
      await connectPromise;

      // Should handle empty or invalid project IDs gracefully
      expect(() => wsManager.joinProject('')).not.toThrow();
      expect(() => wsManager.leaveProject('')).not.toThrow();
      expect(() => wsManager.requestQueueStats('')).not.toThrow();

      expect(mockSocket.emit).toHaveBeenCalledWith('join-project', '');
      expect(mockSocket.emit).toHaveBeenCalledWith('leave-project', '');
      expect(mockSocket.emit).toHaveBeenCalledWith('request-queue-stats', '');
    });

    it('should handle browser beforeunload event', async () => {
      // Mock window environment
      const originalWindow = global.window;
      const mockWindow = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any;
      global.window = mockWindow;

      try {
        // Clear module cache to force re-import
        vi.resetModules();

        // Import to trigger beforeunload setup
        await import('@/services/webSocketManager');

        expect(mockWindow.addEventListener).toHaveBeenCalledWith(
          'beforeunload',
          expect.any(Function)
        );
      } finally {
        // Cleanup - restore original window
        global.window = originalWindow;
        vi.resetModules(); // Reset modules again to clear the mocked import
      }
    });
  });
});
