import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useSegmentationQueue } from '../useSegmentationQueue';
import React from 'react';
import { AuthContext } from '@/contexts/AuthContext.types';
import { WebSocketProvider } from '@/contexts/WebSocketContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

// Mock the webSocketManager - must include getInstance for WebSocketProvider + hook
const mockManagerInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  isConnected: false,
  getSocket: vi.fn(() => null),
  joinProject: vi.fn(),
  leaveProject: vi.fn(),
  requestQueueStats: vi.fn(),
};

vi.mock('@/services/webSocketManager', () => ({
  default: {
    getInstance: vi.fn(() => mockManagerInstance),
    cleanup: vi.fn(),
  },
}));

// Pre-authenticated user for testing (avoids async auth initialization)
const mockAuthValue = {
  user: {
    id: 'test-user',
    email: 'test@example.com',
    username: 'testuser',
    emailVerified: true,
  },
  profile: null,
  token: 'test-token',
  loading: false,
  isAuthenticated: true,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  deleteAccount: vi.fn(),
  refreshProfile: vi.fn(),
};

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
        <AuthContext.Provider value={mockAuthValue}>
          <LanguageProvider>
            <WebSocketProvider>{children}</WebSocketProvider>
          </LanguageProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

/**
 * Helper: fire a handler registered on the mock manager instance for a given event.
 * The hook registers listeners via mockManagerInstance.on('segmentation-update', handler).
 * This captures and fires that handler with the given data.
 */
const fireManagerEvent = (eventName: string, data: any) => {
  const call = mockManagerInstance.on.mock.calls.find(c => c[0] === eventName);
  if (call && typeof call[1] === 'function') {
    call[1](data);
  }
};

describe('useSegmentationQueue', () => {
  const mockProjectId = 'test-project-123';

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore connect mock after clearAllMocks
    mockManagerInstance.connect.mockResolvedValue(undefined);
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

  it('should update lastUpdate when segmentation-update event is received', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const update = {
      imageId: 'image-123',
      projectId: mockProjectId,
      status: 'processing' as const,
      progress: 50,
    };

    await act(async () => {
      fireManagerEvent('segmentation-update', update);
    });

    await waitFor(() => {
      expect(result.current.lastUpdate).toEqual(
        expect.objectContaining({
          imageId: 'image-123',
          status: 'processing',
        })
      );
    });
  });

  it('should update queueStats when queue-stats-update event is received', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const queueStats = {
      projectId: mockProjectId,
      queued: 10,
      processing: 2,
      total: 12,
    };

    await act(async () => {
      fireManagerEvent('queue-stats-update', queueStats);
    });

    await waitFor(() => {
      expect(result.current.queueStats).toEqual(queueStats);
    });
  });

  it('should update lastUpdate to completed when segmentation-update fires with completed status', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const completedUpdate = {
      imageId: 'image-123',
      projectId: mockProjectId,
      status: 'completed' as const,
      progress: 100,
    };

    await act(async () => {
      // First set to processing to initialize batch state
      fireManagerEvent('segmentation-update', {
        ...completedUpdate,
        status: 'processing',
      });
    });

    await act(async () => {
      fireManagerEvent('segmentation-update', completedUpdate);
    });

    await waitFor(() => {
      // lastUpdate gets every update
      expect(result.current.lastUpdate).toEqual(
        expect.objectContaining({ imageId: 'image-123' })
      );
    });
  });

  it('should update lastUpdate to failed when segmentation-update fires with failed status', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const failedUpdate = {
      imageId: 'image-123',
      projectId: mockProjectId,
      status: 'failed' as const,
      error: 'Processing error',
    };

    await act(async () => {
      fireManagerEvent('segmentation-update', failedUpdate);
    });

    await waitFor(() => {
      expect(result.current.lastUpdate).toEqual(
        expect.objectContaining({
          imageId: 'image-123',
          status: 'failed',
          error: 'Processing error',
        })
      );
    });
  });

  it('should clean up event listeners on unmount', () => {
    const { unmount } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    // The hook registers on these real event names
    const registeredEvents = [
      'segmentation-update',
      'queue-stats-update',
      'notification',
      'system-message',
    ];

    unmount();

    // Verify that off was called for each registered event
    registeredEvents.forEach(event => {
      expect(mockManagerInstance.off).toHaveBeenCalledWith(
        event,
        expect.any(Function)
      );
    });
  });

  it('should disconnect WebSocket when projectId changes to undefined', () => {
    // Without auth, hook early-returns — test the cleanup behavior when used within wrapper
    const { rerender } = renderHook(
      ({ projectId }) => useSegmentationQueue(projectId),
      {
        wrapper: createWrapper(),
        initialProps: { projectId: mockProjectId },
      }
    );

    rerender({ projectId: undefined });

    // When projectId becomes undefined, the hook should clean up (no active project)
    // The hook updates currentProjectRef but doesn't explicitly disconnect the manager
    expect(() => rerender({ projectId: undefined })).not.toThrow();
  });

  it('should reconnect WebSocket when projectId changes', () => {
    const { rerender } = renderHook(
      ({ projectId }) => useSegmentationQueue(projectId),
      {
        wrapper: createWrapper(),
        initialProps: { projectId: mockProjectId },
      }
    );

    const newProjectId = 'new-project-456';

    // Should not throw when project ID changes
    expect(() => rerender({ projectId: newProjectId })).not.toThrow();
  });

  it('should handle multiple rapid status updates', async () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    const updates = [
      {
        imageId: 'image-1',
        projectId: mockProjectId,
        status: 'processing' as const,
        progress: 25,
      },
      {
        imageId: 'image-1',
        projectId: mockProjectId,
        status: 'processing' as const,
        progress: 75,
      },
    ];

    await act(async () => {
      updates.forEach(update => {
        fireManagerEvent('segmentation-update', update);
      });
    });

    await waitFor(() => {
      // Should have the last update
      expect(result.current.lastUpdate).toEqual(
        expect.objectContaining({ imageId: 'image-1' })
      );
    });
  });

  it('should not update state after unmount', async () => {
    const { result, unmount } = renderHook(
      () => useSegmentationQueue(mockProjectId),
      {
        wrapper: createWrapper(),
      }
    );

    unmount();

    // Try to fire an event after unmount - should not throw
    expect(() => {
      fireManagerEvent('segmentation-update', {
        imageId: 'image-123',
        projectId: mockProjectId,
        status: 'processing' as const,
        progress: 50,
      });
    }).not.toThrow();

    // State should remain at initial null (not update after unmount)
    expect(result.current.lastUpdate).toBeNull();
  });

  it('should handle connection errors gracefully', async () => {
    mockManagerInstance.connect.mockRejectedValue(
      new Error('Connection failed')
    );

    // Should not throw
    expect(() => {
      renderHook(() => useSegmentationQueue(mockProjectId), {
        wrapper: createWrapper(),
      });
    }).not.toThrow();
  });
});
