import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { UploadProvider } from '@/contexts/UploadContext';
import { useUpload } from '@/contexts/useUpload';
import apiClient from '@/lib/api';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    uploadImages: vi.fn(),
    uploadImagesChunked: vi.fn(),
  },
  apiClient: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    uploadImages: vi.fn(),
    uploadImagesChunked: vi.fn(),
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

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock sonner toast to avoid DOM side-effects in tests
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock useWebSocket — UploadProvider accesses socket for progress events and
// for emitting cancel events, but these are side-effects not exercised in unit
// tests. Provide a null socket so no real socket code runs.
vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: vi.fn(() => ({ socket: null, isConnected: false, manager: null })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFile = (name: string): File =>
  new File(['content'], name, { type: 'image/png' });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UploadContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <UploadProvider>{children}</UploadProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Error boundaries
  // -------------------------------------------------------------------------

  describe('error boundaries', () => {
    it('throws when useUpload is used outside UploadProvider', () => {
      expect(() => {
        renderHook(() => useUpload());
      }).toThrow('useUpload must be used within an UploadProvider');
    });
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('starts with empty sessions, no active session, and isUploading=false', () => {
      const { result } = renderHook(() => useUpload(), { wrapper });

      expect(result.current.sessions).toEqual({});
      expect(result.current.activeSession).toBeNull();
      expect(result.current.isUploading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // startUpload
  // -------------------------------------------------------------------------

  describe('startUpload', () => {
    it('creates a new session and returns a sessionId', async () => {
      vi.mocked(apiClient.uploadImages).mockResolvedValueOnce([
        { id: '1', filename: 'a.png' },
      ] as any);

      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload('project-1', [makeFile('a.png')]);
      });

      expect(sessionId).toMatch(/^upload_/);
      expect(result.current.sessions[sessionId]).toBeDefined();
      expect(result.current.sessions[sessionId].projectId).toBe('project-1');
      expect(result.current.sessions[sessionId].status).toBe('uploading');
      expect(result.current.isUploading).toBe(true);
    });

    it('marks the session as completed after a successful upload', async () => {
      vi.mocked(apiClient.uploadImages).mockResolvedValueOnce([
        { id: '1', filename: 'img.png' },
        { id: '2', filename: 'img2.png' },
      ] as any);

      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload('project-success', [
          makeFile('img.png'),
          makeFile('img2.png'),
        ]);
      });

      await waitFor(() => {
        expect(result.current.sessions[sessionId]?.status).toBe('completed');
      });

      expect(result.current.sessions[sessionId].successCount).toBe(2);
      expect(result.current.sessions[sessionId].overallProgress).toBe(100);
    });

    it('stores projectId and projectName on the created session', async () => {
      // Keep upload pending so we can inspect the session while it is active
      let resolveUpload!: (value: any) => void;
      vi.mocked(apiClient.uploadImages).mockReturnValueOnce(
        new Promise(resolve => {
          resolveUpload = resolve;
        })
      );

      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload(
          'project-named',
          [makeFile('a.png'), makeFile('b.png')],
          'My Named Project'
        );
      });

      await waitFor(() => {
        expect(result.current.sessions[sessionId]).toBeDefined();
      });

      const session = result.current.sessions[sessionId];
      expect(session.projectId).toBe('project-named');
      expect(session.projectName).toBe('My Named Project');
      expect(session.totalFiles).toBe(2);
      expect(session.startedAt).toBeGreaterThan(0);

      // Clean up
      resolveUpload([]);
    });

    it('fires the onComplete callback after a successful upload', async () => {
      vi.mocked(apiClient.uploadImages).mockResolvedValueOnce([
        { id: '1', filename: 'cb.png' },
      ] as any);

      const onComplete = vi.fn();
      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload(
          'project-cb',
          [makeFile('cb.png')],
          'My Project',
          onComplete
        );
      });

      await waitFor(() => {
        expect(result.current.sessions[sessionId]?.status).toBe('completed');
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // cancelUpload
  // -------------------------------------------------------------------------

  describe('cancelUpload', () => {
    it('aborts the active upload and sets status to cancelled', async () => {
      // Never-resolving promise simulates an in-flight upload
      vi.mocked(apiClient.uploadImages).mockImplementationOnce(
        (_projectId, _files, _onProgress) =>
          new Promise((_resolve, reject) => {
            // The AbortController abort() will cause the promise to reject
            // with an AbortError when the signal fires. We simulate that here
            // by detecting that the test calls cancelUpload.
            setTimeout(() => {
              const err = new Error('Upload cancelled');
              err.name = 'AbortError';
              reject(err);
            }, 50);
          })
      );

      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload('project-cancel', [
          makeFile('big.png'),
        ]);
      });

      expect(result.current.sessions[sessionId].status).toBe('uploading');

      act(() => {
        result.current.cancelUpload(sessionId);
      });

      await waitFor(() => {
        expect(result.current.sessions[sessionId]?.status).toBe('cancelled');
      });
    });
  });

  // -------------------------------------------------------------------------
  // clearSession
  // -------------------------------------------------------------------------

  describe('clearSession', () => {
    it('removes the session from the sessions map', async () => {
      vi.mocked(apiClient.uploadImages).mockResolvedValueOnce([
        { id: '1', filename: 'del.png' },
      ] as any);

      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload('project-del', [
          makeFile('del.png'),
        ]);
      });

      await waitFor(() => {
        expect(result.current.sessions[sessionId]?.status).toBe('completed');
      });

      act(() => {
        result.current.clearSession(sessionId);
      });

      expect(result.current.sessions[sessionId]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('sets status to "failed" on a network error', async () => {
      vi.mocked(apiClient.uploadImages).mockRejectedValueOnce(
        new Error('Network failure')
      );

      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload('project-err', [
          makeFile('err.png'),
        ]);
      });

      await waitFor(() => {
        expect(result.current.sessions[sessionId]?.status).toBe('failed');
      });

      expect(result.current.sessions[sessionId].error).toBe('Network failure');
      expect(result.current.sessions[sessionId].currentOperation).toBe(
        'Upload failed'
      );
    });

    it('sets status to "cancelled" when upload is aborted with ERR_CANCELED code', async () => {
      const cancelErr = new Error('Request cancelled');
      (cancelErr as any).code = 'ERR_CANCELED';

      vi.mocked(apiClient.uploadImages).mockRejectedValueOnce(cancelErr);

      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload('project-axcancel', [
          makeFile('axcancel.png'),
        ]);
      });

      await waitFor(() => {
        expect(result.current.sessions[sessionId]?.status).toBe('cancelled');
      });
    });
  });

  // -------------------------------------------------------------------------
  // isUploading derived state
  // -------------------------------------------------------------------------

  describe('isUploading derived state', () => {
    it('is true while an upload session is active and false once completed', async () => {
      vi.mocked(apiClient.uploadImages).mockResolvedValueOnce([
        { id: '1', filename: 'derive.png' },
      ] as any);

      const { result } = renderHook(() => useUpload(), { wrapper });

      let sessionId!: string;
      act(() => {
        sessionId = result.current.startUpload('project-derive', [
          makeFile('derive.png'),
        ]);
      });

      // Immediately after startUpload the session is 'uploading'
      expect(result.current.isUploading).toBe(true);
      expect(result.current.activeSession).not.toBeNull();
      expect(result.current.activeSession!.id).toBe(sessionId);

      await waitFor(() => {
        expect(result.current.sessions[sessionId]?.status).toBe('completed');
      });

      // Once completed, isUploading must be false
      expect(result.current.isUploading).toBe(false);
      expect(result.current.activeSession).toBeNull();
    });
  });
});
