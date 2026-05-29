/**
 * Behavioral unit tests for useSharedAdvancedExport.
 *
 * Coverage:
 *   1. Default export-options shape matches EXPORT_DEFAULTS.
 *   2. updateExportOptions merges partial updates (formats, mtMetrics, etc.).
 *   3. startExport posts the right payload and transitions isExporting.
 *   4. cancelExport sends the cancel request.
 *   5. dismissExport clears state.
 *   6. getExportStatus / getExportHistory call the correct endpoints.
 *
 * Skipped / not tested here:
 *   - Auto-download useEffect: requires completedJobId set via WS events and
 *     real timer races.
 *   - Polling path (wsConnected=false branch): polling starts an unbounded
 *     setInterval; testing it requires careful fake-timer orchestration and
 *     doesn't add much value over the simpler WS path. The WebSocket mock is
 *     set to connected=true throughout to keep the hook's poll-guard in the
 *     "WS present" branch and avoid infinite setInterval loops.
 *   - State-restore on mount: covered in usePersistedExportState.test.ts.
 *
 * NOTE on OOM: the hook's polling useEffect fires setInterval immediately when
 * wsConnected=false and `currentJob && isExporting`. Mocking the socket as
 * connected prevents the poll from starting and keeps tests stable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// ---- mocks (must precede all imports) -------------------------------------

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
  Socket: class {},
}));

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

// Connected socket prevents the polling-interval branch from firing.
const mockSocket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};
vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: () => ({
    socket: mockSocket,
    manager: null,
    isConnected: true,
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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

// Override the global api mock from setup.ts with a leaner version that
// does not pull in the real axios chain.
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    getExportDownloadToken: vi.fn(),
    buildExportDownloadUrl: vi.fn(() => 'http://download-url'),
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ExportProvider } from '@/contexts/ExportContext';
import { useSharedAdvancedExport } from '../useSharedAdvancedExport';
import { EXPORT_DEFAULTS } from '@/lib/export-config';
import apiClient from '@/lib/api';

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(ExportProvider, null, children);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset socket mock calls
  mockSocket.on.mockReset();
  mockSocket.off.mockReset();
  mockSocket.emit.mockReset();

  vi.mocked(localStorage.getItem).mockReturnValue(null);
  vi.mocked(localStorage.setItem).mockImplementation(() => {});
  vi.mocked(localStorage.removeItem).mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const PROJECT = 'proj-test-123';

function mkHook() {
  return renderHook(() => useSharedAdvancedExport(PROJECT), { wrapper });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSharedAdvancedExport – initial exportOptions', () => {
  it('includes original images', () => {
    const { result, unmount } = mkHook();
    expect(result.current.exportOptions.includeOriginalImages).toBe(
      EXPORT_DEFAULTS.OPTIONS.INCLUDE_ORIGINAL_IMAGES
    );
    unmount();
  });

  it('includes visualizations', () => {
    const { result, unmount } = mkHook();
    expect(result.current.exportOptions.includeVisualizations).toBe(
      EXPORT_DEFAULTS.OPTIONS.INCLUDE_VISUALIZATIONS
    );
    unmount();
  });

  it('has default annotation formats', () => {
    const { result, unmount } = mkHook();
    expect(result.current.exportOptions.annotationFormats).toEqual([
      ...EXPORT_DEFAULTS.FORMATS.ANNOTATION,
    ]);
    unmount();
  });

  it('has default metrics formats', () => {
    const { result, unmount } = mkHook();
    expect(result.current.exportOptions.metricsFormats).toEqual([
      ...EXPORT_DEFAULTS.FORMATS.METRICS,
    ]);
    unmount();
  });

  it('has correct visualization sub-options', () => {
    const { result, unmount } = mkHook();
    const vo = result.current.exportOptions.visualizationOptions!;
    expect(vo.showNumbers).toBe(EXPORT_DEFAULTS.VISUALIZATION.SHOW_NUMBERS);
    expect(vo.strokeWidth).toBe(EXPORT_DEFAULTS.VISUALIZATION.STROKE_WIDTH);
    expect(vo.fontSize).toBe(EXPORT_DEFAULTS.VISUALIZATION.FONT_SIZE);
    expect(vo.transparency).toBe(EXPORT_DEFAULTS.VISUALIZATION.TRANSPARENCY);
    expect(vo.polygonColors?.external).toBe(
      EXPORT_DEFAULTS.COLORS.EXTERNAL_POLYGON
    );
    expect(vo.polygonColors?.internal).toBe(
      EXPORT_DEFAULTS.COLORS.INTERNAL_POLYGON
    );
    unmount();
  });

  it('does not include mtMetrics', () => {
    const { result, unmount } = mkHook();
    expect(result.current.exportOptions.mtMetrics).toBeUndefined();
    unmount();
  });

  it('isExporting=false, isDownloading=false, exportProgress=0', () => {
    const { result, unmount } = mkHook();
    expect(result.current.isExporting).toBe(false);
    expect(result.current.isDownloading).toBe(false);
    expect(result.current.exportProgress).toBe(0);
    expect(result.current.completedJobId).toBeNull();
    expect(result.current.currentJob).toBeNull();
    unmount();
  });
});

describe('useSharedAdvancedExport – updateExportOptions', () => {
  it('merges partial update without clobbering other fields', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({ includeOriginalImages: false });
    });
    expect(result.current.exportOptions.includeOriginalImages).toBe(false);
    expect(result.current.exportOptions.includeVisualizations).toBe(
      EXPORT_DEFAULTS.OPTIONS.INCLUDE_VISUALIZATIONS
    );
    unmount();
  });

  it('can add yolo to annotationFormats', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({
        annotationFormats: ['coco', 'yolo', 'json'],
      });
    });
    expect(result.current.exportOptions.annotationFormats).toContain('yolo');
    unmount();
  });

  it('can replace metricsFormats', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({ metricsFormats: ['excel', 'csv'] });
    });
    expect(result.current.exportOptions.metricsFormats).toEqual([
      'excel',
      'csv',
    ]);
    unmount();
  });

  it('can enable mtMetrics with channel list', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({
        mtMetrics: {
          enabled: true,
          thicknessPx: 3,
          marginMultiplier: 1.5,
          channels: ['ch0', 'ch1'],
        },
      });
    });
    expect(result.current.exportOptions.mtMetrics?.enabled).toBe(true);
    expect(result.current.exportOptions.mtMetrics?.channels).toEqual([
      'ch0',
      'ch1',
    ]);
    unmount();
  });

  it('can disable mtMetrics', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({
        mtMetrics: {
          enabled: false,
          thicknessPx: 2,
          marginMultiplier: 1,
          channels: [],
        },
      });
    });
    expect(result.current.exportOptions.mtMetrics?.enabled).toBe(false);
    unmount();
  });

  it('can set pixelToMicrometerScale', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({ pixelToMicrometerScale: 0.125 });
    });
    expect(result.current.exportOptions.pixelToMicrometerScale).toBe(0.125);
    unmount();
  });

  it('can update visualizationOptions strokeWidth', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({
        visualizationOptions: { strokeWidth: 5 },
      });
    });
    expect(result.current.exportOptions.visualizationOptions?.strokeWidth).toBe(
      5
    );
    unmount();
  });

  it('sequential updates accumulate', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({ includeOriginalImages: false });
    });
    act(() => {
      result.current.updateExportOptions({ includeDocumentation: false });
    });
    expect(result.current.exportOptions.includeOriginalImages).toBe(false);
    expect(result.current.exportOptions.includeDocumentation).toBe(false);
    unmount();
  });
});

describe('useSharedAdvancedExport – startExport', () => {
  it('POSTs to /projects/:id/export with exportOptions', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { jobId: 'j1' } });
    const { result, unmount } = mkHook();
    await act(async () => {
      await result.current.startExport('My Project');
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      `/projects/${PROJECT}/export`,
      expect.objectContaining({ projectName: 'My Project' })
    );
    unmount();
  });

  it('returns jobId', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { jobId: 'j2' } });
    const { result, unmount } = mkHook();
    let jobId: string | undefined;
    await act(async () => {
      jobId = await result.current.startExport();
    });
    expect(jobId).toBe('j2');
    unmount();
  });

  it('sends modified annotationFormats in POST body', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { jobId: 'j3' } });
    const { result, unmount } = mkHook();
    act(() => {
      result.current.updateExportOptions({ annotationFormats: ['yolo'] });
    });
    await act(async () => {
      await result.current.startExport();
    });
    const body = vi.mocked(apiClient.post).mock.calls[0][1] as {
      options: { annotationFormats: string[] };
    };
    expect(body.options.annotationFormats).toEqual(['yolo']);
    unmount();
  });

  it('sets isExporting=true after successful POST', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { jobId: 'j4' } });
    const { result, unmount } = mkHook();
    await act(async () => {
      await result.current.startExport();
    });
    expect(result.current.isExporting).toBe(true);
    unmount();
  });

  it('sets isExporting=false and throws when POST fails', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('net err'));
    const { result, unmount } = mkHook();
    await act(async () => {
      await expect(result.current.startExport()).rejects.toThrow('net err');
    });
    expect(result.current.isExporting).toBe(false);
    unmount();
  });
});

describe('useSharedAdvancedExport – cancelExport', () => {
  it('does nothing when no job is active', async () => {
    const { result, unmount } = mkHook();
    await act(async () => {
      await result.current.cancelExport();
    });
    expect(apiClient.post).not.toHaveBeenCalled();
    unmount();
  });

  it('sends cancel HTTP request when job is in flight', async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: { jobId: 'jc1' } })
      .mockResolvedValueOnce({ data: {} });
    const { result, unmount } = mkHook();
    await act(async () => {
      await result.current.startExport();
    });
    await act(async () => {
      await result.current.cancelExport();
    });
    const cancelCall = vi
      .mocked(apiClient.post)
      .mock.calls.find(c => (c[0] as string).includes('cancel'));
    expect(cancelCall).toBeDefined();
    unmount();
  });
});

describe('useSharedAdvancedExport – dismissExport', () => {
  it('clears exportStatus and completedJobId', () => {
    const { result, unmount } = mkHook();
    act(() => {
      result.current.dismissExport();
    });
    expect(result.current.exportStatus).toBe('');
    expect(result.current.completedJobId).toBeNull();
    unmount();
  });
});

describe('useSharedAdvancedExport – getExportStatus', () => {
  it('GETs the status endpoint and returns data', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { status: 'processing', progress: 42 },
    });
    const { result, unmount } = mkHook();
    let data: unknown;
    await act(async () => {
      data = await result.current.getExportStatus('j-status');
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      `/projects/${PROJECT}/export/j-status/status`
    );
    expect(data).toEqual({ status: 'processing', progress: 42 });
    unmount();
  });

  it('returns null on network failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('fail'));
    const { result, unmount } = mkHook();
    let data: unknown = 'sentinel';
    await act(async () => {
      data = await result.current.getExportStatus('j-fail');
    });
    expect(data).toBeNull();
    unmount();
  });
});

describe('useSharedAdvancedExport – getExportHistory', () => {
  it('GETs the history endpoint and returns data', async () => {
    const hist = [{ jobId: 'h1', status: 'completed' }];
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: hist });
    const { result, unmount } = mkHook();
    let history: unknown;
    await act(async () => {
      history = await result.current.getExportHistory();
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      `/projects/${PROJECT}/export/history`
    );
    expect(history).toEqual(hist);
    unmount();
  });

  it('returns [] on network failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('fail'));
    const { result, unmount } = mkHook();
    let history: unknown;
    await act(async () => {
      history = await result.current.getExportHistory();
    });
    expect(history).toEqual([]);
    unmount();
  });
});
