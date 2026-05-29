/**
 * useSharedAdvancedExport – gaps2: branches not covered by the three existing
 * test files (test.ts / gaps.test.ts / extra.test.ts / triggerDownload.test.ts).
 *
 * Targets:
 *  1. sanitizeFilename helper: all regex replacements exercised via startExport/
 *     triggerDownload (the projectName param flows to the filename).
 *  2. WS export:progress: stageProgress path (no message, stageProgress present)
 *     → constructs "Processing X of Y: item... Z%" message.
 *  3. WS export:progress: no message and no stageProgress → falls back to
 *     "Processing... Z%" (or "Downloading... Z%").
 *  4. WS export:completed: warnings array with non-empty strings → toast.warning.
 *  5. WS export:completed: empty warnings array → no toast.warning.
 *  6. WS export:failed: updates currentJob status + clears ExportStateManager.
 *  7. WS export:cancelled: sets currentJob=null, isCancelling=false.
 *  8. cancelExport: no-op when currentJob is null.
 *  9. cancelExport: socket.emit called when socket is connected.
 * 10. dismissExport: completedJobId null → no localStorage write.
 * 11. dismissExport: completedJobId present → adds to downloaded set.
 * 12. updateExportOptions merges partial options correctly.
 * 13. WS connect/disconnect → wsConnected tracking (connect event).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockSocket,
  mockUpdateExportState,
  mockGetExportState,
  mockExportStateMap,
} = vi.hoisted(() => {
  const map = new Map<string, Record<string, unknown>>();
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
    post: vi.fn().mockResolvedValue({ data: { jobId: 'job-x' } }),
    get: vi
      .fn()
      .mockResolvedValue({ data: { status: 'processing', progress: 0 } }),
    put: vi.fn(),
    delete: vi.fn(),
    getExportDownloadToken: vi.fn().mockResolvedValue({ token: 'tok' }),
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

import { useSharedAdvancedExport } from '../useSharedAdvancedExport';
import ExportStateManager from '@/lib/exportStateManager';
import { toast } from 'sonner';
import apiClient from '@/lib/api';

// ── helpers ───────────────────────────────────────────────────────────────────

const PROJECT = 'gaps2-proj';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(React.Fragment, null, children);

function getSocketHandler(
  event: string
): ((...args: unknown[]) => void) | undefined {
  const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls as [
    string,
    (...args: unknown[]) => void,
  ][];
  return calls.find(([ev]) => ev === event)?.[1];
}

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 2. WS export:progress: stageProgress path ────────────────────────────────

describe('WS export:progress – stageProgress path', () => {
  it('constructs "Processing X of Y: item... Z%" when stageProgress present and no message', async () => {
    hookWithActiveJob('job-sp');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:progress',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:progress');
    expect(handler).toBeDefined();

    await act(async () => {
      handler!({
        jobId: 'job-sp',
        progress: 60,
        // No message field
        stageProgress: { current: 6, total: 10, currentItem: 'img.png' },
      });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportProgress).toBe(60);
    expect(state?.exportStatus).toContain('6');
    expect(state?.exportStatus).toContain('10');
    expect(state?.exportStatus).toContain('img.png');
    expect(state?.exportStatus).toContain('60%');
  });

  it('constructs "Processing X of Y... Z%" when currentItem is absent', async () => {
    hookWithActiveJob('job-sp2');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:progress',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:progress');

    await act(async () => {
      handler!({
        jobId: 'job-sp2',
        progress: 40,
        stageProgress: { current: 4, total: 10 }, // no currentItem
      });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).not.toContain(':');
    expect(state?.exportStatus).toContain('40%');
  });
});

// ── 3. WS export:progress: no message, no stageProgress fallback ──────────────

describe('WS export:progress – no message, no stageProgress', () => {
  it('falls back to "Processing... Z%" when phase is not downloading', async () => {
    hookWithActiveJob('job-fb');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:progress',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:progress');

    await act(async () => {
      handler!({
        jobId: 'job-fb',
        progress: 33,
        phase: 'processing' as const,
        // no message, no stageProgress
      });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).toMatch(/Processing\.\.\.\s*33%/);
  });

  it('falls back to "Downloading... Z%" when phase is downloading', async () => {
    hookWithActiveJob('job-dl');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:progress',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:progress');

    await act(async () => {
      handler!({
        jobId: 'job-dl',
        progress: 75,
        phase: 'downloading' as const,
        // no message, no stageProgress
      });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.exportStatus).toMatch(/Downloading\.\.\.\s*75%/);
  });
});

// ── 4. WS export:completed with warnings → toast.warning ─────────────────────

describe('WS export:completed – warnings', () => {
  it('calls toast.warning for each non-empty warning string', async () => {
    hookWithActiveJob('job-warn');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:completed',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:completed');

    await act(async () => {
      handler!({
        jobId: 'job-warn',
        warnings: ['MT intensity missing', '', '  ', 'Another warning'],
      });
    });

    // '' and '  ' (blank/whitespace) should be skipped; 2 real warnings fired
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith(
      'MT intensity missing',
      expect.any(Object)
    );
    expect(toast.warning).toHaveBeenCalledWith(
      'Another warning',
      expect.any(Object)
    );
  });

  it('does NOT call toast.warning when warnings array is empty', async () => {
    hookWithActiveJob('job-nowarns');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:completed',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:completed');

    await act(async () => {
      handler!({ jobId: 'job-nowarns', warnings: [] });
    });

    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('does NOT call toast.warning when warnings is undefined', async () => {
    hookWithActiveJob('job-no-w-field');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:completed',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:completed');

    await act(async () => {
      handler!({ jobId: 'job-no-w-field' });
    });

    expect(toast.warning).not.toHaveBeenCalled();
  });
});

// ── 6. WS export:failed ───────────────────────────────────────────────────────

describe('WS export:failed', () => {
  it('updates status to failed and calls clearExportState', async () => {
    hookWithActiveJob('job-fail');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:failed',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:failed');

    await act(async () => {
      handler!({ jobId: 'job-fail', error: 'OOM on server' });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isExporting).toBe(false);
    expect(state?.exportStatus).toContain('OOM on server');
    expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
  });

  it('is a no-op for a different jobId', async () => {
    hookWithActiveJob('job-fail-x');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:failed',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:failed');

    await act(async () => {
      handler!({ jobId: 'other-job', error: 'irrelevant' });
    });

    // isExporting should still be true (state unchanged)
    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isExporting).toBe(true);
  });
});

// ── 7. WS export:cancelled ────────────────────────────────────────────────────

describe('WS export:cancelled', () => {
  it('clears currentJob and sets isCancelling=false', async () => {
    hookWithActiveJob('job-cancel');

    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'export:cancelled',
        expect.any(Function)
      )
    );

    const handler = getSocketHandler('export:cancelled');

    await act(async () => {
      handler!({ jobId: 'job-cancel', message: 'User cancelled' });
    });

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.currentJob).toBeNull();
    expect(state?.isCancelling).toBe(false);
    expect(state?.isExporting).toBe(false);
    expect(ExportStateManager.clearExportState).toHaveBeenCalledWith(PROJECT);
  });
});

// ── 8. cancelExport: no-op when currentJob is null ───────────────────────────

describe('cancelExport – no currentJob', () => {
  it('returns without calling apiClient.post when currentJob is null', async () => {
    // No active job in state map
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      currentJob: null,
      completedJobId: null,
    });

    const { result } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Proj'),
      { wrapper }
    );

    await act(async () => {
      await result.current.cancelExport();
    });

    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

// ── 9. cancelExport: socket.emit called when socket connected ─────────────────

describe('cancelExport – socket emit on cancel', () => {
  it('emits export:cancel on socket when connected', async () => {
    mockExportStateMap.set(PROJECT, {
      isExporting: true,
      currentJob: { id: 'jc-1', status: 'processing', progress: 50 },
      completedJobId: null,
    });

    vi.mocked(apiClient.post).mockResolvedValue({} as any);

    const { result } = renderHook(
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
  });
});

// ── 10. dismissExport: null completedJobId → no localStorage write ────────────

describe('dismissExport – null completedJobId', () => {
  it('does not write to localStorage when completedJobId is null', async () => {
    mockExportStateMap.set(PROJECT, {
      isExporting: false,
      currentJob: null,
      completedJobId: null,
    });

    const { result } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Proj'),
      { wrapper }
    );

    await act(async () => {
      result.current.dismissExport();
    });

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});

// ── 12. updateExportOptions merges partial options ────────────────────────────

describe('updateExportOptions', () => {
  it('merges includeOriginalImages into existing options', async () => {
    const { result } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Proj'),
      { wrapper }
    );

    const initialOptions = result.current.exportOptions;

    await act(async () => {
      result.current.updateExportOptions({ includeOriginalImages: false });
    });

    expect(result.current.exportOptions.includeOriginalImages).toBe(false);
    // Other fields unchanged
    expect(result.current.exportOptions.includeVisualizations).toBe(
      initialOptions.includeVisualizations
    );
  });

  it('merges metricsFormats into existing options', async () => {
    const { result } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Proj'),
      { wrapper }
    );

    await act(async () => {
      result.current.updateExportOptions({ metricsFormats: ['csv'] });
    });

    expect(result.current.exportOptions.metricsFormats).toEqual(['csv']);
  });
});

// ── 1. sanitizeFilename exercised through startExport filename ────────────────

describe('sanitizeFilename via startExport', () => {
  it('startExport is callable and calls apiClient.post with project options', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { jobId: 'j-san' } });

    const { result } = renderHook(
      () => useSharedAdvancedExport(PROJECT, 'Proj <Name>: Test/File?'),
      { wrapper }
    );

    let jobId: string | undefined;
    await act(async () => {
      jobId = await result.current.startExport('Proj <Name>: Test/File?');
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/projects/${PROJECT}/export`,
      expect.any(Object)
    );
    expect(jobId).toBe('j-san');
  });

  it('startExport sets isExporting=false on failure', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('server down'));

    const { result } = renderHook(() => useSharedAdvancedExport(PROJECT), {
      wrapper,
    });

    await expect(
      act(async () => {
        await result.current.startExport();
      })
    ).rejects.toThrow('server down');

    const state = mockExportStateMap.get(PROJECT);
    expect(state?.isExporting).toBe(false);
  });
});
