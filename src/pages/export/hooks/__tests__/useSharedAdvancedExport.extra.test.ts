/**
 * useSharedAdvancedExport.extra.test.ts
 *
 * Targets branches NOT covered by the two existing test files:
 *
 *  1. updateExportOptions merges partial updates (various option combinations).
 *  2. startExport error path (API throws → isExporting resets to false + rethrows).
 *  3. checkResumedExportStatus invoked from the init-restore effect:
 *       a. 'completed' status with warnings toast
 *       b. 'failed' / 'cancelled' status clears ExportStateManager
 *       c. still-processing status updates progress
 *       d. network error path resets isExporting + clears state
 *  4. Persisted 'downloading' state on restore → treated as completed + cleared.
 *  5. Persisted 'completed' state that was already downloaded → cleared immediately.
 *  6. getExportHistory happy path (non-error).
 *  7. triggerDownload blocked when isDownloading=true.
 *  8. cancelExport: no-op when currentJob is null.
 *  9. cancelExport: HTTP error path → sets isCancelling=false.
 * 10. dismissExport with null completedJobId (no localStorage write).
 *
 * Genuinely untestable here (noted in the gaps test):
 *   - Native link click (jsdom doesn't navigate).
 *   - Polling setInterval (OOM in jsdom, documented in gaps test).
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

// ── imports ───────────────────────────────────────────────────────────────────

import { useSharedAdvancedExport } from '../useSharedAdvancedExport';
import apiClient from '@/lib/api';
import ExportStateManager from '@/lib/exportStateManager';
import { toast } from 'sonner';

// ── helpers ───────────────────────────────────────────────────────────────────

const PROJECT = 'extra-proj-99';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(React.Fragment, null, children);

beforeEach(() => {
  vi.clearAllMocks();
  mockExportStateMap.clear();
  (mockSocket.on as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  (mockSocket.off as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  (mockSocket.emit as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  mockSocket.connected = true;
  vi.mocked(localStorage.getItem).mockReturnValue(null);
  vi.mocked(localStorage.setItem).mockImplementation(() => {});
  vi.mocked(localStorage.removeItem).mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. updateExportOptions ────────────────────────────────────────────────────

describe('updateExportOptions', () => {
  it('merges includeOriginalImages + includeVisualizations overrides', async () => {
    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );
    await waitFor(() => expect(result.current.exportOptions).toBeDefined());

    act(() => {
      result.current.updateExportOptions({
        includeOriginalImages: false,
        includeVisualizations: false,
      });
    });

    expect(result.current.exportOptions.includeOriginalImages).toBe(false);
    expect(result.current.exportOptions.includeVisualizations).toBe(false);
    // Other options are unchanged
    expect(result.current.exportOptions.annotationFormats).toBeDefined();
    unmount();
  });

  it('merges mtMetrics option', async () => {
    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );
    await waitFor(() => expect(result.current.exportOptions).toBeDefined());

    act(() => {
      result.current.updateExportOptions({
        mtMetrics: {
          enabled: true,
          thicknessPx: 3,
          marginMultiplier: 2,
          channels: ['TIRF_640'],
        },
      });
    });

    expect(result.current.exportOptions.mtMetrics?.enabled).toBe(true);
    expect(result.current.exportOptions.mtMetrics?.channels).toEqual([
      'TIRF_640',
    ]);
    unmount();
  });

  it('merges selectedImageIds and pixelToMicrometerScale', async () => {
    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );
    await waitFor(() => expect(result.current.exportOptions).toBeDefined());

    act(() => {
      result.current.updateExportOptions({
        selectedImageIds: ['img-1', 'img-2'],
        pixelToMicrometerScale: 0.5,
      });
    });

    expect(result.current.exportOptions.selectedImageIds).toEqual([
      'img-1',
      'img-2',
    ]);
    expect(result.current.exportOptions.pixelToMicrometerScale).toBe(0.5);
    unmount();
  });

  it('merges annotationFormats + metricsFormats overrides', async () => {
    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );
    await waitFor(() => expect(result.current.exportOptions).toBeDefined());

    act(() => {
      result.current.updateExportOptions({
        annotationFormats: ['yolo'],
        metricsFormats: ['csv'],
      });
    });

    expect(result.current.exportOptions.annotationFormats).toEqual(['yolo']);
    expect(result.current.exportOptions.metricsFormats).toEqual(['csv']);
    unmount();
  });
});

// ── 2. startExport error path ─────────────────────────────────────────────────

describe('startExport error path', () => {
  it('resets isExporting to false and rethrows when API throws', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Server error'));

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );

    await expect(
      act(async () => {
        await result.current.startExport('My Project');
      })
    ).rejects.toThrow('Server error');

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isExporting).toBe(false);
    expect(state?.exportStatus).toContain('Failed');
    unmount();
  });
});

// ── 3. checkResumedExportStatus via init-restore effect ──────────────────────

describe('checkResumedExportStatus – init restore', () => {
  it('handles completed status with warnings → fires toast.warning', async () => {
    // Simulate persisted 'exporting' state so initEffect calls checkResumedExportStatus
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'resume-job',
      status: 'exporting',
      progress: 50,
      startedAt: Date.now(),
    } as any);

    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        status: 'completed',
        progress: 100,
        warnings: ['MT intensity skipped on resume'],
      },
    });

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        'MT intensity skipped on resume',
        { duration: 12000 }
      );
    });
  });

  it('handles failed status → clears ExportStateManager', async () => {
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'fail-resume-job',
      status: 'exporting',
      progress: 30,
      startedAt: Date.now(),
    } as any);

    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        status: 'failed',
        message: 'Out of disk space',
        progress: 30,
      },
    });

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isExporting).toBe(false);
  });

  it('handles still-processing status → updates progress', async () => {
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'progress-job',
      status: 'processing',
      progress: 20,
      startedAt: Date.now(),
    } as any);

    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        status: 'processing',
        progress: 65,
      },
    });

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      const state = mockExportStateMap.get(PROJECT);
      expect(state?.exportProgress).toBe(65);
    });
  });

  it('handles network error in checkResumedExportStatus → resets isExporting', async () => {
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'error-resume-job',
      status: 'exporting',
      progress: 10,
      startedAt: Date.now(),
    } as any);

    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Network down'));

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      const state = mockExportStateMap.get(PROJECT);
      expect(state?.isExporting).toBe(false);
    });
  });
});

// ── 4. Persisted 'downloading' state treated as completed + cleared ───────────

describe('init restore – persisted downloading state', () => {
  it('clears stale downloading state and presents as completed-ready-to-download', async () => {
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'dl-stale-job',
      status: 'downloading',
      progress: 100,
      startedAt: Date.now(),
    } as any);

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
    });

    const state = mockExportStateMap.get(PROJECT);
    // Stale downloading → treated as completedJobId present, isDownloading=false
    expect(state?.isDownloading).toBe(false);
    expect(state?.completedJobId).toBe('dl-stale-job');
  });
});

// ── 5. Persisted 'completed' already downloaded → cleared immediately ─────────

describe('init restore – completed already downloaded', () => {
  it('clears state when the job was already downloaded', async () => {
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'done-job',
      status: 'completed',
      progress: 100,
      startedAt: Date.now(),
    } as any);

    // Mark as already downloaded in localStorage
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
      if (key === `exportDownloaded_${PROJECT}`) {
        return JSON.stringify(['done-job']);
      }
      return null;
    });

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
    });
  });
});

// ── 6. getExportHistory happy path ────────────────────────────────────────────

describe('getExportHistory happy path', () => {
  it('returns history array from API response', async () => {
    const historyData = [
      { jobId: 'j1', status: 'completed', createdAt: '2026-01-01' },
    ];
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: historyData });

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );

    let hist: unknown;
    await act(async () => {
      hist = await result.current.getExportHistory();
    });

    expect(hist).toEqual(historyData);
    unmount();
  });
});

// ── 7. triggerDownload blocked when isDownloading=true ────────────────────────

describe('triggerDownload – blocked when isDownloading', () => {
  it('returns early without calling getExportDownloadToken when isDownloading', async () => {
    // Set state so isDownloading=true and completedJobId is present
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      exportProgress: 100,
      exportStatus: '',
      completedJobId: 'blocked-job',
      currentJob: { id: 'blocked-job', status: 'completed', progress: 100 },
      isDownloading: true,
    });

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    expect(apiClient.getExportDownloadToken).not.toHaveBeenCalled();
    unmount();
  });
});

// ── 8. cancelExport: no-op when currentJob is null ───────────────────────────

describe('cancelExport – no currentJob', () => {
  it('does not call API when currentJob is null', async () => {
    // No currentJob in state
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      exportProgress: 0,
      exportStatus: '',
      completedJobId: null,
      currentJob: null,
      isDownloading: false,
    });

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );

    await act(async () => {
      await result.current.cancelExport();
    });

    expect(apiClient.post).not.toHaveBeenCalled();
    unmount();
  });
});

// ── 9. cancelExport: HTTP error path ─────────────────────────────────────────

describe('cancelExport – API error', () => {
  it('sets isCancelling=false on failure', async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: { jobId: 'cancel-err-job' } }) // startExport
      .mockRejectedValueOnce(new Error('Cancel failed')); // cancelExport

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );

    await act(async () => {
      await result.current.startExport('Test');
    });

    await act(async () => {
      await result.current.cancelExport();
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isCancelling).toBe(false);
    expect(state?.exportStatus).toContain('Failed to cancel');
    unmount();
  });
});

// ── 10. dismissExport with null completedJobId ────────────────────────────────

describe('dismissExport – null completedJobId', () => {
  it('does not write to localStorage when completedJobId is null', async () => {
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      exportProgress: 0,
      exportStatus: '',
      completedJobId: null,
      currentJob: null,
      isDownloading: false,
    });

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );

    act(() => {
      result.current.dismissExport();
    });

    // No exportDownloaded_{PROJECT} key should have been written
    const setItemCalls = (localStorage.setItem as ReturnType<typeof vi.fn>).mock
      .calls as [string, string][];
    const exportCall = setItemCalls.find(
      ([k]) => k === `exportDownloaded_${PROJECT}`
    );
    expect(exportCall).toBeUndefined();

    unmount();
  });
});
