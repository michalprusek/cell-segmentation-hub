/**
 * useSharedAdvancedExport – triggerDownload error paths (lines 902-938)
 *
 * Remaining uncovered branches:
 *  1. triggerDownload: downloadResult.success=false throws → catch block runs
 *     → isDownloading resets to false, exportStatus set to failure message.
 *  2. triggerDownload: runNativeExportDownload throws directly → catch block runs.
 *  3. triggerDownload: isDownloading=true guard → early return (no API call).
 *  4. triggerDownload: already-downloaded job → removes from set + allows retry.
 *
 * We mock retryWithBackoff at the lib level so we control its return value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── hoisted mock state ────────────────────────────────────────────────────────

const {
  mockSocket,
  mockUpdateExportState,
  mockGetExportState,
  mockExportStateMap,
} = vi.hoisted(() => {
  const map: Map<string, Record<string, unknown>> = new Map();
  const updateFn = vi.fn(
    (projectId: string, updates: Record<string, unknown>) => {
      const prev = map.get(projectId) ?? {};
      map.set(projectId, { ...prev, ...updates });
    }
  );
  const getFn = vi.fn((projectId: string) => map.get(projectId) ?? null);
  const sock = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };
  return {
    mockSocket: sock,
    mockUpdateExportState: updateFn,
    mockGetExportState: getFn,
    mockExportStateMap: map,
  };
});

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('socket.io-client', () => ({ io: vi.fn(), Socket: class {} }));

vi.mock('@/services/webSocketManager', () => ({
  default: class {
    static getInstance = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    on = vi.fn();
    off = vi.fn();
    emit = vi.fn();
  },
}));

vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: () => ({
    socket: mockSocket,
    manager: null,
    isConnected: true,
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'tid'),
    dismiss: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/exportStateManager', () => ({
  default: class {
    static getExportState = vi.fn(() => null);
    static saveExportState = vi.fn();
    static saveExportStateThrottled = vi.fn();
    static clearExportState = vi.fn();
    static deduplicateRequest = vi.fn(
      async (_: string, fn: () => Promise<unknown>) => fn()
    );
  },
}));

vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    getExportDownloadToken: vi.fn(),
    buildExportDownloadUrl: vi.fn(() => 'http://dl-url/export.zip'),
  },
}));

vi.mock('@/contexts/ExportContext', () => ({
  ExportProvider: ({ children }: { children: React.ReactNode }) => children,
  useExportContext: () => ({
    updateExportState: mockUpdateExportState,
    getExportState: mockGetExportState,
  }),
}));

// ── Mock retryWithBackoff so we control its return value ──────────────────────
// We need to mock at the lib level to intercept the retryWithBackoff call
// inside triggerDownload.

vi.mock('@/lib/retryUtils', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/retryUtils')>();
  return {
    ...original,
    retryWithBackoff: vi.fn(),
  };
});

// ── imports (after mocks) ─────────────────────────────────────────────────────

import { useSharedAdvancedExport } from '../useSharedAdvancedExport';
import apiClient from '@/lib/api';
import { retryWithBackoff } from '@/lib/retryUtils';

// ── helpers ───────────────────────────────────────────────────────────────────

const PROJECT = 'td-error-project';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(React.Fragment, null, children);

function setupWithCompletedJob(jobId = 'err-job-1') {
  mockExportStateMap.set(PROJECT, {
    isExporting: false,
    exportProgress: 100,
    exportStatus: 'Export completed!',
    completedJobId: jobId,
    currentJob: { id: jobId, status: 'completed', progress: 100 },
    isDownloading: false,
  });
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockExportStateMap.clear();
  mockSocket.connected = true;
  (mockSocket.on as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  (mockSocket.off as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  (mockSocket.emit as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  vi.mocked(localStorage.getItem).mockReturnValue(null);
  vi.mocked(localStorage.setItem).mockImplementation(() => {});
  vi.mocked(localStorage.removeItem).mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('triggerDownload – error paths', () => {
  // ── 1. retryWithBackoff returns success=false → throw → catch ─────────────

  it('resets isDownloading to false when retryWithBackoff returns success=false', async () => {
    const downloadError = new Error('Disk full on server');

    // retryWithBackoff returns a failed result (not success)
    vi.mocked(retryWithBackoff).mockResolvedValue({
      success: false,
      error: downloadError,
      attempts: 3,
    });

    // Also mock getExportDownloadToken so runNativeExportDownload doesn't fail
    // before retryWithBackoff (retryWithBackoff is now mocked at the wrapper level)
    vi.mocked(apiClient.getExportDownloadToken).mockResolvedValue({
      token: 'tok',
    });

    setupWithCompletedJob('err-job-1');

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Error Project'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    await waitFor(() => {
      const state = mockExportStateMap.get(PROJECT);
      // isDownloading should be false after the error path runs
      expect(state?.isDownloading).toBe(false);
    });

    // The failure message should be set
    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).toContain('Failed');

    unmount();
  });

  // ── 2. runNativeExportDownload throws directly → catch block ────────────────

  it('resets isDownloading and sets failure message when download throws', async () => {
    // retryWithBackoff wraps the fn — make it throw directly via promise rejection
    vi.mocked(retryWithBackoff).mockRejectedValue(new Error('Network error'));

    setupWithCompletedJob('err-job-2');

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Error Project 2'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    await waitFor(() => {
      const state = mockExportStateMap.get(PROJECT);
      expect(state?.isDownloading).toBe(false);
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).toContain('Failed');
    unmount();
  });

  // ── 3. isDownloading=true guard → early return ───────────────────────────────

  it('returns early without calling API when isDownloading=true', async () => {
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      exportProgress: 100,
      exportStatus: 'Export completed!',
      completedJobId: 'dl-guard-job',
      currentJob: { id: 'dl-guard-job', status: 'completed', progress: 100 },
      isDownloading: true, // <-- guard condition
    });

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Guard Project'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    // retryWithBackoff (and getExportDownloadToken) must NOT be called
    expect(vi.mocked(retryWithBackoff)).not.toHaveBeenCalled();
    expect(apiClient.getExportDownloadToken).not.toHaveBeenCalled();
    unmount();
  });

  // ── 4. Already-downloaded job → removes from set + allows retry ─────────────

  it('removes an already-downloaded job from the set and proceeds with download', async () => {
    const jobId = 'retry-download-job';

    // Simulate the job already being in localStorage
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
      if (key === `exportDownloaded_${PROJECT}`) {
        return JSON.stringify([jobId]);
      }
      return null;
    });

    // retryWithBackoff succeeds
    vi.mocked(retryWithBackoff).mockResolvedValue({
      success: true,
      data: undefined,
      attempts: 1,
    });

    setupWithCompletedJob(jobId);

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Retry Project'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    // The job was in the set, so it should have been removed (localStorage.setItem called)
    // to allow the retry, then retryWithBackoff called for the actual download
    await waitFor(() => {
      expect(vi.mocked(retryWithBackoff)).toHaveBeenCalled();
    });

    // After success isDownloading resets to false
    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isDownloading).toBe(false);

    unmount();
  });
});
