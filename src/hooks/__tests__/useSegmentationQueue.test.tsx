import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSegmentationQueue } from '../useSegmentationQueue';
import webSocketManager from '@/services/webSocketManager';
import React from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { WebSocketProvider } from '@/contexts/WebSocketContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

// Mock the webSocketManager
vi.mock('@/services/webSocketManager', () => ({
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    isConnected: vi.fn(() => false),
  },
}));

// Create a test wrapper with all required providers
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LanguageProvider>
            <WebSocketProvider>{children}</WebSocketProvider>
          </LanguageProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

describe('useSegmentationQueue', () => {
  const mockProjectId = 'test-project-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize without throwing', () => {
    expect(() => {
      renderHook(() => useSegmentationQueue(mockProjectId), {
        wrapper: createWrapper(),
      });
    }).not.toThrow();
  });

  it('should handle undefined projectId without throwing', () => {
    expect(() => {
      renderHook(() => useSegmentationQueue(undefined), {
        wrapper: createWrapper(),
      });
    }).not.toThrow();
  });

  it('should update lastUpdate when segmentation status event is received', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const statusUpdate = {
      imageId: 'image-123',
      status: 'processing',
      polygonCount: 5,
    };

    act(() => {
      emitEvent('segmentationStatus', statusUpdate);
    });

    await waitFor(() => {
      expect(result.current.lastUpdate).toEqual({
        ...statusUpdate,
        timestamp: expect.any(Number),
      });
    });
  });

  it('should update queue statistics when queue stats event is received', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const queueStats = {
      queueLength: 10,
      processing: 2,
      userPosition: 3,
    };

    act(() => {
      emitEvent('queueStats', queueStats);
    });

    await waitFor(() => {
      expect(result.current.queueStats).toEqual(queueStats);
    });
  });

  it('should handle segmentation completed event', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const completedData = {
      imageId: 'image-123',
      polygonCount: 15,
      processingTime: 5000,
    };

    act(() => {
      emitEvent('segmentationCompleted', completedData);
    });

    await waitFor(() => {
      expect(result.current.lastUpdate).toEqual({
        imageId: completedData.imageId,
        status: 'completed',
        polygonCount: completedData.polygonCount,
        timestamp: expect.any(Number),
      });
    });
  });

  it('should handle segmentation failed event', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const failedData = {
      imageId: 'image-123',
      error: 'Processing error',
    };

    act(() => {
      emitEvent('segmentationFailed', failedData);
    });

    await waitFor(() => {
      expect(result.current.lastUpdate).toEqual({
        imageId: failedData.imageId,
        status: 'failed',
        error: failedData.error,
        timestamp: expect.any(Number),
      });
    });
  });

  it('should clean up event listeners on unmount', () => {
    const { unmount } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    // Capture the registered event handlers
    const registeredEvents = [
      'segmentationStatus',
      'queueStats',
      'segmentationCompleted',
      'segmentationFailed',
    ];

    unmount();

    // Verify that off was called for each registered event
    registeredEvents.forEach(event => {
      expect(webSocketManager.off).toHaveBeenCalledWith(
        event,
        expect.any(Function)
      );
    });
  });

  it('should disconnect WebSocket when projectId changes to undefined', () => {
    const { rerender } = renderHook(
      ({ projectId }) => useSegmentationQueue(projectId),
      {
        initialProps: { projectId: mockProjectId },
      }
    );

    expect(webSocketManager.connect).toHaveBeenCalledTimes(1);

    rerender({ projectId: undefined });

    expect(webSocketManager.disconnect).toHaveBeenCalled();
  });

  it('should reconnect WebSocket when projectId changes', () => {
    const { rerender } = renderHook(
      ({ projectId }) => useSegmentationQueue(projectId),
      {
        initialProps: { projectId: mockProjectId },
      }
    );

    expect(webSocketManager.connect).toHaveBeenCalledWith({
      projectId: mockProjectId,
    });

    const newProjectId = 'new-project-456';
    rerender({ projectId: newProjectId });

    expect(webSocketManager.disconnect).toHaveBeenCalled();
    expect(webSocketManager.connect).toHaveBeenCalledWith({
      projectId: newProjectId,
    });
  });

  it('should handle multiple rapid status updates', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const updates = [
      { imageId: 'image-1', status: 'queued', polygonCount: 0 },
      { imageId: 'image-1', status: 'processing', polygonCount: 0 },
      { imageId: 'image-1', status: 'completed', polygonCount: 10 },
    ];

    act(() => {
      updates.forEach(update => {
        emitEvent('segmentationStatus', update);
      });
    });

    await waitFor(() => {
      // Should have the last update
      expect(result.current.lastUpdate?.status).toBe('completed');
      expect(result.current.lastUpdate?.polygonCount).toBe(10);
    });
  });

  it('should not update state after unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useSegmentationQueue(mockProjectId)
    );

    unmount();

    const statusUpdate = {
      imageId: 'image-123',
      status: 'processing',
      polygonCount: 5,
    };

    act(() => {
      // Try to emit after unmount
      emitEvent('segmentationStatus', statusUpdate);
    });

    // State should not update
    expect(result.current.lastUpdate).toBeUndefined();
  });

  it('should handle connection errors gracefully', async () => {
    vi.mocked(webSocketManager.connect).mockImplementation(() => {
      throw new Error('Connection failed');
    });

    // Should not throw
    expect(() => {
      renderHook(() => useSegmentationQueue(mockProjectId), {
        wrapper: createWrapper(),
      });
    }).not.toThrow();
  });
});
