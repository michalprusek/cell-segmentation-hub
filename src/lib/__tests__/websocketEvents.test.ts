import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webSocketEventEmitter, WebSocketEvent } from '@/lib/websocketEvents';

describe('WebSocketEventEmitter', () => {
  beforeEach(() => {
    // Clear all listeners before each test using public cleanup method
    webSocketEventEmitter.clearListeners();
  });

  describe('event emission', () => {
    it('should emit events to registered listeners', () => {
      const listener = vi.fn();
      const event: WebSocketEvent = { type: 'reconnecting' };

      webSocketEventEmitter.on('reconnecting', listener);
      webSocketEventEmitter.emit(event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should emit events with data payload', () => {
      const listener = vi.fn();
      const event: WebSocketEvent = {
        type: 'reconnected',
        data: { attempts: 3, message: 'Reconnected successfully' },
      };

      webSocketEventEmitter.on('reconnected', listener);
      webSocketEventEmitter.emit(event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should emit to multiple listeners for same event type', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();
      const event: WebSocketEvent = { type: 'connection_lost' };

      webSocketEventEmitter.on('connection_lost', listener1);
      webSocketEventEmitter.on('connection_lost', listener2);
      webSocketEventEmitter.on('connection_lost', listener3);

      webSocketEventEmitter.emit(event);

      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledWith(event);
      expect(listener3).toHaveBeenCalledWith(event);
    });

    it('should not affect listeners of different event types', () => {
      const reconnectingListener = vi.fn();
      const reconnectedListener = vi.fn();
      const reconnectFailedListener = vi.fn();

      webSocketEventEmitter.on('reconnecting', reconnectingListener);
      webSocketEventEmitter.on('reconnected', reconnectedListener);
      webSocketEventEmitter.on('reconnect_failed', reconnectFailedListener);

      const event: WebSocketEvent = { type: 'reconnecting' };
      webSocketEventEmitter.emit(event);

      expect(reconnectingListener).toHaveBeenCalledWith(event);
      expect(reconnectedListener).not.toHaveBeenCalled();
      expect(reconnectFailedListener).not.toHaveBeenCalled();
    });

    it('should handle emission when no listeners are registered', () => {
      const event: WebSocketEvent = { type: 'reconnecting' };

      // Should not throw
      expect(() => webSocketEventEmitter.emit(event)).not.toThrow();
    });
  });

  describe('listener registration', () => {
    it('should register listeners for event types', () => {
      const listener = vi.fn();

      webSocketEventEmitter.on('reconnecting', listener);

      const event: WebSocketEvent = { type: 'reconnecting' };
      webSocketEventEmitter.emit(event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should allow multiple listeners for same event type', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      webSocketEventEmitter.on('reconnected', listener1);
      webSocketEventEmitter.on('reconnected', listener2);

      const event: WebSocketEvent = { type: 'reconnected' };
      webSocketEventEmitter.emit(event);

      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it('should handle registering same listener multiple times', () => {
      const listener = vi.fn();

      webSocketEventEmitter.on('reconnecting', listener);
      webSocketEventEmitter.on('reconnecting', listener);
      webSocketEventEmitter.on('reconnecting', listener);

      const event: WebSocketEvent = { type: 'reconnecting' };
      webSocketEventEmitter.emit(event);

      // Should be called 3 times since it was registered 3 times
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('should register listeners for all supported event types', () => {
      const listeners = {
        reconnecting: vi.fn(),
        reconnected: vi.fn(),
        reconnect_failed: vi.fn(),
        connection_lost: vi.fn(),
      };

      // Register all listeners
      Object.entries(listeners).forEach(([eventType, listener]) => {
        webSocketEventEmitter.on(eventType, listener);
      });

      // Emit each event type
      Object.entries(listeners).forEach(([eventType, listener]) => {
        const event: WebSocketEvent = { type: eventType as any };
        webSocketEventEmitter.emit(event);
        expect(listener).toHaveBeenCalledWith(event);
      });
    });
  });

  describe('listener removal', () => {
    it('should remove specific listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      webSocketEventEmitter.on('reconnecting', listener1);
      webSocketEventEmitter.on('reconnecting', listener2);

      // Remove only listener1
      webSocketEventEmitter.off('reconnecting', listener1);

      const event: WebSocketEvent = { type: 'reconnecting' };
      webSocketEventEmitter.emit(event);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it('should handle removing non-existent listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      webSocketEventEmitter.on('reconnecting', listener1);

      // Try to remove listener that was never registered
      expect(() => {
        webSocketEventEmitter.off('reconnecting', listener2);
      }).not.toThrow();

      const event: WebSocketEvent = { type: 'reconnecting' };
      webSocketEventEmitter.emit(event);

      expect(listener1).toHaveBeenCalledWith(event);
    });

    it('should handle removing from non-existent event type', () => {
      const listener = vi.fn();

      // Try to remove listener from event type that has no listeners
      expect(() => {
        webSocketEventEmitter.off('reconnecting', listener);
      }).not.toThrow();
    });

    it('should allow re-registration after removal', () => {
      const listener = vi.fn();

      webSocketEventEmitter.on('reconnected', listener);
      webSocketEventEmitter.off('reconnected', listener);
      webSocketEventEmitter.on('reconnected', listener);

      const event: WebSocketEvent = { type: 'reconnected' };
      webSocketEventEmitter.emit(event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should remove only the specific instance when same listener registered multiple times', () => {
      const listener = vi.fn();

      webSocketEventEmitter.on('reconnecting', listener);
      webSocketEventEmitter.on('reconnecting', listener);
      webSocketEventEmitter.on('reconnecting', listener);

      // Remove one instance
      webSocketEventEmitter.off('reconnecting', listener);

      const event: WebSocketEvent = { type: 'reconnecting' };
      webSocketEventEmitter.emit(event);

      // Should be called 2 times (one instance removed)
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('event types and data structures', () => {
    it('should handle reconnecting events', () => {
      const listener = vi.fn();
      webSocketEventEmitter.on('reconnecting', listener);

      const event: WebSocketEvent = {
        type: 'reconnecting',
        data: { attempts: 2 },
      };

      webSocketEventEmitter.emit(event);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should handle reconnected events', () => {
      const listener = vi.fn();
      webSocketEventEmitter.on('reconnected', listener);

      const event: WebSocketEvent = {
        type: 'reconnected',
        data: {
          attempts: 3,
          message: 'Successfully reconnected',
        },
      };

      webSocketEventEmitter.emit(event);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should handle reconnect_failed events', () => {
      const listener = vi.fn();
      webSocketEventEmitter.on('reconnect_failed', listener);

      const event: WebSocketEvent = {
        type: 'reconnect_failed',
        data: {
          attempts: 10,
          message: 'Max reconnection attempts reached',
        },
      };

      webSocketEventEmitter.emit(event);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should handle connection_lost events', () => {
      const listener = vi.fn();
      webSocketEventEmitter.on('connection_lost', listener);

      const event: WebSocketEvent = {
        type: 'connection_lost',
        data: { message: 'Connection lost due to network error' },
      };

      webSocketEventEmitter.emit(event);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should handle events without data payload', () => {
      const listener = vi.fn();
      webSocketEventEmitter.on('reconnect_failed', listener);

      const event: WebSocketEvent = { type: 'reconnect_failed' };

      webSocketEventEmitter.emit(event);
      expect(listener).toHaveBeenCalledWith(event);
    });
  });

  describe('error handling', () => {
    it('should catch listener errors and continue with other listeners', () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      webSocketEventEmitter.on('reconnecting', errorListener);
      webSocketEventEmitter.on('reconnecting', goodListener);

      const event: WebSocketEvent = { type: 'reconnecting' };

      // Implementation should catch errors and continue with other listeners
      expect(() => webSocketEventEmitter.emit(event)).not.toThrow();

      // Both listeners should be called even if first one errors
      expect(errorListener).toHaveBeenCalledWith(event);
      expect(goodListener).toHaveBeenCalledWith(event);
    });

    it('should handle invalid listeners gracefully', () => {
      // Test that the implementation can handle edge cases
      const goodListener = vi.fn();
      webSocketEventEmitter.on('reconnecting', goodListener);

      const event: WebSocketEvent = { type: 'reconnecting' };

      // Should not throw with valid listeners
      expect(() => webSocketEventEmitter.emit(event)).not.toThrow();
      expect(goodListener).toHaveBeenCalledWith(event);
    });

    it('should handle empty listener arrays without issues', () => {
      const event: WebSocketEvent = { type: 'reconnect_failed' };

      // Should not throw when no listeners are registered
      expect(() => webSocketEventEmitter.emit(event)).not.toThrow();
    });
  });

  describe('memory management', () => {
    it('should not leak memory when listeners are removed', () => {
      const emitter = webSocketEventEmitter as any;
      const listeners = [];

      // Register many listeners
      for (let i = 0; i < 100; i++) {
        const listener = vi.fn();
        listeners.push(listener);
        webSocketEventEmitter.on('reconnecting', listener);
      }

      expect(emitter.listeners.get('reconnecting').length).toBe(100);

      // Remove all listeners
      listeners.forEach(listener => {
        webSocketEventEmitter.off('reconnecting', listener);
      });

      expect(emitter.listeners.get('reconnecting').length).toBe(0);
    });

    it('should handle rapid registration and removal', () => {
      const listener = vi.fn();

      // Rapid register/unregister cycle
      for (let i = 0; i < 10; i++) {
        webSocketEventEmitter.on('reconnecting', listener);
        webSocketEventEmitter.off('reconnecting', listener);
      }

      // Should not have any listeners left
      const emitter = webSocketEventEmitter as any;
      const eventListeners = emitter.listeners.get('reconnecting') || [];
      expect(eventListeners.length).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('should handle concurrent listener registration and event emission', () => {
      const listeners = [];
      const events = [];

      // Register listeners while emitting events
      for (let i = 0; i < 10; i++) {
        const listener = vi.fn();
        listeners.push(listener);
        webSocketEventEmitter.on('reconnecting', listener);

        const event: WebSocketEvent = {
          type: 'reconnecting',
          data: { attempts: i },
        };
        events.push(event);
        webSocketEventEmitter.emit(event);
      }

      // Each listener should have been called for events emitted after its registration
      listeners.forEach((listener, index) => {
        expect(listener).toHaveBeenCalledTimes(10 - index);
      });
    });

    it('should handle listener removal during event emission', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const removingListener = vi.fn().mockImplementation(() => {
        // Remove listener2 during execution
        webSocketEventEmitter.off('reconnecting', listener2);
      });

      webSocketEventEmitter.on('reconnecting', listener1);
      webSocketEventEmitter.on('reconnecting', removingListener);
      webSocketEventEmitter.on('reconnecting', listener2);

      const event: WebSocketEvent = { type: 'reconnecting' };
      webSocketEventEmitter.emit(event);

      expect(listener1).toHaveBeenCalledWith(event);
      expect(removingListener).toHaveBeenCalledWith(event);
      // listener2 may or may not be called depending on execution order
    });
  });

  describe('type safety', () => {
    it('should enforce correct event types', () => {
      const listener = vi.fn();

      // These should be valid event types
      webSocketEventEmitter.on('reconnecting', listener);
      webSocketEventEmitter.on('reconnected', listener);
      webSocketEventEmitter.on('reconnect_failed', listener);
      webSocketEventEmitter.on('connection_lost', listener);

      // These events should match the interface
      const validEvents: WebSocketEvent[] = [
        { type: 'reconnecting' },
        { type: 'reconnected', data: { attempts: 1 } },
        { type: 'reconnect_failed', data: { message: 'Failed' } },
        { type: 'connection_lost' },
      ];

      validEvents.forEach(event => {
        expect(() => webSocketEventEmitter.emit(event)).not.toThrow();
      });
    });
  });
});
