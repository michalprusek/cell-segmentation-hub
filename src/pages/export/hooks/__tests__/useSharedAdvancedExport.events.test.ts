/**
 * useSharedAdvancedExport – effect / event-driven state transitions.
 *
 * This suite drives the hook's *internal* state machine — the parts that
 * update state through the ExportContext rather than through the public
 * return value. To observe those transitions (and to seed pre-existing
 * jobs), the ExportContext is mocked with a plain Map: `updateExportState`
 * writes into it and `getExportState` reads from it. Assertions inspect the
 * Map directly instead of `result.current`, because the mocked context does
 * not trigger a React re-render on write.
 *
 * The complementary suite `useSharedAdvancedExport.test.ts` exercises the
 * public API (exportOptions, startExport/cancel/dismiss, status/history)
 * against the REAL ExportProvider and reads `result.current.*`.
 *
 * `describe` blocks group by concern: WS progress / completed / failed /
 * cancelled events, WS connection tracking, resume-on-mount restore,
 * auto-download effect, manual triggerDownload flow, cancel, dismiss,
 * persistence effect, and startExport error handling.
 *
 * Genuinely untestable in unit scope (documented, not exercised):
 *   - Polling fallback: the wsConnected=false branch starts an unbounded
 *     setInterval; every test keeps `mockSocket.connected = true` so the
 *     poll-guard stays in the "WS present" branch (fake timers here OOM the
 *     jsdom heap). A real integration test with a controlled clock and a
 *     finite poll count is the right tool.
 *   - Native <a> click navigation: jsdom doesn't navigate; we spy on
 *     createElement/appendChild/click and on the token endpoints instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── hoisted mock state (vi.mock is hoisted above imports) ────────────────────

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

// retryWithBackoff wraps the token-issue request inside triggerDownload. We
// mock it so error paths can force a failed result; a beforeEach installs a
// pass-through default that actually invokes the wrapped fn (so the happy
// path still hits the real download flow).
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
import ExportStateManager from '@/lib/exportStateManager';
import { toast } from 'sonner';
import { retryWithBackoff } from '@/lib/retryUtils';

// ── helpers ───────────────────────────────────────────────────────────────────

const PROJECT = 'events-proj';

/** Passthrough wrapper; ExportContext is mocked above. */
const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(React.Fragment, null, children);

/** Retrieve the handler the hook registered on mockSocket for an event. */
function getSocketHandler(
  event: string
): ((...args: unknown[]) => void) | undefined {
  const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls as [
    string,
    (...args: unknown[]) => void,
  ][];
  return calls.find(([ev]) => ev === event)?.[1];
}

/** Render the hook with an in-flight job already in the export-state map. */
function hookWithActiveJob(jobId = 'active-job') {
  mockExportStateMap.set(PROJECT, {
    isExporting: true,
    exportProgress: 10,
    exportStatus: 'Processing...',
    completedJobId: null,
    currentJob: { id: jobId, status: 'processing', progress: 10 },
    isDownloading: false,
  });
  return renderHook(() => useSharedAdvancedExport(PROJECT, 'My Project'), {
    wrapper,
  });
}

/** Render the hook with a completed-and-ready-to-download job in the map. */
function setCompletedJob(jobId = 'done-job') {
  mockExportStateMap.set(PROJECT, {
    isExporting: false,
    exportProgress: 100,
    exportStatus: 'Export completed!',
    completedJobId: jobId,
    currentJob: { id: jobId, status: 'completed', progress: 100 },
    isDownloading: false,
  });
}

/** Await a registered handler for `event`, then return it. */
async function waitForSocketHandler(event: string) {
  await waitFor(() =>
    expect(mockSocket.on).toHaveBeenCalledWith(event, expect.any(Function))
  );
  const handler = getSocketHandler(event);
  expect(handler).toBeDefined();
  return handler!;
}

// ── setup ─────────────────────────────────────────────────────────────────────

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
  // Default: retry passes through and invokes the wrapped download fn.
  vi.mocked(retryWithBackoff).mockImplementation(async (fn: () => unknown) => {
    await fn();
    return { success: true, data: undefined, attempts: 1 };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── WS export:progress ────────────────────────────────────────────────────────

describe('WS export:progress', () => {
  it('updates progress + status from the server message field', async () => {
    const { unmount } = hookWithActiveJob('job-p1');
    const handler = await waitForSocketHandler('export:progress');

    await act(async () => {
      handler({
        jobId: 'job-p1',
        progress: 55,
        message: 'Almost there',
        phase: 'processing' as const,
      });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportProgress).toBe(55);
    expect(state?.exportStatus).toBe('Almost there');
    unmount();
  });

  it('constructs "X of Y: item... Z%" from stageProgress when message is absent', async () => {
    const { unmount } = hookWithActiveJob('job-p2');
    const handler = await waitForSocketHandler('export:progress');

    await act(async () => {
      handler({
        jobId: 'job-p2',
        progress: 60,
        stageProgress: { current: 3, total: 10, currentItem: 'frame.png' },
      });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportProgress).toBe(60);
    expect(state?.exportStatus).toContain('3 of 10');
    expect(state?.exportStatus).toContain('frame.png');
    expect(state?.exportStatus).toContain('60%');
    unmount();
  });

  it('omits the ": item" suffix when stageProgress has no currentItem', async () => {
    const { unmount } = hookWithActiveJob('job-p2b');
    const handler = await waitForSocketHandler('export:progress');

    await act(async () => {
      handler({
        jobId: 'job-p2b',
        progress: 40,
        stageProgress: { current: 4, total: 10 }, // no currentItem
      });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).not.toContain(':');
    expect(state?.exportStatus).toContain('40%');
    unmount();
  });

  it('falls back to "Processing... Z%" when neither message nor stageProgress present', async () => {
    const { unmount } = hookWithActiveJob('job-fb');
    const handler = await waitForSocketHandler('export:progress');

    await act(async () => {
      handler({ jobId: 'job-fb', progress: 33, phase: 'processing' as const });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).toMatch(/Processing\.\.\.\s*33%/);
    unmount();
  });

  it('falls back to "Downloading... Z%" and flags isDownloading when phase=downloading', async () => {
    const { unmount } = hookWithActiveJob('job-dl');
    const handler = await waitForSocketHandler('export:progress');

    await act(async () => {
      handler({ jobId: 'job-dl', progress: 75, phase: 'downloading' as const });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).toMatch(/Downloading\.\.\.\s*75%/);
    expect(state?.isDownloading).toBe(true);
    unmount();
  });

  it('ignores progress events for a different jobId', async () => {
    const { unmount } = hookWithActiveJob('job-mine');
    const handler = await waitForSocketHandler('export:progress');
    const before = mockUpdateExportState.mock.calls.length;

    await act(async () => {
      handler({
        jobId: 'job-other',
        progress: 99,
        phase: 'processing' as const,
      });
    });

    expect(mockUpdateExportState.mock.calls.length).toBe(before);
    unmount();
  });
});

// ── WS export:completed ───────────────────────────────────────────────────────

describe('WS export:completed', () => {
  it('sets completedJobId and clears isExporting on match', async () => {
    const { unmount } = hookWithActiveJob('job-c1');
    const handler = await waitForSocketHandler('export:completed');

    await act(async () => {
      handler({ jobId: 'job-c1', warnings: [] });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.completedJobId).toBe('job-c1');
    expect(state?.isExporting).toBe(false);
    unmount();
  });

  it('fires toast.warning only for non-blank warning strings', async () => {
    const { unmount } = hookWithActiveJob('job-c2');
    const handler = await waitForSocketHandler('export:completed');

    await act(async () => {
      handler({
        jobId: 'job-c2',
        warnings: ['MT intensity skipped', '', '  ', 'Another warning'],
      });
    });

    // Blank / whitespace-only entries are skipped.
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith('MT intensity skipped', {
      duration: 12000,
    });
    expect(toast.warning).toHaveBeenCalledWith(
      'Another warning',
      expect.any(Object)
    );
    unmount();
  });

  it('does not toast when warnings is an empty array', async () => {
    const { unmount } = hookWithActiveJob('job-nowarns');
    const handler = await waitForSocketHandler('export:completed');

    await act(async () => {
      handler({ jobId: 'job-nowarns', warnings: [] });
    });

    expect(toast.warning).not.toHaveBeenCalled();
    unmount();
  });

  it('does not toast when warnings is undefined', async () => {
    const { unmount } = hookWithActiveJob('job-no-w-field');
    const handler = await waitForSocketHandler('export:completed');

    await act(async () => {
      handler({ jobId: 'job-no-w-field' });
    });

    expect(toast.warning).not.toHaveBeenCalled();
    unmount();
  });

  it('ignores completed events for a different jobId', async () => {
    const { unmount } = hookWithActiveJob('job-c3');
    const handler = await waitForSocketHandler('export:completed');
    const before = mockUpdateExportState.mock.calls.length;

    await act(async () => {
      handler({ jobId: 'job-wrong', warnings: [] });
    });

    expect(mockUpdateExportState.mock.calls.length).toBe(before);
    unmount();
  });
});

// ── WS export:failed ──────────────────────────────────────────────────────────

describe('WS export:failed', () => {
  it('clears isExporting, sets the error status, and clears persisted state', async () => {
    const { unmount } = hookWithActiveJob('job-f1');
    const handler = await waitForSocketHandler('export:failed');

    await act(async () => {
      handler({ jobId: 'job-f1', error: 'Disk full' });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isExporting).toBe(false);
    expect(state?.exportStatus as string).toContain('Disk full');
    expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
    unmount();
  });

  it('is a no-op for a different jobId', async () => {
    const { unmount } = hookWithActiveJob('job-f2');
    const handler = await waitForSocketHandler('export:failed');

    await act(async () => {
      handler({ jobId: 'other-job', error: 'irrelevant' });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isExporting).toBe(true); // unchanged
    unmount();
  });
});

// ── WS export:cancelled ───────────────────────────────────────────────────────

describe('WS export:cancelled', () => {
  it('clears currentJob, resets isCancelling/isExporting, and clears persisted state', async () => {
    const { unmount } = hookWithActiveJob('job-can1');
    const handler = await waitForSocketHandler('export:cancelled');

    await act(async () => {
      handler({ jobId: 'job-can1', message: 'Cancelled by user' });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.currentJob).toBeNull();
    expect(state?.isCancelling).toBe(false);
    expect(state?.isExporting).toBe(false);
    expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
    unmount();
  });

  it('uses the default "Export cancelled" message when none is provided', async () => {
    const { unmount } = hookWithActiveJob('job-can2');
    const handler = await waitForSocketHandler('export:cancelled');

    await act(async () => {
      handler({ jobId: 'job-can2' });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).toBe('Export cancelled');
    unmount();
  });
});

// ── WS connection tracking ────────────────────────────────────────────────────

describe('WS connect/disconnect tracking', () => {
  it('registers connect/disconnect listeners on mount and removes them on unmount', async () => {
    mockSocket.connected = true;
    const { unmount } = renderHook(() => useSharedAdvancedExport(PROJECT), {
      wrapper,
    });

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function)
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'disconnect',
        expect.any(Function)
      );
    });

    // Simulate disconnect then reconnect — handlers must not throw.
    await act(async () => {
      getSocketHandler('disconnect')?.();
    });
    await act(async () => {
      getSocketHandler('connect')?.();
    });

    expect(mockSocket.off).not.toHaveBeenCalled(); // cleanup not yet fired
    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith(
      'connect',
      expect.any(Function)
    );
    expect(mockSocket.off).toHaveBeenCalledWith(
      'disconnect',
      expect.any(Function)
    );
  });
});

// ── resume-on-mount restore (checkResumedExportStatus + persisted state) ──────

describe('resume on mount', () => {
  it('completed status with warnings → surfaces toast.warning', async () => {
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

  it('failed status → clears ExportStateManager and resets isExporting', async () => {
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'fail-resume-job',
      status: 'exporting',
      progress: 30,
      startedAt: Date.now(),
    } as any);
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { status: 'failed', message: 'Out of disk space', progress: 30 },
    });

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
    });
    expect(mockExportStateMap.get(PROJECT)?.isExporting).toBe(false);
  });

  it('still-processing status → updates progress', async () => {
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'progress-job',
      status: 'processing',
      progress: 20,
      startedAt: Date.now(),
    } as any);
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { status: 'processing', progress: 65 },
    });

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      expect(mockExportStateMap.get(PROJECT)?.exportProgress).toBe(65);
    });
  });

  it('network error while resuming → resets isExporting', async () => {
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
      expect(mockExportStateMap.get(PROJECT)?.isExporting).toBe(false);
    });
  });

  it('stale "downloading" state → cleared and presented as completed-ready-to-download', async () => {
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
    expect(state?.isDownloading).toBe(false);
    expect(state?.completedJobId).toBe('dl-stale-job');
  });

  it('completed status already downloaded → clears state immediately', async () => {
    vi.mocked(ExportStateManager.getExportState).mockReturnValue({
      projectId: PROJECT,
      jobId: 'done-job',
      status: 'completed',
      progress: 100,
      startedAt: Date.now(),
    } as any);
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === `exportDownloaded_${PROJECT}`
        ? JSON.stringify(['done-job'])
        : null
    );

    renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });

    await waitFor(() => {
      expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
    });
  });
});

// ── auto-download effect ──────────────────────────────────────────────────────

describe('auto-download effect', () => {
  it('does NOT request a token when the job is already in the downloaded set', async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === `exportDownloaded_${PROJECT}`
        ? JSON.stringify(['already-done-job'])
        : null
    );
    setCompletedJob('already-done-job');

    const { unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'My Project'),
      { wrapper }
    );

    // Wait past the effect's 1000 ms delay to confirm it stays blocked.
    await new Promise(r => setTimeout(r, 1200));
    expect(apiClient.getExportDownloadToken).not.toHaveBeenCalled();
    unmount();
  });

  it('does NOT request a token when completedJobId is null', async () => {
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      exportProgress: 0,
      exportStatus: '',
      completedJobId: null,
      currentJob: null,
      isDownloading: false,
    });

    const { unmount } = renderHook(() => useSharedAdvancedExport(PROJECT), {
      wrapper,
    });
    await new Promise(r => setTimeout(r, 1200));
    expect(apiClient.getExportDownloadToken).not.toHaveBeenCalled();
    unmount();
  });

  it('resets isDownloading to false when the token fetch fails', async () => {
    vi.mocked(apiClient.getExportDownloadToken).mockRejectedValue(
      new Error('Token error')
    );
    setCompletedJob('fail-dl-job');

    const { unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'My Project'),
      { wrapper }
    );

    await waitFor(
      () => {
        expect(mockExportStateMap.get(PROJECT)?.isDownloading).toBe(false);
      },
      { timeout: 3000 }
    );
    unmount();
  }, 5000);
});

// ── manual triggerDownload ────────────────────────────────────────────────────

describe('triggerDownload', () => {
  it('early-returns without hitting the API when there is no completedJobId', async () => {
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

  it('dispatches a native download via the token endpoint (sanitized filename)', async () => {
    const appendSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(node => node);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    vi.mocked(apiClient.getExportDownloadToken).mockResolvedValue({
      token: 'manual-tok',
    });
    vi.mocked(apiClient.buildExportDownloadUrl).mockReturnValue(
      'http://dl-url/manual.zip'
    );
    setCompletedJob('manual-job');

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Test Project'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    await waitFor(() => {
      expect(apiClient.getExportDownloadToken).toHaveBeenCalledWith(
        PROJECT,
        'manual-job'
      );
    });
    // sanitizeFilename('Test Project') → 'Test_Project'
    expect(apiClient.buildExportDownloadUrl).toHaveBeenCalledWith(
      PROJECT,
      'manual-job',
      'manual-tok',
      'Test_Project.zip'
    );

    appendSpy.mockRestore();
    clickSpy.mockRestore();
    unmount();
  });

  it('returns early (no retry, no token) when isDownloading is already true', async () => {
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      exportProgress: 100,
      exportStatus: 'Export completed!',
      completedJobId: 'dl-guard-job',
      currentJob: { id: 'dl-guard-job', status: 'completed', progress: 100 },
      isDownloading: true, // guard
    });

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Guard Project'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    expect(retryWithBackoff).not.toHaveBeenCalled();
    expect(apiClient.getExportDownloadToken).not.toHaveBeenCalled();
    unmount();
  });

  it('resets isDownloading and sets a failure status when retry returns success=false', async () => {
    vi.mocked(retryWithBackoff).mockResolvedValue({
      success: false,
      error: new Error('Disk full on server'),
      attempts: 3,
    });
    vi.mocked(apiClient.getExportDownloadToken).mockResolvedValue({
      token: 'tok',
    });
    setCompletedJob('err-job-1');

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Error Project'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    await waitFor(() => {
      expect(mockExportStateMap.get(PROJECT)?.isDownloading).toBe(false);
    });
    expect(mockExportStateMap.get(PROJECT)?.exportStatus).toContain('Failed');
    unmount();
  });

  it('resets isDownloading and sets a failure status when the download throws', async () => {
    vi.mocked(retryWithBackoff).mockRejectedValue(new Error('Network error'));
    setCompletedJob('err-job-2');

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Error Project 2'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    await waitFor(() => {
      expect(mockExportStateMap.get(PROJECT)?.isDownloading).toBe(false);
    });
    expect(mockExportStateMap.get(PROJECT)?.exportStatus).toContain('Failed');
    unmount();
  });

  it('removes an already-downloaded job from the set and retries the download', async () => {
    const jobId = 'retry-download-job';
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === `exportDownloaded_${PROJECT}` ? JSON.stringify([jobId]) : null
    );
    vi.mocked(retryWithBackoff).mockResolvedValue({
      success: true,
      data: undefined,
      attempts: 1,
    });
    setCompletedJob(jobId);

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Retry Project'),
      { wrapper }
    );

    await act(async () => {
      await result.current.triggerDownload();
    });

    await waitFor(() => {
      expect(retryWithBackoff).toHaveBeenCalled();
    });
    expect(mockExportStateMap.get(PROJECT)?.isDownloading).toBe(false);
    unmount();
  });
});

// ── cancelExport ──────────────────────────────────────────────────────────────

describe('cancelExport', () => {
  it('emits export:cancel on the connected socket', async () => {
    mockExportStateMap.set(PROJECT, {
      isExporting: true,
      currentJob: { id: 'jc-1', status: 'processing', progress: 50 },
      completedJobId: null,
    });
    vi.mocked(apiClient.post).mockResolvedValue({} as any);

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Proj'),
      { wrapper }
    );

    await act(async () => {
      await result.current.cancelExport();
    });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'export:cancel',
      expect.objectContaining({ jobId: 'jc-1', projectId: PROJECT })
    );
    unmount();
  });

  it('resets isCancelling and sets a failure status when the cancel request throws', async () => {
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

// ── dismissExport ─────────────────────────────────────────────────────────────

describe('dismissExport', () => {
  it('adds completedJobId to the downloaded set before clearing (no auto re-download)', () => {
    setCompletedJob('dismiss-job');

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );

    act(() => {
      result.current.dismissExport();
    });

    const calls = (localStorage.setItem as ReturnType<typeof vi.fn>).mock
      .calls as [string, string][];
    const exportCall = calls.find(
      ([key]) => key === `exportDownloaded_${PROJECT}`
    );
    expect(exportCall).toBeDefined();
    expect(JSON.parse(exportCall![1]) as string[]).toContain('dismiss-job');
    unmount();
  });

  it('does not write to localStorage when completedJobId is null', async () => {
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      currentJob: null,
      completedJobId: null,
    });

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Proj'),
      { wrapper }
    );

    act(() => {
      result.current.dismissExport();
    });

    expect(localStorage.setItem).not.toHaveBeenCalled();
    unmount();
  });
});

// ── state persistence effect ──────────────────────────────────────────────────

describe('state persistence effect', () => {
  it('throttle-saves while exporting with an active job', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { jobId: 'persist-job' },
    });

    const { result, unmount } = renderHook(
      () => useSharedAdvancedExport(PROJECT),
      { wrapper }
    );

    await act(async () => {
      await result.current.startExport('Persist Test');
    });

    await waitFor(() => {
      expect(ExportStateManager.saveExportStateThrottled).toHaveBeenCalled();
    });
    unmount();
  });

  it('clears persisted state when neither exporting nor downloading', () => {
    const { unmount } = renderHook(() => useSharedAdvancedExport(PROJECT), {
      wrapper,
    });
    expect(ExportStateManager.clearExportState).toHaveBeenCalled();
    unmount();
  });
});

// ── startExport error status ──────────────────────────────────────────────────

describe('startExport error status', () => {
  it('resets isExporting, sets a "Failed" status, and rethrows when the POST fails', async () => {
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
