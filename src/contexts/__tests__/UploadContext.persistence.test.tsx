import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import {
  UploadProvider,
  UPLOAD_SESSIONS_STORAGE_KEY,
} from '@/contexts/UploadContext';
import { useUpload } from '@/contexts/useUpload';

vi.mock('@/lib/api', () => ({
  default: {
    uploadImages: vi.fn(),
    uploadImagesChunked: vi.fn(),
    uploadVideo: vi.fn(),
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: vi.fn(() => ({
    socket: null,
    isConnected: false,
  })),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <UploadProvider>{children}</UploadProvider>
);

describe('UploadContext — persistence across page refresh', () => {
  // The global test setup (src/test/setup.ts) installs a stub
  // localStorage that returns null for everything except 'theme' and
  // 'language'. Replace it per-test with a Map-backed storage so our
  // round-trips persist as they would in the browser.
  let backing: Map<string, string>;
  beforeEach(() => {
    backing = new Map();
    const stub = {
      getItem: vi.fn((key: string) => backing.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        backing.set(key, String(value));
      }),
      removeItem: vi.fn((key: string) => {
        backing.delete(key);
      }),
      clear: vi.fn(() => {
        backing.clear();
      }),
      key: vi.fn((i: number) => Array.from(backing.keys())[i] ?? null),
      get length() {
        return backing.size;
      },
    } as unknown as Storage;
    Object.defineProperty(global, 'localStorage', {
      value: stub,
      configurable: true,
    });
    Object.defineProperty(window, 'localStorage', {
      value: stub,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it('restores persisted sessions on mount', () => {
    const fixture = {
      upload_1: {
        id: 'upload_1',
        projectId: 'proj_a',
        projectName: 'Project A',
        status: 'completed',
        totalFiles: 3,
        successCount: 3,
        failedCount: 0,
        overallProgress: 100,
        chunkProgress: null,
        currentOperation: '3 files uploaded successfully',
        startedAt: Date.now() - 60_000, // 1 minute ago
      },
    };
    window.localStorage.setItem(
      UPLOAD_SESSIONS_STORAGE_KEY,
      JSON.stringify(fixture)
    );

    const { result } = renderHook(() => useUpload(), { wrapper });

    expect(result.current.sessions).toHaveProperty('upload_1');
    expect(result.current.sessions['upload_1'].status).toBe('completed');
    expect(result.current.sessions['upload_1'].successCount).toBe(3);
  });

  it('flips uploading sessions to cancelled on restore (browser aborted request on refresh)', () => {
    const fixture = {
      upload_2: {
        id: 'upload_2',
        projectId: 'proj_b',
        status: 'uploading',
        totalFiles: 1,
        successCount: 0,
        failedCount: 0,
        overallProgress: 42,
        chunkProgress: null,
        currentOperation: 'Uploading big.tif',
        startedAt: Date.now() - 5_000,
      },
    };
    window.localStorage.setItem(
      UPLOAD_SESSIONS_STORAGE_KEY,
      JSON.stringify(fixture)
    );

    const { result } = renderHook(() => useUpload(), { wrapper });

    // Restored session should NOT be 'uploading' — the AbortController is
    // gone with the previous page; surfacing 'uploading' would leave a
    // permanent spinner.
    expect(result.current.sessions['upload_2'].status).toBe('cancelled');
    expect(result.current.sessions['upload_2'].currentOperation).toMatch(
      /interrupted/i
    );
    // activeSession only counts 'uploading' status, so the restored
    // cancelled session must not be treated as active.
    expect(result.current.activeSession).toBeNull();
    expect(result.current.isUploading).toBe(false);
  });

  it('drops sessions older than 24h on restore', () => {
    const fixture = {
      fresh: {
        id: 'fresh',
        projectId: 'p',
        status: 'completed',
        totalFiles: 1,
        successCount: 1,
        failedCount: 0,
        overallProgress: 100,
        chunkProgress: null,
        currentOperation: 'done',
        startedAt: Date.now() - 60_000, // fresh
      },
      stale: {
        id: 'stale',
        projectId: 'p',
        status: 'completed',
        totalFiles: 1,
        successCount: 1,
        failedCount: 0,
        overallProgress: 100,
        chunkProgress: null,
        currentOperation: 'done',
        startedAt: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
      },
    };
    window.localStorage.setItem(
      UPLOAD_SESSIONS_STORAGE_KEY,
      JSON.stringify(fixture)
    );

    const { result } = renderHook(() => useUpload(), { wrapper });

    expect(result.current.sessions).toHaveProperty('fresh');
    expect(result.current.sessions).not.toHaveProperty('stale');
  });

  it('survives invalid JSON in localStorage', () => {
    window.localStorage.setItem(
      UPLOAD_SESSIONS_STORAGE_KEY,
      'not valid json {{{ '
    );

    // Should not throw on mount.
    const { result } = renderHook(() => useUpload(), { wrapper });

    expect(result.current.sessions).toEqual({});
  });

  it('writes sessions to localStorage when state changes', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });

    // Initially empty.
    expect(window.localStorage.getItem(UPLOAD_SESSIONS_STORAGE_KEY)).toBe('{}');

    // Triggering a state change (clearSession on a non-existent id is a
    // no-op for state but still flushes through the effect).
    act(() => {
      result.current.clearSession('nope');
    });

    expect(window.localStorage.getItem(UPLOAD_SESSIONS_STORAGE_KEY)).toBe('{}');
  });

  it('skips entries with missing or malformed fields', () => {
    const fixture = {
      bad_no_started_at: { id: 'x', status: 'completed' },
      bad_null: null,
      good: {
        id: 'good',
        projectId: 'p',
        status: 'completed',
        totalFiles: 1,
        successCount: 1,
        failedCount: 0,
        overallProgress: 100,
        chunkProgress: null,
        currentOperation: 'done',
        startedAt: Date.now() - 10_000,
      },
    };
    window.localStorage.setItem(
      UPLOAD_SESSIONS_STORAGE_KEY,
      JSON.stringify(fixture)
    );

    const { result } = renderHook(() => useUpload(), { wrapper });

    expect(Object.keys(result.current.sessions)).toEqual(['good']);
  });
});
