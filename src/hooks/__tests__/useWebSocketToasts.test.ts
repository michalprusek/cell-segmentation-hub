import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';
import { useWebSocketToasts } from '@/hooks/useWebSocketToasts';
import { webSocketEventEmitter, WebSocketEvent } from '@/lib/websocketEvents';
import { useLanguage } from '@/contexts/exports';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock LanguageContext
vi.mock('@/contexts/exports', () => ({
  useLanguage: vi.fn(),
}));

// Mock websocket events
vi.mock('@/lib/websocketEvents', () => {
  const mockEmitter = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };

  return {
    webSocketEventEmitter: mockEmitter,
  };
});

describe('useWebSocketToasts', () => {
  const mockT = vi.fn((key: string) => `translated.${key}`);

  beforeEach(() => {
    vi.mocked(useLanguage).mockReturnValue({
      t: mockT,
      language: 'en',
      setLanguage: vi.fn(),
      availableLanguages: ['en'],
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('hook lifecycle', () => {
    it('should register event listeners on mount', () => {
      renderHook(() => useWebSocketToasts());

      expect(webSocketEventEmitter.on).toHaveBeenCalledWith(
        'reconnecting',
        expect.any(Function)
      );
      expect(webSocketEventEmitter.on).toHaveBeenCalledWith(
        'reconnected',
        expect.any(Function)
      );
      expect(webSocketEventEmitter.on).toHaveBeenCalledWith(
        'reconnect_failed',
        expect.any(Function)
      );
      expect(webSocketEventEmitter.on).toHaveBeenCalledWith(
        'connection_lost',
        expect.any(Function)
      );

      expect(webSocketEventEmitter.on).toHaveBeenCalledTimes(4);
    });

    it('should unregister event listeners on unmount', () => {
      const { unmount } = renderHook(() => useWebSocketToasts());

      // Get all registered handler functions
      const onCalls = vi.mocked(webSocketEventEmitter.on).mock.calls;
      const handlers = onCalls.map(call => call[1]);

      expect(handlers).toHaveLength(4);

      unmount();

      // Should call off for each registered event with its respective handler
      expect(webSocketEventEmitter.off).toHaveBeenCalledWith(
        'reconnecting',
        expect.any(Function)
      );
      expect(webSocketEventEmitter.off).toHaveBeenCalledWith(
        'reconnected',
        expect.any(Function)
      );
      expect(webSocketEventEmitter.off).toHaveBeenCalledWith(
        'reconnect_failed',
        expect.any(Function)
      );
      expect(webSocketEventEmitter.off).toHaveBeenCalledWith(
        'connection_lost',
        expect.any(Function)
      );

      expect(webSocketEventEmitter.off).toHaveBeenCalledTimes(4);
    });

    it('should re-register listeners when translation function changes', () => {
      const mockT1 = vi.fn((key: string) => `v1.${key}`);
      const mockT2 = vi.fn((key: string) => `v2.${key}`);

      vi.mocked(useLanguage).mockReturnValue({
        t: mockT1,
        language: 'en',
        setLanguage: vi.fn(),
        availableLanguages: ['en'],
      });

      const { rerender } = renderHook(() => useWebSocketToasts());

      const firstCallCount = vi.mocked(webSocketEventEmitter.on).mock.calls
        .length;

      // Change translation function
      vi.mocked(useLanguage).mockReturnValue({
        t: mockT2,
        language: 'es',
        setLanguage: vi.fn(),
        availableLanguages: ['en', 'es'],
      });

      rerender();

      // Should have been called again due to dependency change
      expect(
        vi.mocked(webSocketEventEmitter.on).mock.calls.length
      ).toBeGreaterThan(firstCallCount);
      expect(webSocketEventEmitter.off).toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    let eventHandler: (event: WebSocketEvent) => void;

    beforeEach(() => {
      renderHook(() => useWebSocketToasts());

      // Get the registered event handler - find the correct one for websocket events
      const onCalls = vi.mocked(webSocketEventEmitter.on).mock.calls;
      const websocketCall = onCalls.find(call => call[0] === 'reconnecting');
      eventHandler = websocketCall?.[1] as (event: WebSocketEvent) => void;
    });

    it('should show error toast for reconnecting event', () => {
      const event: WebSocketEvent = { type: 'reconnecting' };

      eventHandler(event);

      expect(mockT).toHaveBeenCalledWith('websocket.reconnecting');
      expect(toast.error).toHaveBeenCalledWith(
        'translated.websocket.reconnecting'
      );
    });

    it('should show success toast for reconnected event', () => {
      const event: WebSocketEvent = { type: 'reconnected' };

      eventHandler(event);

      expect(mockT).toHaveBeenCalledWith('websocket.reconnected');
      expect(toast.success).toHaveBeenCalledWith(
        'translated.websocket.reconnected'
      );
    });

    it('should show error toast for reconnect_failed event', () => {
      const event: WebSocketEvent = { type: 'reconnect_failed' };

      eventHandler(event);

      expect(mockT).toHaveBeenCalledWith('websocket.reconnectFailed');
      expect(toast.error).toHaveBeenCalledWith(
        'translated.websocket.reconnectFailed'
      );
    });

    it('should show error toast for connection_lost event', () => {
      const event: WebSocketEvent = { type: 'connection_lost' };

      eventHandler(event);

      expect(mockT).toHaveBeenCalledWith('websocket.connectionLost');
      expect(toast.error).toHaveBeenCalledWith(
        'translated.websocket.connectionLost'
      );
    });

    it('should handle unknown event types gracefully', () => {
      const event = { type: 'unknown_event' } as any;

      // Should not throw
      expect(() => eventHandler(event)).not.toThrow();

      // Should not show any toast
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(mockT).not.toHaveBeenCalled();
    });

    it('should handle events with additional data', () => {
      const event: WebSocketEvent = {
        type: 'reconnecting',
        data: {
          message: 'Connection lost',
          attempts: 3,
        },
      };

      eventHandler(event);

      // Should still show the toast regardless of additional data
      expect(toast.error).toHaveBeenCalledWith(
        'translated.websocket.reconnecting'
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid event sequences', () => {
      renderHook(() => useWebSocketToasts());

      const eventHandler = vi.mocked(webSocketEventEmitter.on).mock
        .calls[0][1] as (event: WebSocketEvent) => void;

      const events: WebSocketEvent[] = [
        { type: 'reconnecting' },
        { type: 'reconnect_failed' },
        { type: 'reconnecting' },
        { type: 'reconnected' },
      ];

      events.forEach(event => eventHandler(event));

      expect(toast.error).toHaveBeenCalledTimes(3); // 2 reconnecting + 1 failed
      expect(toast.success).toHaveBeenCalledTimes(1); // 1 reconnected
    });

    it('should work with different languages', () => {
      const mockTSpanish = vi.fn((key: string) => `es.${key}`);

      vi.mocked(useLanguage).mockReturnValue({
        t: mockTSpanish,
        language: 'es',
        setLanguage: vi.fn(),
        availableLanguages: ['en', 'es'],
      });

      renderHook(() => useWebSocketToasts());

      const eventHandler = vi.mocked(webSocketEventEmitter.on).mock
        .calls[0][1] as (event: WebSocketEvent) => void;

      eventHandler({ type: 'reconnected' });

      expect(mockTSpanish).toHaveBeenCalledWith('websocket.reconnected');
      expect(toast.success).toHaveBeenCalledWith('es.websocket.reconnected');
    });

    it('should handle component re-mounting', () => {
      const { unmount } = renderHook(() => useWebSocketToasts());

      // Initial mount
      expect(webSocketEventEmitter.on).toHaveBeenCalledTimes(4);

      // Unmount
      unmount();
      expect(webSocketEventEmitter.off).toHaveBeenCalledTimes(4);

      vi.clearAllMocks();

      // Re-mount with new hook instance
      const { unmount: unmount2 } = renderHook(() => useWebSocketToasts());
      expect(webSocketEventEmitter.on).toHaveBeenCalledTimes(4);

      unmount2();
    });

    it('should handle missing translation keys gracefully', () => {
      const mockTWithUndefined = vi.fn((key: string) => {
        if (key === 'websocket.reconnected') return undefined;
        return `translated.${key}`;
      });

      vi.mocked(useLanguage).mockReturnValue({
        t: mockTWithUndefined,
        language: 'en',
        setLanguage: vi.fn(),
        availableLanguages: ['en'],
      });

      renderHook(() => useWebSocketToasts());

      const eventHandler = vi.mocked(webSocketEventEmitter.on).mock
        .calls[0][1] as (event: WebSocketEvent) => void;

      // Should not throw even with missing translation
      expect(() => eventHandler({ type: 'reconnected' })).not.toThrow();

      expect(toast.success).toHaveBeenCalledWith(undefined);
    });
  });

  describe('memory and performance', () => {
    it('should not create memory leaks with multiple instances', () => {
      const instances = [];

      // Create multiple instances
      for (let i = 0; i < 10; i++) {
        instances.push(renderHook(() => useWebSocketToasts()));
      }

      // Should register 4 listeners per instance
      expect(webSocketEventEmitter.on).toHaveBeenCalledTimes(40);

      // Unmount all instances
      instances.forEach(instance => instance.unmount());

      // Should clean up all listeners
      expect(webSocketEventEmitter.off).toHaveBeenCalledTimes(40);
    });

    it('should handle high-frequency events without performance issues', () => {
      renderHook(() => useWebSocketToasts());

      const onCalls = vi.mocked(webSocketEventEmitter.on).mock.calls;
      const websocketCall = onCalls.find(call => call[0] === 'reconnecting');
      const eventHandler = websocketCall?.[1] as (
        event: WebSocketEvent
      ) => void;

      const startTime = performance.now();

      // Send many events rapidly
      for (let i = 0; i < 1000; i++) {
        eventHandler({ type: 'reconnecting' });
      }

      const endTime = performance.now();

      // Should complete quickly (less than 500ms)
      expect(endTime - startTime).toBeLessThan(500);

      // Should have called toast for each event
      expect(toast.error).toHaveBeenCalledTimes(1000);
    });

    it('should handle listener registration/cleanup efficiently', () => {
      // Measure multiple mount/unmount cycles
      const startTime = performance.now();

      const instances = [];
      for (let i = 0; i < 50; i++) {
        instances.push(renderHook(() => useWebSocketToasts()));
      }

      // Cleanup all instances
      instances.forEach(instance => instance.unmount());

      const endTime = performance.now();

      // Should complete quickly (less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe('error scenarios', () => {
    it('should handle toast function throwing errors', () => {
      const mockToastError = vi.fn().mockImplementation(() => {
        throw new Error('Toast failed');
      });

      vi.mocked(toast).error = mockToastError;

      renderHook(() => useWebSocketToasts());

      const eventHandler = vi.mocked(webSocketEventEmitter.on).mock
        .calls[0][1] as (event: WebSocketEvent) => void;

      // Toast errors will propagate - this is expected behavior
      expect(() => eventHandler({ type: 'reconnecting' })).toThrow(
        'Toast failed'
      );
    });

    it('should handle translation function throwing errors', () => {
      const mockTWithError = vi.fn().mockImplementation(() => {
        throw new Error('Translation failed');
      });

      vi.mocked(useLanguage).mockReturnValue({
        t: mockTWithError,
        language: 'en',
        setLanguage: vi.fn(),
        availableLanguages: ['en'],
      });

      // Should not throw during hook initialization
      expect(() => renderHook(() => useWebSocketToasts())).not.toThrow();
    });

    it('should handle event emitter errors', () => {
      const mockEmitterOn = vi.fn().mockImplementation(() => {
        throw new Error('Event registration failed');
      });

      vi.mocked(webSocketEventEmitter).on = mockEmitterOn;

      // Event emitter errors will propagate during hook initialization
      expect(() => renderHook(() => useWebSocketToasts())).toThrow(
        'Event registration failed'
      );
    });
  });
});
