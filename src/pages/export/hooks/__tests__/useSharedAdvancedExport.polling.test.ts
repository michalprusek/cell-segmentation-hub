/**
 * Regression tests for the export-status polling loop.
 *
 * Export jobs live only in the backend's in-memory Map, so a backend restart
 * makes a running job vanish and every later `GET .../status` returns 404. On
 * 2026-08-20 a 300-frame microtubule export OOM-crashed the backend; the poll
 * swallowed the resulting 404s and the UI sat at "Processing…" for over twenty
 * minutes, because the catch block only logged:
 *
 *     } catch (error) {
 *       logger.error('Failed to poll export status', error);
 *       // Continue polling unless we get consecutive errors
 *     }
 *
 * — a comment describing a counter that did not exist. These tests pin the
 * counter that now does, in both directions: a lost job must end the export,
 * and a transient error must not.
 *
 * Unlike the sibling suite, the socket here is mocked DISCONNECTED on purpose:
 * that is what puts the hook into the `startPolling()` branch this file is
 * about. The interval is driven with fake timers and every render is unmounted,
 * so it cannot outlive its test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

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

// Disconnected socket => wsConnected=false => the hook polls immediately.
const mockSocket = {
  connected: false,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};
vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: () => ({
    socket: mockSocket,
    manager: null,
    isConnected: false,
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

// `vi.mock` factories are hoisted above every top-level binding, so the spy
// has to be created by `vi.hoisted` to exist by the time the factory runs.
const { clearExportState } = vi.hoisted(() => ({
  clearExportState: vi.fn(),
}));
vi.mock('@/lib/exportStateManager', () => ({
  default: class {
    static getExportState = vi.fn(() => null);
    static saveExportState = vi.fn();
    static saveExportStateThrottled = vi.fn();
    static clearExportState = clearExportState;
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
    buildExportDownloadUrl: vi.fn(() => 'http://download-url'),
  },
}));

// ---- imports after mocks --------------------------------------------------

import { ExportProvider } from '@/contexts/ExportContext';
import { useSharedAdvancedExport } from '../useSharedAdvancedExport';
import apiClient from '@/lib/api';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(ExportProvider, null, children);

const PROJECT = 'proj-poll-404';
const POLL_MS = 2000;

/** An axios-shaped rejection carrying an HTTP status. */
const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

/** A full AxiosResponse, so the mocks type-check against the real client. */
const axiosOk = (data: unknown): AxiosResponse<unknown> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: { headers: {} } as InternalAxiosRequestConfig,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(localStorage.getItem).mockReturnValue(null);
  vi.mocked(localStorage.setItem).mockImplementation(() => {});
  vi.mocked(localStorage.removeItem).mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

/** Start an export so the hook has a job to poll for. */
async function startExporting() {
  vi.mocked(apiClient.post).mockResolvedValueOnce(
    axiosOk({ jobId: 'job-lost' })
  );
  const rendered = renderHook(() => useSharedAdvancedExport(PROJECT), {
    wrapper,
  });
  await act(async () => {
    await rendered.result.current.startExport();
  });
  expect(rendered.result.current.isExporting).toBe(true);
  return rendered;
}

/** Let the interval fire `times` times. */
async function tick(times: number) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
  }
}

describe('useSharedAdvancedExport – polling a job the server has forgotten', () => {
  it('gives up and reports failure after three consecutive 404s', async () => {
    const { result, unmount } = await startExporting();
    vi.mocked(apiClient.get).mockRejectedValue(httpError(404));

    await tick(3);

    expect(result.current.isExporting).toBe(false);
    expect(result.current.exportStatus).toMatch(/Export failed/i);
    unmount();
  });

  it('clears the persisted state so a reload does not resurrect the job', async () => {
    const { unmount } = await startExporting();
    clearExportState.mockClear();
    vi.mocked(apiClient.get).mockRejectedValue(httpError(404));

    await tick(3);

    expect(clearExportState).toHaveBeenCalledWith(PROJECT);
    unmount();
  });

  it('stops polling once it has given up', async () => {
    const { unmount } = await startExporting();
    vi.mocked(apiClient.get).mockRejectedValue(httpError(404));

    await tick(3);
    const callsAtGiveUp = vi.mocked(apiClient.get).mock.calls.length;
    await tick(5);

    expect(vi.mocked(apiClient.get).mock.calls.length).toBe(callsAtGiveUp);
    unmount();
  });

  it('is still exporting after only two 404s', async () => {
    const { result, unmount } = await startExporting();
    vi.mocked(apiClient.get).mockRejectedValue(httpError(404));

    await tick(2);

    expect(result.current.isExporting).toBe(true);
    unmount();
  });

  it('keeps polling through repeated 500s — those are transient', async () => {
    const { result, unmount } = await startExporting();
    vi.mocked(apiClient.get).mockRejectedValue(httpError(500));

    await tick(6);

    expect(result.current.isExporting).toBe(true);
    unmount();
  });

  it('keeps polling through a network error with no response at all', async () => {
    const { result, unmount } = await startExporting();
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Network Error'));

    await tick(6);

    expect(result.current.isExporting).toBe(true);
    unmount();
  });

  it('finishes the export when the poll reports completion', async () => {
    const { result, unmount } = await startExporting();
    vi.mocked(apiClient.get).mockResolvedValue(
      axiosOk({ status: 'completed', progress: 100 })
    );

    await tick(1);

    expect(result.current.isExporting).toBe(false);
    expect(result.current.exportStatus).toMatch(/completed/i);
    unmount();
  });

  it('stops polling once the job has completed', async () => {
    const { unmount } = await startExporting();
    vi.mocked(apiClient.get).mockResolvedValue(
      axiosOk({ status: 'completed', progress: 100 })
    );

    await tick(1);
    const callsAtCompletion = vi.mocked(apiClient.get).mock.calls.length;
    await tick(5);

    expect(vi.mocked(apiClient.get).mock.calls.length).toBe(callsAtCompletion);
    unmount();
  });

  it('surfaces a server-reported failure with its message', async () => {
    const { result, unmount } = await startExporting();
    vi.mocked(apiClient.get).mockResolvedValue(
      axiosOk({ status: 'failed', progress: 40, message: 'disk full' })
    );

    await tick(1);

    expect(result.current.isExporting).toBe(false);
    expect(result.current.exportStatus).toContain('disk full');
    unmount();
  });

  it('reports progress while the job is still running', async () => {
    const { result, unmount } = await startExporting();
    vi.mocked(apiClient.get).mockResolvedValue(
      axiosOk({ status: 'processing', progress: 42 })
    );

    await tick(1);

    expect(result.current.isExporting).toBe(true);
    expect(result.current.exportProgress).toBe(42);
    unmount();
  });

  it('runs exactly one poller — the effect must not stack intervals', async () => {
    const { unmount } = await startExporting();
    vi.mocked(apiClient.get).mockResolvedValue(
      axiosOk({ status: 'processing', progress: 10 })
    );

    await tick(4);

    // Four interval periods, one poller: four requests. Before the handle
    // moved out of render state the effect re-armed itself on every commit
    // and production saw two pollers 200 ms apart.
    expect(vi.mocked(apiClient.get).mock.calls.length).toBe(4);
    unmount();
  });

  it('a successful poll resets the counter, so scattered 404s never add up', async () => {
    const { result, unmount } = await startExporting();
    const ok = axiosOk({ status: 'processing', progress: 40 });
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce(ok);

    await tick(6);

    expect(result.current.isExporting).toBe(true);
    unmount();
  });
});
