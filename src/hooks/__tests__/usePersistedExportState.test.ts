import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMultiProjectExportState } from '@/hooks/usePersistedExportState';

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// The global setup.ts installs a vi.fn()-based localStorage mock on
// `global.localStorage`.  We use that object directly in tests rather than
// spying on Storage.prototype, which is bypassed by the global mock.
// ---------------------------------------------------------------------------

describe('useMultiProjectExportState', () => {
  // Local in-memory store shared across all localStorage mock operations
  let store: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {};

    // Wire up the global mock to forward to our local store
    vi.mocked(localStorage.getItem).mockImplementation(
      (key: string) => store[key] ?? null
    );
    vi.mocked(localStorage.setItem).mockImplementation(
      (key: string, value: string) => {
        store[key] = value;
      }
    );
    vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
      delete store[key];
    });

    // Make localStorage.key() / .length reflect the store contents.
    // The global mock object does not implement these by default, so we add
    // them explicitly here so getAllActiveStates can iterate.
    Object.defineProperty(global.localStorage, 'length', {
      get: () => Object.keys(store).length,
      configurable: true,
    });
    (global.localStorage as any).key = (index: number): string | null =>
      Object.keys(store)[index] ?? null;
  });

  // ---- helpers -------------------------------------------------------------

  const putState = (projectId: string, state: object) => {
    store[`exportState_${projectId}`] = JSON.stringify(state);
  };

  // ---- getExportState ------------------------------------------------------

  describe('getExportState', () => {
    it('reads from localStorage and parses JSON correctly', () => {
      const state = {
        projectId: 'proj-1',
        jobId: 'job-abc',
        status: 'exporting',
        startedAt: 1700000000000,
        progress: 42,
        exportStatus: 'running',
      };
      putState('proj-1', state);

      const { result } = renderHook(() => useMultiProjectExportState());
      const returned = result.current.getExportState('proj-1');

      expect(returned).toEqual(state);
    });

    it('returns null when no entry exists in localStorage', () => {
      const { result } = renderHook(() => useMultiProjectExportState());
      expect(result.current.getExportState('proj-missing')).toBeNull();
    });

    it('returns null on JSON parse error and logs the error', async () => {
      const { logger } = await import('@/lib/logger');
      store['exportState_bad'] = 'not-valid-json{{{';

      const { result } = renderHook(() => useMultiProjectExportState());
      const returned = result.current.getExportState('bad');

      expect(returned).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ---- updateExportState ---------------------------------------------------

  describe('updateExportState', () => {
    it('merges updates with existing state and writes to localStorage', () => {
      const initial = {
        projectId: 'proj-2',
        jobId: 'job-xyz',
        status: 'exporting',
        startedAt: 1700000000000,
        progress: 10,
        exportStatus: 'running',
      };
      putState('proj-2', initial);

      const { result } = renderHook(() => useMultiProjectExportState());
      // Populate the internal ref first
      result.current.getExportState('proj-2');
      result.current.updateExportState('proj-2', {
        progress: 75,
        status: 'processing',
      });

      const raw = store['exportState_proj-2'];
      expect(raw).toBeDefined();
      const saved = JSON.parse(raw);
      expect(saved.progress).toBe(75);
      expect(saved.status).toBe('processing');
      // Original fields are preserved
      expect(saved.jobId).toBe('job-xyz');
    });

    it('creates a new entry when no prior state exists', () => {
      const { result } = renderHook(() => useMultiProjectExportState());
      result.current.updateExportState('proj-new', {
        jobId: 'job-new',
        status: 'exporting',
        startedAt: 1700000000000,
        progress: 0,
        exportStatus: 'queued',
      });

      const raw = store['exportState_proj-new'];
      expect(raw).toBeDefined();
      const saved = JSON.parse(raw);
      expect(saved.jobId).toBe('job-new');
      // projectId should default to the key
      expect(saved.projectId).toBe('proj-new');
    });

    it('writes the correct localStorage key', () => {
      const { result } = renderHook(() => useMultiProjectExportState());
      result.current.updateExportState('proj-key-check', {
        status: 'exporting',
      });

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'exportState_proj-key-check',
        expect.any(String)
      );
    });
  });

  // ---- clearExportState ----------------------------------------------------

  describe('clearExportState', () => {
    it('removes the entry from localStorage', () => {
      putState('proj-3', { projectId: 'proj-3', status: 'exporting' });

      const { result } = renderHook(() => useMultiProjectExportState());
      result.current.clearExportState('proj-3');

      expect(store['exportState_proj-3']).toBeUndefined();
      expect(localStorage.removeItem).toHaveBeenCalledWith(
        'exportState_proj-3'
      );
    });

    it('does not throw when clearing a non-existent entry', () => {
      const { result } = renderHook(() => useMultiProjectExportState());
      expect(() =>
        result.current.clearExportState('proj-nonexistent')
      ).not.toThrow();
    });
  });

  // ---- getAllActiveStates ---------------------------------------------------

  describe('getAllActiveStates', () => {
    it('returns only entries with active statuses (exporting or processing)', () => {
      putState('proj-a', {
        projectId: 'proj-a',
        jobId: 'j1',
        status: 'exporting',
        startedAt: 1,
        progress: 10,
        exportStatus: 'running',
      });
      putState('proj-b', {
        projectId: 'proj-b',
        jobId: 'j2',
        status: 'processing',
        startedAt: 2,
        progress: 50,
        exportStatus: 'running',
      });

      const { result } = renderHook(() => useMultiProjectExportState());
      const active = result.current.getAllActiveStates();

      expect(active.size).toBe(2);
      expect(active.has('proj-a')).toBe(true);
      expect(active.has('proj-b')).toBe(true);
    });

    it('excludes entries with completed status', () => {
      putState('proj-done', {
        projectId: 'proj-done',
        jobId: 'j3',
        status: 'completed',
        startedAt: 3,
        progress: 100,
        exportStatus: 'done',
      });

      const { result } = renderHook(() => useMultiProjectExportState());
      const active = result.current.getAllActiveStates();

      expect(active.has('proj-done')).toBe(false);
    });

    it('excludes entries with failed status', () => {
      putState('proj-fail', {
        projectId: 'proj-fail',
        jobId: 'j4',
        status: 'failed',
        startedAt: 4,
        progress: 0,
        exportStatus: 'error',
      });

      const { result } = renderHook(() => useMultiProjectExportState());
      const active = result.current.getAllActiveStates();

      expect(active.has('proj-fail')).toBe(false);
    });

    it('ignores localStorage keys that do not start with exportState_', () => {
      store['unrelated_key'] = JSON.stringify({ status: 'exporting' });

      const { result } = renderHook(() => useMultiProjectExportState());
      const active = result.current.getAllActiveStates();

      // unrelated_key must not be treated as a project export state
      expect(active.has('unrelated_key')).toBe(false);
    });

    it('returns an empty Map when localStorage has no export entries', () => {
      const { result } = renderHook(() => useMultiProjectExportState());
      const active = result.current.getAllActiveStates();

      expect(active).toBeInstanceOf(Map);
      expect(active.size).toBe(0);
    });
  });
});
