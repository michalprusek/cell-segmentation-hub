import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactNode } from 'react';

// ---- module mocks ----------------------------------------------------------

vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi
      .fn()
      .mockResolvedValue({ preferred_theme: 'system', preferredLang: 'en' }),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getAccessToken: vi.fn(() => null),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
    getProject: vi.fn(),
    getProjectImages: vi.fn(),
    getSegmentationResults: vi.fn(),
    getBatchSegmentationResults: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/thumbnailCache', () => ({
  thumbnailCache: {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    invalidate: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/performanceMonitor', () => ({
  performanceMonitor: {
    recordDatabaseFetch: vi.fn(),
    recordWebSocketUpdate: vi.fn(),
  },
}));

// Build a mock WebSocketManager class that exposes on/off/joinProject/leaveProject/requestQueueStats.
const mockWsOn = vi.fn();
const mockWsOff = vi.fn();
const mockJoinProject = vi.fn();
const mockLeaveProject = vi.fn();
const mockRequestQueueStats = vi.fn();

const mockManagerInstance = {
  on: mockWsOn,
  off: mockWsOff,
  joinProject: mockJoinProject,
  leaveProject: mockLeaveProject,
  requestQueueStats: mockRequestQueueStats,
};

vi.mock('@/services/webSocketManager', () => ({
  default: {
    getInstance: vi.fn(() => mockManagerInstance),
  },
}));

// ---- providers -------------------------------------------------------------

import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { WebSocketContext } from '@/contexts/WebSocketContext.types';

// Provide a stable WebSocket context value that reports isConnected=true so
// the hook actually registers event listeners.
const webSocketContextValue = {
  manager: mockManagerInstance as any,
  socket: null,
  isConnected: true,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <AuthProvider>
      <WebSocketContext.Provider value={webSocketContextValue}>
        <LanguageProvider>{children}</LanguageProvider>
      </WebSocketContext.Provider>
    </AuthProvider>
  </MemoryRouter>
);

// ---- hook under test -------------------------------------------------------

import { useUnifiedSegmentationUpdate } from '@/hooks/useUnifiedSegmentationUpdate';
import apiClient from '@/lib/api';

// ---- tests -----------------------------------------------------------------

describe('useUnifiedSegmentationUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the connected state
    webSocketContextValue.isConnected = true;
  });

  describe('initial state', () => {
    it('exposes isConnected, queueStats, lastUpdate and control functions', () => {
      const { result } = renderHook(
        () => useUnifiedSegmentationUpdate({ projectId: 'proj-1' }),
        { wrapper }
      );

      expect(typeof result.current.isConnected).toBe('boolean');
      expect(result.current.queueStats).toBeNull();
      expect(result.current.lastUpdate).toBeNull();
      expect(typeof result.current.requestQueueStats).toBe('function');
      expect(typeof result.current.joinProject).toBe('function');
      expect(typeof result.current.leaveProject).toBe('function');
    });
  });

  describe('event listener registration', () => {
    it('registers event listeners when user and token are available (via AuthProvider)', async () => {
      // Make the AuthProvider believe there is a logged-in user
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('tok-123');

      const { result } = renderHook(
        () =>
          useUnifiedSegmentationUpdate({ projectId: 'proj-1', enabled: true }),
        { wrapper }
      );

      await waitFor(() => {
        // At least one .on call means listeners were registered
        expect(mockWsOn).toHaveBeenCalled();
      });

      expect(result.current.isConnected).toBe(true);
    });

    it('does NOT register listeners when enabled is false', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);

      renderHook(
        () =>
          useUnifiedSegmentationUpdate({ projectId: 'proj-1', enabled: false }),
        { wrapper }
      );

      // Wait briefly to confirm no listeners are added
      await new Promise(r => setTimeout(r, 30));

      // Without a user in state, the hook skips registration. When disabled
      // the effect also skips, so on should not have been called with segmentation-update.
      const segUpdateCalls = mockWsOn.mock.calls.filter(
        c => c[0] === 'segmentation-update'
      );
      expect(segUpdateCalls).toHaveLength(0);
    });
  });

  describe('fetchSegmentationData', () => {
    it('calls apiClient.getSegmentationResults and triggers onImageUpdate', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('tok-abc');

      const mockSegData = {
        polygons: [{ id: 'p1', points: [] }],
        imageWidth: 800,
        imageHeight: 600,
        polygonCount: 1,
      };
      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue(
        mockSegData as any
      );

      const onImageUpdate = vi.fn();

      renderHook(
        () =>
          useUnifiedSegmentationUpdate({
            projectId: 'proj-seg',
            onImageUpdate,
            enabled: true,
          }),
        { wrapper }
      );

      // Let the hook finish setting up listeners
      await waitFor(() => {
        expect(mockWsOn).toHaveBeenCalled();
      });

      // Grab the handler registered for 'segmentation-update' and call it
      const segmentationUpdateHandler = mockWsOn.mock.calls.find(
        c => c[0] === 'segmentation-update'
      )?.[1];

      expect(segmentationUpdateHandler).toBeDefined();

      await act(async () => {
        await segmentationUpdateHandler({
          imageId: 'img-1',
          projectId: 'proj-seg',
          status: 'completed',
        });
      });

      await waitFor(() => {
        expect(onImageUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            imageId: 'img-1',
            projectId: 'proj-seg',
            status: 'completed',
          })
        );
      });
    });

    it('deduplicates concurrent fetches for the same imageId', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('tok-abc');

      let resolveFirst!: (v: any) => void;
      const firstCall = new Promise(r => {
        resolveFirst = r;
      });
      vi.mocked(apiClient.getSegmentationResults)
        .mockImplementationOnce(() => firstCall as any)
        .mockResolvedValue({
          polygons: [],
          imageWidth: 100,
          imageHeight: 100,
        } as any);

      const onImageUpdate = vi.fn();

      renderHook(
        () =>
          useUnifiedSegmentationUpdate({
            projectId: 'proj-dedup',
            onImageUpdate,
            enabled: true,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(mockWsOn).toHaveBeenCalled();
      });

      const segmentationUpdateHandler = mockWsOn.mock.calls.find(
        c => c[0] === 'segmentation-update'
      )?.[1];

      // Fire two concurrent updates for the same imageId
      act(() => {
        segmentationUpdateHandler({
          imageId: 'img-dup',
          projectId: 'proj-dedup',
          status: 'completed',
        });
        segmentationUpdateHandler({
          imageId: 'img-dup',
          projectId: 'proj-dedup',
          status: 'completed',
        });
      });

      resolveFirst({ polygons: [], imageWidth: 100, imageHeight: 100 });

      await waitFor(() => {
        // Only one actual API call should have been made due to deduplication
        expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('queueStats', () => {
    it('updates queueStats state when a matching queueStats event fires', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('tok-abc');

      const { result } = renderHook(
        () =>
          useUnifiedSegmentationUpdate({
            projectId: 'proj-stats',
            enabled: true,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(mockWsOn).toHaveBeenCalled();
      });

      const queueStatsHandler = mockWsOn.mock.calls.find(
        c => c[0] === 'queueStats'
      )?.[1];

      expect(queueStatsHandler).toBeDefined();

      act(() => {
        queueStatsHandler({
          projectId: 'proj-stats',
          total: 10,
          queued: 5,
          processing: 2,
          completed: 3,
          failed: 0,
        });
      });

      await waitFor(() => {
        expect(result.current.queueStats).toMatchObject({
          projectId: 'proj-stats',
          total: 10,
          queued: 5,
        });
      });
    });

    it('does not update queueStats for a different projectId', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('tok-abc');

      const { result } = renderHook(
        () =>
          useUnifiedSegmentationUpdate({
            projectId: 'proj-mine',
            enabled: true,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(mockWsOn).toHaveBeenCalled();
      });

      const queueStatsHandler = mockWsOn.mock.calls.find(
        c => c[0] === 'queueStats'
      )?.[1];

      act(() => {
        queueStatsHandler({
          projectId: 'proj-other',
          total: 99,
          queued: 99,
          processing: 0,
          completed: 0,
          failed: 0,
        });
      });

      // Stats for a different project should be ignored
      expect(result.current.queueStats).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('removes event listeners on unmount', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('tok-abc');

      const { unmount } = renderHook(
        () =>
          useUnifiedSegmentationUpdate({
            projectId: 'proj-cleanup',
            enabled: true,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(mockWsOn).toHaveBeenCalled();
      });

      unmount();

      await waitFor(() => {
        expect(mockWsOff).toHaveBeenCalled();
      });
    });
  });
});
