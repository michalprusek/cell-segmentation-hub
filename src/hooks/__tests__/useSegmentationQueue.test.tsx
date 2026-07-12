/**
 * useSegmentationQueue — consolidated test suite.
 *
 * Covers: hook interface, segmentation-update/queue-stats-update event
 * handling, the batch toast state machine, system messages, listener
 * lifecycle, cancellation-handler registration, the disabled/DISABLE_GLOBAL
 * and no-auth paths, and the queue-interaction helpers.
 *
 * Harness notes:
 *   - Auth is injected via AuthContext.Provider (authenticated `mockAuthValue`
 *     or `noAuthValue`) rather than the real AuthProvider, so tests control the
 *     user/token deterministically.
 *   - The WebSocketProvider drives `contextIsConnected` off a mocked manager
 *     whose `on` never fires the 'connect' event, so `isConnected` stays false
 *     throughout. The joinProject/leaveProject/requestQueueStats helpers guard
 *     on that flag and are therefore no-ops in unit scope.
 *   - `sonner` and `@/lib/logger` are mocked so toast/log side-effects are
 *     observable and silent.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { AuthContext } from '@/contexts/AuthContext.types';
import { WebSocketProvider } from '@/contexts/WebSocketContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { toast } from 'sonner';

// ─── mocks (hoisted) ──────────────────────────────────────────────────────────

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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// import after mocks
import { useSegmentationQueue } from '../useSegmentationQueue';

// ─── shared fixtures ──────────────────────────────────────────────────────────

const PROJECT = 'test-project-123';

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

const noAuthValue = { ...mockAuthValue, user: null as any, token: null as any };

function createWrapper(auth = mockAuthValue) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <LanguageProvider>
            <WebSocketProvider>{children}</WebSocketProvider>
          </LanguageProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

/**
 * Retrieve the latest handler the hook registered on the mock manager for a
 * given event (hook re-registers a stable wrapper per effect run — take last).
 */
function getHandler(event: string): ((...args: any[]) => void) | undefined {
  const calls = mockManagerInstance.on.mock.calls as [
    string,
    (...args: any[]) => void,
  ][];
  return [...calls].reverse().find(([ev]) => ev === event)?.[1];
}

// Event names the hook itself registers (distinct from the WS provider's
// connect/disconnect registrations).
const HOOK_EVENTS = [
  'segmentation-update',
  'queue-stats-update',
  'notification',
  'system-message',
];

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets the resolved value; restore it.
  mockManagerInstance.connect.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('useSegmentationQueue', () => {
  describe('initialization & interface', () => {
    it('returns the expected interface with null initial values', () => {
      const { result } = renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      expect(result.current).toHaveProperty('lastUpdate');
      expect(result.current).toHaveProperty('queueStats');
      expect(result.current).toHaveProperty('isConnected');
      expect(result.current.lastUpdate).toBeNull();
      expect(result.current.queueStats).toBeNull();
      expect(typeof result.current.isConnected).toBe('boolean');
    });

    it('handles an undefined projectId without throwing', () => {
      expect(() =>
        renderHook(() => useSegmentationQueue(undefined), {
          wrapper: createWrapper(),
        })
      ).not.toThrow();
    });

    it('handles a WebSocket connection error gracefully', () => {
      mockManagerInstance.connect.mockRejectedValue(
        new Error('Connection failed')
      );
      expect(() =>
        renderHook(() => useSegmentationQueue(PROJECT), {
          wrapper: createWrapper(),
        })
      ).not.toThrow();
    });
  });

  describe('segmentation-update events', () => {
    it('sets lastUpdate from a segmentation-update event', async () => {
      const { result } = renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        getHandler('segmentation-update')!({
          imageId: 'image-123',
          projectId: PROJECT,
          status: 'processing',
          progress: 50,
        });
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

    it('sets lastUpdate and fires toast.error for a failed status outside a batch', async () => {
      const { result } = renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        getHandler('segmentation-update')!({
          imageId: 'image-123',
          projectId: PROJECT,
          status: 'failed',
          error: 'Processing error',
        });
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
      expect(toast.error).toHaveBeenCalled();
    });

    it('keeps the last of multiple rapid updates', async () => {
      const { result } = renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        const seg = getHandler('segmentation-update')!;
        seg({
          imageId: 'image-1',
          projectId: PROJECT,
          status: 'processing',
          progress: 25,
        });
        seg({
          imageId: 'image-1',
          projectId: PROJECT,
          status: 'processing',
          progress: 75,
        });
      });

      await waitFor(() => {
        expect(result.current.lastUpdate).toEqual(
          expect.objectContaining({ imageId: 'image-1' })
        );
      });
    });

    it('does not update state (or throw) after unmount', () => {
      const { result, unmount } = renderHook(
        () => useSegmentationQueue(PROJECT),
        { wrapper: createWrapper() }
      );

      const seg = getHandler('segmentation-update')!;
      unmount();

      expect(() =>
        seg({
          imageId: 'image-123',
          projectId: PROJECT,
          status: 'processing',
          progress: 50,
        })
      ).not.toThrow();
      expect(result.current.lastUpdate).toBeNull();
    });
  });

  describe('queue-stats-update events', () => {
    it('updates queueStats for the matching projectId', async () => {
      const { result } = renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      const stats = {
        projectId: PROJECT,
        queued: 10,
        processing: 2,
        total: 12,
      };
      await act(async () => {
        getHandler('queue-stats-update')!(stats);
      });

      await waitFor(() => {
        expect(result.current.queueStats).toEqual(stats);
      });
    });

    it('ignores queue-stats for a different projectId', async () => {
      const { result } = renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        getHandler('queue-stats-update')!({
          projectId: 'other-project',
          queued: 99,
          processing: 1,
          total: 100,
        });
      });

      expect(result.current.queueStats).toBeNull();
    });
  });

  describe('batch toast state machine', () => {
    // Drives the hook through processing → completion transitions and asserts
    // the correct batch-summary toast. Each test starts a batch with a
    // 'processing' segmentation-update, then feeds queue-stats to size/drain it.
    it('does not show a start toast for small batches (≤10 items)', async () => {
      renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        getHandler('segmentation-update')!({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'processing',
          progress: 0,
        });
      });
      await act(async () => {
        getHandler('queue-stats-update')!({
          projectId: PROJECT,
          queued: 4,
          processing: 1,
          total: 5,
        });
      });

      expect(toast.info).not.toHaveBeenCalled();
    });

    it('shows a start toast for large batches (>10 items)', async () => {
      renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        getHandler('segmentation-update')!({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'processing',
          progress: 0,
        });
      });
      await act(async () => {
        getHandler('queue-stats-update')!({
          projectId: PROJECT,
          queued: 14,
          processing: 1,
          total: 15,
        });
      });

      expect(toast.info).toHaveBeenCalled();
    });

    it('shows a success toast for a single-image completion', async () => {
      renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      const seg = getHandler('segmentation-update')!;
      const stats = getHandler('queue-stats-update')!;

      await act(async () => {
        seg({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'processing',
          progress: 0,
        });
      });
      await act(async () => {
        stats({ projectId: PROJECT, queued: 0, processing: 1, total: 1 });
      });
      await act(async () => {
        seg({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'segmented',
          progress: 100,
        });
      });
      await act(async () => {
        stats({ projectId: PROJECT, queued: 0, processing: 0, total: 0 });
      });

      expect(toast.success).toHaveBeenCalled();
    });

    it('shows a success toast for a multi-image batch', async () => {
      renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      const seg = getHandler('segmentation-update')!;
      const stats = getHandler('queue-stats-update')!;

      await act(async () => {
        seg({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'processing',
          progress: 0,
        });
      });
      await act(async () => {
        stats({ projectId: PROJECT, queued: 1, processing: 1, total: 2 });
      });
      await act(async () => {
        seg({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'segmented',
          progress: 100,
        });
      });
      await act(async () => {
        seg({
          imageId: 'img-2',
          projectId: PROJECT,
          status: 'segmented',
          progress: 100,
        });
      });
      await act(async () => {
        stats({ projectId: PROJECT, queued: 0, processing: 0, total: 0 });
      });

      expect(toast.success).toHaveBeenCalled();
    });

    it('shows a warning toast when some images failed in the batch', async () => {
      renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      const seg = getHandler('segmentation-update')!;
      const stats = getHandler('queue-stats-update')!;

      await act(async () => {
        seg({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'processing',
          progress: 0,
        });
      });
      await act(async () => {
        stats({ projectId: PROJECT, queued: 1, processing: 1, total: 2 });
      });
      await act(async () => {
        seg({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'segmented',
          progress: 100,
        });
      });
      await act(async () => {
        seg({
          imageId: 'img-2',
          projectId: PROJECT,
          status: 'failed',
          progress: 0,
        });
      });
      await act(async () => {
        stats({ projectId: PROJECT, queued: 0, processing: 0, total: 0 });
      });

      expect(toast.warning).toHaveBeenCalled();
    });

    it('invokes onBatchCompleted when the queue drains', async () => {
      const onBatchCompleted = vi.fn();
      renderHook(
        () =>
          useSegmentationQueue(PROJECT, undefined, undefined, onBatchCompleted),
        { wrapper: createWrapper() }
      );

      const seg = getHandler('segmentation-update')!;
      const stats = getHandler('queue-stats-update')!;

      await act(async () => {
        seg({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'processing',
          progress: 0,
        });
      });
      await act(async () => {
        stats({ projectId: PROJECT, queued: 0, processing: 1, total: 1 });
      });
      await act(async () => {
        seg({
          imageId: 'img-1',
          projectId: PROJECT,
          status: 'segmented',
          progress: 100,
        });
      });
      await act(async () => {
        stats({ projectId: PROJECT, queued: 0, processing: 0, total: 0 });
      });

      expect(onBatchCompleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('system messages', () => {
    function fireSystemMessage(msg: { type: string; message: string }) {
      renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });
      act(() => {
        getHandler('system-message')!(msg);
      });
    }

    it('routes a warning message to toast.warning', () => {
      fireSystemMessage({ type: 'warning', message: 'Queue warning' });
      expect(toast.warning).toHaveBeenCalledWith('Queue warning');
    });

    it('routes an error message to toast.error', () => {
      fireSystemMessage({ type: 'error', message: 'Queue error' });
      expect(toast.error).toHaveBeenCalledWith('Queue error');
    });

    it('routes any other message type to toast.info', () => {
      fireSystemMessage({ type: 'info', message: 'Queue info' });
      expect(toast.info).toHaveBeenCalledWith('Queue info');
    });
  });

  describe('listener lifecycle', () => {
    it('deregisters all hook event listeners on unmount', () => {
      const { unmount } = renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      unmount();

      HOOK_EVENTS.forEach(event => {
        expect(mockManagerInstance.off).toHaveBeenCalledWith(
          event,
          expect.any(Function)
        );
      });
    });

    it('handles projectId changes (to a new id and to undefined) without throwing', () => {
      const { rerender } = renderHook(
        ({ projectId }) => useSegmentationQueue(projectId),
        {
          wrapper: createWrapper(),
          initialProps: { projectId: PROJECT as string | undefined },
        }
      );

      expect(() => rerender({ projectId: 'new-project-456' })).not.toThrow();
      expect(() => rerender({ projectId: undefined })).not.toThrow();
    });
  });

  describe('cancellation handlers', () => {
    it('registers and deregisters onSegmentationCancelled when provided', () => {
      const cancelHandler = vi.fn();
      const { unmount } = renderHook(
        () => useSegmentationQueue(PROJECT, cancelHandler),
        { wrapper: createWrapper() }
      );

      expect(mockManagerInstance.on.mock.calls.map(([ev]) => ev)).toContain(
        'segmentation:cancelled'
      );

      unmount();

      expect(mockManagerInstance.off.mock.calls.map(([ev]) => ev)).toContain(
        'segmentation:cancelled'
      );
    });

    it('registers and deregisters onBulkSegmentationCancelled when provided', () => {
      const bulkCancelHandler = vi.fn();
      const { unmount } = renderHook(
        () => useSegmentationQueue(PROJECT, undefined, bulkCancelHandler),
        { wrapper: createWrapper() }
      );

      expect(mockManagerInstance.on.mock.calls.map(([ev]) => ev)).toContain(
        'segmentation:bulk-cancelled'
      );

      unmount();

      expect(mockManagerInstance.off.mock.calls.map(([ev]) => ev)).toContain(
        'segmentation:bulk-cancelled'
      );
    });
  });

  describe('disabled / no-auth paths', () => {
    it('skips hook listeners and joinProject when disableEventHandlers=true', () => {
      renderHook(
        () =>
          useSegmentationQueue(PROJECT, undefined, undefined, undefined, true),
        { wrapper: createWrapper() }
      );

      const hookEvents = mockManagerInstance.on.mock.calls
        .map(([ev]) => ev)
        .filter(ev => HOOK_EVENTS.includes(ev));
      expect(hookEvents).toHaveLength(0);
      expect(mockManagerInstance.joinProject).not.toHaveBeenCalled();
    });

    it('treats DISABLE_GLOBAL as disabled (no listeners, null return values)', () => {
      const { result } = renderHook(
        () => useSegmentationQueue('DISABLE_GLOBAL'),
        { wrapper: createWrapper() }
      );

      const hookEvents = mockManagerInstance.on.mock.calls
        .map(([ev]) => ev)
        .filter(ev => HOOK_EVENTS.includes(ev));
      expect(hookEvents).toHaveLength(0);
      expect(mockManagerInstance.joinProject).not.toHaveBeenCalled();
      expect(result.current.lastUpdate).toBeNull();
      expect(result.current.queueStats).toBeNull();
      expect(result.current.isConnected).toBe(false);
    });

    it('does not register any listeners when there is no authenticated user', () => {
      renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(noAuthValue),
      });
      expect(mockManagerInstance.on).not.toHaveBeenCalled();
    });
  });

  describe('queue interaction helpers', () => {
    it('exposes joinProject / leaveProject / requestQueueStats as safe no-ops while disconnected', async () => {
      const { result } = renderHook(() => useSegmentationQueue(PROJECT), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(mockManagerInstance.on).toHaveBeenCalled());

      expect(() => {
        act(() => {
          result.current.joinProject('new-project');
          result.current.leaveProject();
          result.current.requestQueueStats();
        });
      }).not.toThrow();

      // isConnected is false in unit scope, so the guarded helpers do nothing.
      expect(mockManagerInstance.joinProject).not.toHaveBeenCalled();
      expect(mockManagerInstance.leaveProject).not.toHaveBeenCalled();
      expect(mockManagerInstance.requestQueueStats).not.toHaveBeenCalled();
    });
  });
});
