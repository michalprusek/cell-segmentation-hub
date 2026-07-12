import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ExportStateManager, {
  type PersistedExportState,
} from '@/lib/exportStateManager';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Shared fixtures & helpers
// ---------------------------------------------------------------------------

const makeState = (
  overrides: Partial<PersistedExportState> = {}
): PersistedExportState => ({
  projectId: 'proj-1',
  jobId: 'job-1',
  status: 'exporting',
  startedAt: Date.now(),
  progress: 0,
  ...overrides,
});

// Real localStorage backed by a plain object so Object.keys() enumerates keys.
let store: Record<string, string>;

function makeLocalStorageMock(): Storage {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'getItem') return (key: string) => target[key] ?? null;
      if (prop === 'setItem')
        return (key: string, val: string) => {
          target[key] = val;
        };
      if (prop === 'removeItem')
        return (key: string) => {
          delete target[key];
        };
      if (prop === 'clear')
        return () => {
          Object.keys(target).forEach(k => delete target[k]);
        };
      if (prop === 'length') return Object.keys(target).length;
      if (prop === 'key') return (i: number) => Object.keys(target)[i] ?? null;
      // Allow Object.keys(localStorage) to enumerate store keys
      return target[prop as string];
    },
    ownKeys(target) {
      return Object.keys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      if (key in target)
        return {
          enumerable: true,
          configurable: true,
          value: target[key as string],
        };
      return undefined;
    },
    has(target, key) {
      return key in target;
    },
  }) as unknown as Storage;
}

function installLocalStorage(value: Storage): void {
  Object.defineProperty(window, 'localStorage', {
    value,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(global, 'localStorage', {
    value,
    writable: true,
    configurable: true,
  });
}

// Install a localStorage whose setItem is overridden (for quota/error paths),
// while getItem/removeItem still operate on the backing `store`.
function installLocalStorageWithSetItem(
  setItem: (key: string, val: string) => void
): void {
  installLocalStorage({
    getItem: (key: string) => store[key] ?? null,
    setItem,
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach(k => delete store[k]);
    },
  } as unknown as Storage);
}

beforeEach(() => {
  vi.useFakeTimers();
  store = {};

  // Reset the manager's static state so initialize() works fresh
  (ExportStateManager as any).isInitialized = false;
  (ExportStateManager as any).cleanupTimer = null;
  (ExportStateManager as any).throttledSaves = new Map();
  (ExportStateManager as any).pendingRequests = new Map();
  (ExportStateManager as any).lastCleanupTime = 0;

  installLocalStorage(makeLocalStorageMock());
});

afterEach(() => {
  ExportStateManager.cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ExportStateManager', () => {
  describe('initialize', () => {
    it('is idempotent — first and repeat calls do not throw', () => {
      expect(() => ExportStateManager.initialize()).not.toThrow();
      expect(() => ExportStateManager.initialize()).not.toThrow();
    });
  });

  describe('saveExportState / getExportState', () => {
    it('saves and retrieves a state by projectId', () => {
      ExportStateManager.saveExportState('proj-1', makeState());
      const loaded = ExportStateManager.getExportState('proj-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.jobId).toBe('job-1');
      expect(loaded!.status).toBe('exporting');
    });

    it('returns null for a project with no saved state', () => {
      expect(ExportStateManager.getExportState('missing-proj')).toBeNull();
    });

    it('returns null and removes storage entry when state has expired', () => {
      const storageKey = 'export-state-proj-1';
      store[storageKey] = JSON.stringify({
        timestamp: Date.now() - 3 * 60 * 60 * 1000,
        state: makeState(),
      });

      expect(ExportStateManager.getExportState('proj-1')).toBeNull();
      expect(store[storageKey]).toBeUndefined();
    });

    it('populates startedAt from the stored timestamp when startedAt is falsy', () => {
      const ts = Date.now() - 1000;
      store['export-state-proj-1'] = JSON.stringify({
        timestamp: ts,
        state: makeState({ startedAt: 0 }),
      });

      const loaded = ExportStateManager.getExportState('proj-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.startedAt).toBe(ts);
    });

    it('returns null when stored JSON is malformed', () => {
      store['export-state-proj-bad'] = '{{{not-json';
      expect(ExportStateManager.getExportState('proj-bad')).toBeNull();
    });
  });

  describe('saveExportState — error handling', () => {
    it('retries after cleanup and persists when quota is detected by error.name', () => {
      let calls = 0;
      installLocalStorageWithSetItem((key, val) => {
        calls++;
        if (calls === 1) {
          throw Object.assign(new Error('QuotaExceededError'), {
            name: 'QuotaExceededError',
            code: 22,
          });
        }
        store[key] = val;
      });

      expect(() =>
        ExportStateManager.saveExportState('proj-quota', makeState())
      ).not.toThrow();
      expect(ExportStateManager.getExportState('proj-quota')).not.toBeNull();
    });

    it('retries and persists when quota is detected by error.code=22 only', () => {
      let calls = 0;
      installLocalStorageWithSetItem((key, val) => {
        calls++;
        if (calls === 1) {
          const err = new Error('Storage full');
          (err as any).code = 22; // no name === 'QuotaExceededError'
          throw err;
        }
        store[key] = val;
      });

      expect(() =>
        ExportStateManager.saveExportState('proj-quota-code22', makeState())
      ).not.toThrow();
      expect(
        ExportStateManager.getExportState('proj-quota-code22')
      ).not.toBeNull();
    });

    it('does not throw (and does not persist) when the retry also fails', () => {
      installLocalStorageWithSetItem(() => {
        throw Object.assign(new Error('QuotaExceededError'), {
          name: 'QuotaExceededError',
        });
      });

      expect(() =>
        ExportStateManager.saveExportState('proj-retry-fail', makeState())
      ).not.toThrow();
      expect(ExportStateManager.getExportState('proj-retry-fail')).toBeNull();
    });

    it('does not throw for a non-quota error (warn branch)', () => {
      installLocalStorageWithSetItem(() => {
        throw new TypeError('Unexpected type');
      });

      expect(() =>
        ExportStateManager.saveExportState('proj-type-err', makeState())
      ).not.toThrow();
      expect(ExportStateManager.getExportState('proj-type-err')).toBeNull();
    });
  });

  describe('saveExportStateThrottled', () => {
    it('does not save immediately — saves after the 500ms delay', () => {
      ExportStateManager.saveExportStateThrottled('proj-1', makeState());
      expect(ExportStateManager.getExportState('proj-1')).toBeNull();

      vi.advanceTimersByTime(500);
      expect(ExportStateManager.getExportState('proj-1')).not.toBeNull();
    });

    it('debounces rapid calls — only the last state is saved', () => {
      ExportStateManager.saveExportStateThrottled(
        'proj-1',
        makeState({ progress: 10 })
      );
      ExportStateManager.saveExportStateThrottled(
        'proj-1',
        makeState({ progress: 90 })
      );

      vi.advanceTimersByTime(500);
      expect(ExportStateManager.getExportState('proj-1')!.progress).toBe(90);
    });
  });

  describe('clearExportState', () => {
    it('removes the saved state for the given projectId', () => {
      ExportStateManager.saveExportState('proj-1', makeState());
      ExportStateManager.clearExportState('proj-1');
      expect(ExportStateManager.getExportState('proj-1')).toBeNull();
    });

    it('does not throw when clearing a non-existent state', () => {
      expect(() =>
        ExportStateManager.clearExportState('ghost-proj')
      ).not.toThrow();
    });

    it('cancels a pending throttled save so it does not fire after clear', () => {
      ExportStateManager.saveExportStateThrottled(
        'proj-2',
        makeState({ projectId: 'proj-2' })
      );
      ExportStateManager.clearExportState('proj-2');

      vi.advanceTimersByTime(600);
      expect(ExportStateManager.getExportState('proj-2')).toBeNull();
    });
  });

  describe('hasExportState', () => {
    it('returns true when state exists', () => {
      ExportStateManager.saveExportState(
        'proj-has',
        makeState({ projectId: 'proj-has' })
      );
      expect(ExportStateManager.hasExportState('proj-has')).toBe(true);
    });

    it('returns false when no state exists', () => {
      expect(ExportStateManager.hasExportState('proj-no-state')).toBe(false);
    });
  });

  describe('updateExportProgress', () => {
    it('updates the progress field on an existing state', () => {
      ExportStateManager.saveExportState('proj-1', makeState({ progress: 0 }));
      ExportStateManager.updateExportProgress('proj-1', 75);
      expect(ExportStateManager.getExportState('proj-1')!.progress).toBe(75);
    });

    it('updates exportStatus when provided', () => {
      ExportStateManager.saveExportState('proj-1', makeState());
      ExportStateManager.updateExportProgress('proj-1', 50, 'Compressing');
      expect(ExportStateManager.getExportState('proj-1')!.exportStatus).toBe(
        'Compressing'
      );
    });

    it('leaves exportStatus unchanged when not provided', () => {
      ExportStateManager.saveExportState(
        'proj-1',
        makeState({ exportStatus: 'Processing', progress: 10 })
      );
      ExportStateManager.updateExportProgress('proj-1', 50);
      const loaded = ExportStateManager.getExportState('proj-1');
      expect(loaded!.progress).toBe(50);
      expect(loaded!.exportStatus).toBe('Processing');
    });

    it('does nothing when no state exists for the projectId', () => {
      expect(() =>
        ExportStateManager.updateExportProgress('no-such-proj', 50)
      ).not.toThrow();
    });
  });

  describe('cleanupExpiredStates', () => {
    it('removes expired entries and returns the count', () => {
      store['export-state-old-proj'] = JSON.stringify({
        timestamp: Date.now() - 3 * 60 * 60 * 1000,
        state: makeState({ projectId: 'old-proj' }),
      });
      ExportStateManager.saveExportState(
        'fresh-proj',
        makeState({ projectId: 'fresh-proj' })
      );

      const count = ExportStateManager.cleanupExpiredStates();
      expect(count).toBe(1);
      expect(store['export-state-old-proj']).toBeUndefined();
      expect(store['export-state-fresh-proj']).toBeDefined();
    });

    it('returns 0 when there is nothing to clean', () => {
      ExportStateManager.saveExportState('proj-1', makeState());
      expect(ExportStateManager.cleanupExpiredStates()).toBe(0);
    });

    it('removes entries with invalid JSON', () => {
      store['export-state-corrupt'] = 'not-json';
      expect(ExportStateManager.cleanupExpiredStates()).toBe(1);
    });
  });

  describe('deduplicateRequest', () => {
    it('returns the same promise for concurrent calls with the same jobId', () => {
      const fn = vi.fn().mockResolvedValue('result');
      const p1 = ExportStateManager.deduplicateRequest('job-abc', fn);
      const p2 = ExportStateManager.deduplicateRequest('job-abc', fn);
      expect(p1).toBe(p2);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('cleans up the pending request after it resolves', async () => {
      const fn = vi.fn().mockResolvedValue('done');
      await ExportStateManager.deduplicateRequest('job-xyz', fn);
      // Second call after the first resolved should create a new request
      await ExportStateManager.deduplicateRequest('job-xyz', fn);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('subscribeToChanges', () => {
    it('calls the callback with the parsed state for the watched key', () => {
      const callback = vi.fn();
      ExportStateManager.subscribeToChanges('proj-1', callback);

      const state = makeState();
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'export-state-proj-1',
          newValue: JSON.stringify({ timestamp: Date.now(), state }),
        })
      );

      expect(callback).toHaveBeenCalledWith(state);
    });

    it('calls callback with null when the storage entry is removed', () => {
      const callback = vi.fn();
      ExportStateManager.subscribeToChanges('proj-1', callback);

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'export-state-proj-1',
          newValue: null,
        })
      );

      expect(callback).toHaveBeenCalledWith(null);
    });

    it('calls callback(null) when newValue is invalid JSON', () => {
      const callback = vi.fn();
      ExportStateManager.subscribeToChanges('proj-corrupt', callback);

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'export-state-proj-corrupt',
          newValue: '{bad-json',
        })
      );

      expect(callback).toHaveBeenCalledWith(null);
    });

    it('does not call the callback for an unrelated storage key', () => {
      const callback = vi.fn();
      ExportStateManager.subscribeToChanges('proj-watch', callback);

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'export-state-other-project',
          newValue: JSON.stringify({
            timestamp: Date.now(),
            state: makeState(),
          }),
        })
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('stops invoking the callback after unsubscribe', () => {
      const callback = vi.fn();
      const unsub = ExportStateManager.subscribeToChanges('proj-1', callback);
      unsub();

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'export-state-proj-1',
          newValue: JSON.stringify({
            timestamp: Date.now(),
            state: makeState(),
          }),
        })
      );

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getAllActiveStates', () => {
    it('returns all non-expired states keyed by projectId', () => {
      ExportStateManager.saveExportState(
        'proj-a',
        makeState({ projectId: 'proj-a', jobId: 'j-a' })
      );
      ExportStateManager.saveExportState(
        'proj-b',
        makeState({ projectId: 'proj-b', jobId: 'j-b' })
      );

      const all = ExportStateManager.getAllActiveStates();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['proj-a'].jobId).toBe('j-a');
      expect(all['proj-b'].jobId).toBe('j-b');
    });

    it('excludes expired states', () => {
      store['export-state-old'] = JSON.stringify({
        timestamp: Date.now() - 3 * 60 * 60 * 1000,
        state: makeState({ projectId: 'old' }),
      });
      ExportStateManager.saveExportState(
        'fresh',
        makeState({ projectId: 'fresh' })
      );

      const all = ExportStateManager.getAllActiveStates();
      expect(all['old']).toBeUndefined();
      expect(all['fresh']).toBeDefined();
    });

    it('skips keys that read back as null mid-loop (race condition)', () => {
      ExportStateManager.saveExportState(
        'proj-a',
        makeState({ projectId: 'proj-a', jobId: 'j-a' })
      );
      store['export-state-proj-b'] = null as any; // key exists but reads as null

      const all = ExportStateManager.getAllActiveStates();
      expect(all['proj-a']).toBeDefined();
      expect(all['proj-b']).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('does not throw when called with no active timer', () => {
      expect(() => ExportStateManager.cleanup()).not.toThrow();
      expect(() => ExportStateManager.cleanup()).not.toThrow();
    });
  });
});
