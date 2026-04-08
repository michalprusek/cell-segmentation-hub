import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import { useThumbnailUpdates } from '@/hooks/useThumbnailUpdates';
import { WebSocketContext } from '@/contexts/WebSocketContext.types';

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Build a minimal socket mock with on/off tracking
const createMockSocket = () => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler);
      }
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      listeners[event]?.forEach(h => h(...args));
    }),
    _listeners: listeners,
  };
};

type MockSocket = ReturnType<typeof createMockSocket>;

const createWrapper = (socket: MockSocket | null, isConnected: boolean) => {
  const contextValue = { socket: socket as any, isConnected, manager: null };

  return ({ children }: { children: ReactNode }) => (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};

describe('useThumbnailUpdates', () => {
  let mockSocket: MockSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket = createMockSocket();
  });

  describe('listener registration', () => {
    it('registers socket listeners when enabled, connected, and projectId is present', () => {
      const wrapper = createWrapper(mockSocket, true);

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: true,
          }),
        { wrapper }
      );

      // Should register project-specific and generic listener
      expect(mockSocket.on).toHaveBeenCalledWith(
        'thumbnailUpdate:proj-1',
        expect.any(Function)
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'thumbnailUpdate',
        expect.any(Function)
      );
    });

    it('does not register listeners when not connected', () => {
      const wrapper = createWrapper(mockSocket, false);

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: true,
          }),
        { wrapper }
      );

      expect(mockSocket.on).not.toHaveBeenCalled();
    });

    it('does not register listeners when disabled', () => {
      const wrapper = createWrapper(mockSocket, true);

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: false,
          }),
        { wrapper }
      );

      expect(mockSocket.on).not.toHaveBeenCalled();
    });

    it('does not register listeners when projectId is absent', () => {
      const wrapper = createWrapper(mockSocket, true);

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: undefined,
            enabled: true,
          }),
        { wrapper }
      );

      expect(mockSocket.on).not.toHaveBeenCalled();
    });

    it('does not register listeners when socket is null', () => {
      const wrapper = createWrapper(null, true);

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: true,
          }),
        { wrapper }
      );

      // on is never called when socket is null
      expect(mockSocket.on).not.toHaveBeenCalled();
    });
  });

  describe('callback invocation', () => {
    it('calls onThumbnailUpdate when socket emits thumbnailUpdate for the project', () => {
      const wrapper = createWrapper(mockSocket, true);
      const onThumbnailUpdate = vi.fn();

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: true,
            onThumbnailUpdate,
          }),
        { wrapper }
      );

      const updatePayload = {
        imageId: 'img-1',
        thumbnailData: {
          levelOfDetail: 1,
          url: 'http://example.com/thumb.jpg',
        },
      };

      // Simulate socket emit on the project-specific channel
      mockSocket.emit('thumbnailUpdate:proj-1', updatePayload);

      expect(onThumbnailUpdate).toHaveBeenCalledWith(updatePayload);
    });

    it('calls onThumbnailUpdate when generic thumbnailUpdate event fires', () => {
      const wrapper = createWrapper(mockSocket, true);
      const onThumbnailUpdate = vi.fn();

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: true,
            onThumbnailUpdate,
          }),
        { wrapper }
      );

      const updatePayload = {
        imageId: 'img-2',
        thumbnailData: { levelOfDetail: 2 },
      };

      mockSocket.emit('thumbnailUpdate', updatePayload);

      expect(onThumbnailUpdate).toHaveBeenCalledWith(updatePayload);
    });

    it('does not call callback when enabled is false', () => {
      const wrapper = createWrapper(mockSocket, true);
      const onThumbnailUpdate = vi.fn();

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: false,
            onThumbnailUpdate,
          }),
        { wrapper }
      );

      mockSocket.emit('thumbnailUpdate', {
        imageId: 'img-1',
        thumbnailData: { levelOfDetail: 1 },
      });

      expect(onThumbnailUpdate).not.toHaveBeenCalled();
    });

    it('does not call callback when projectId is missing', () => {
      const wrapper = createWrapper(mockSocket, true);
      const onThumbnailUpdate = vi.fn();

      renderHook(
        () =>
          useThumbnailUpdates({
            projectId: undefined,
            enabled: true,
            onThumbnailUpdate,
          }),
        { wrapper }
      );

      mockSocket.emit('thumbnailUpdate', {
        imageId: 'img-1',
        thumbnailData: { levelOfDetail: 1 },
      });

      expect(onThumbnailUpdate).not.toHaveBeenCalled();
    });
  });

  describe('returned values', () => {
    it('returns isConnected and enabled reflecting current state', () => {
      const wrapper = createWrapper(mockSocket, true);

      const { result } = renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: true,
          }),
        { wrapper }
      );

      expect(result.current.isConnected).toBe(true);
      expect(result.current.enabled).toBe(true);
    });

    it('returns enabled=false when projectId is absent', () => {
      const wrapper = createWrapper(mockSocket, true);

      const { result } = renderHook(
        () =>
          useThumbnailUpdates({
            projectId: undefined,
            enabled: true,
          }),
        { wrapper }
      );

      expect(result.current.enabled).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('removes socket listeners on unmount', () => {
      const wrapper = createWrapper(mockSocket, true);

      const { unmount } = renderHook(
        () =>
          useThumbnailUpdates({
            projectId: 'proj-1',
            enabled: true,
          }),
        { wrapper }
      );

      unmount();

      expect(mockSocket.off).toHaveBeenCalledWith(
        'thumbnailUpdate:proj-1',
        expect.any(Function)
      );
      expect(mockSocket.off).toHaveBeenCalledWith(
        'thumbnailUpdate',
        expect.any(Function)
      );
    });

    it('removes listeners when projectId changes', () => {
      const wrapper = createWrapper(mockSocket, true);
      let projectId = 'proj-1';

      const { rerender } = renderHook(
        () =>
          useThumbnailUpdates({
            projectId,
            enabled: true,
          }),
        { wrapper }
      );

      projectId = 'proj-2';
      rerender();

      // off should have been called for the old project listener
      expect(mockSocket.off).toHaveBeenCalledWith(
        'thumbnailUpdate:proj-1',
        expect.any(Function)
      );
    });
  });
});
