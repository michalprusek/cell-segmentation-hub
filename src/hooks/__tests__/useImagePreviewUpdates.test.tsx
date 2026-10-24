import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { WebSocketContext } from '@/contexts/WebSocketContext.types';
import { useImagePreviewUpdates } from '@/hooks/useImagePreviewUpdates';
import type WebSocketManager from '@/services/webSocketManager';

/** A manager double that records listeners and lets the test fire events. */
function fakeManager() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  return {
    on: vi.fn((event: string, fn: (data: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: (data: unknown) => void) => {
      listeners.get(event)?.delete(fn);
    }),
    fire(event: string, data: unknown) {
      listeners.get(event)?.forEach(fn => fn(data));
    },
    count(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

describe('useImagePreviewUpdates', () => {
  let manager: ReturnType<typeof fakeManager>;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WebSocketContext.Provider
      value={{
        manager: manager as unknown as WebSocketManager,
        socket: null,
        isConnected: true,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );

  beforeEach(() => {
    manager = fakeManager();
  });

  it('hands the previews of THIS project to the callback', () => {
    const onPreviews = vi.fn();
    renderHook(() => useImagePreviewUpdates('proj-1', onPreviews), { wrapper });

    manager.fire('image-previews-updated', {
      projectId: 'proj-1',
      previews: [{ imageId: 'img-1', previewUrl: '/p?v=1' }],
    });

    expect(onPreviews).toHaveBeenCalledWith([
      { imageId: 'img-1', previewUrl: '/p?v=1' },
    ]);
  });

  it('ignores another project and malformed entries', () => {
    const onPreviews = vi.fn();
    renderHook(() => useImagePreviewUpdates('proj-1', onPreviews), { wrapper });

    manager.fire('image-previews-updated', {
      projectId: 'proj-2',
      previews: [{ imageId: 'img-9', previewUrl: '/p?v=9' }],
    });
    manager.fire('image-previews-updated', {
      projectId: 'proj-1',
      previews: [
        { imageId: 'img-1' },
        null,
        { imageId: 'img-2', previewUrl: '/p?v=2' },
      ],
    });

    expect(onPreviews).toHaveBeenCalledTimes(1);
    expect(onPreviews).toHaveBeenCalledWith([
      { imageId: 'img-2', previewUrl: '/p?v=2' },
    ]);
  });

  it('uses the LATEST callback without re-subscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => useImagePreviewUpdates('proj-1', cb),
      { wrapper, initialProps: { cb: first } }
    );
    rerender({ cb: second });

    manager.fire('image-previews-updated', {
      projectId: 'proj-1',
      previews: [],
    });

    expect(manager.on).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(
      () => useImagePreviewUpdates('proj-1', vi.fn()),
      {
        wrapper,
      }
    );
    expect(manager.count('image-previews-updated')).toBe(1);

    unmount();

    expect(manager.count('image-previews-updated')).toBe(0);
  });
});
