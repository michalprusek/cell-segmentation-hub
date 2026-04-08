import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

// Real localStorage backed by a plain object so Object.keys() works
let store: Record<string, string>;

function makeLocalStorageMock() {
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

beforeEach(() => {
  vi.useFakeTimers();
  store = {};

  // Reset the manager's static state so initialize() works fresh
  (ExportStateManager as any).isInitialized = false;
  (ExportStateManager as any).cleanupTimer = null;
  (ExportStateManager as any).throttledSaves = new Map();
  (ExportStateManager as any).pendingRequests = new Map();
  (ExportStateManager as any).lastCleanupTime = 0;

  Object.defineProperty(window, 'localStorage', {
    value: makeLocalStorageMock(),
    writable: true,
    configurable: true,
  });
  // Also update global.localStorage used internally
  Object.defineProperty(global, 'localStorage', {
    value: window.localStorage,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  ExportStateManager.cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ExportStateManager', () => {
  describe('initialize', () => {
    it('initializes without error on first call', () => {
      expect(() => ExportStateManager.initialize()).not.toThrow();
    });

    it('is idempotent — calling twice does not throw or double-register', () => {
      ExportStateManager.initialize();
      expect(() => ExportStateManager.initialize()).not.toThrow();
    });
  });

  describe('saveExportState / getExportState', () => {
    it('saves and retrieves a state by projectId', () => {
      const state = makeState();
      ExportStateManager.saveExportState('proj-1', state);
      const loaded = ExportStateManager.getExportState('proj-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.jobId).toBe('job-1');
      expect(loaded!.status).toBe('exporting');
    });

    it('returns null for a project with no saved state', () => {
      expect(ExportStateManager.getExportState('missing-proj')).toBeNull();
    });

    it('returns null and removes storage entry when state has expired', () => {
      const state = makeState();

      // Write an expired entry directly into the backing store
      const storageKey = `export-state-proj-1`;
      store[storageKey] = JSON.stringify({
        timestamp: Date.now() - 3 * 60 * 60 * 1000,
        state,
      });

      expect(ExportStateManager.getExportState('proj-1')).toBeNull();
      expect(store[storageKey]).toBeUndefined();
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
      const count = ExportStateManager.cleanupExpiredStates();
      expect(count).toBe(1);
    });
  });

  describe('saveExportStateThrottled', () => {
    it('does not save immediately — saves after 500ms delay', () => {
      ExportStateManager.saveExportStateThrottled('proj-1', makeState());
      expect(ExportStateManager.getExportState('proj-1')).toBeNull();

      vi.advanceTimersByTime(500);
      expect(ExportStateManager.getExportState('proj-1')).not.toBeNull();
    });

    it('debounces rapid calls — only the last state is saved', () => {
      const first = makeState({ progress: 10 });
      const last = makeState({ progress: 90 });

      ExportStateManager.saveExportStateThrottled('proj-1', first);
      ExportStateManager.saveExportStateThrottled('proj-1', last);

      vi.advanceTimersByTime(500);
      expect(ExportStateManager.getExportState('proj-1')!.progress).toBe(90);
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

      // Second call after first resolved should create a new request
      await ExportStateManager.deduplicateRequest('job-xyz', fn);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('subscribeToChanges', () => {
    it('returns an unsubscribe function', () => {
      const unsub = ExportStateManager.subscribeToChanges('proj-1', vi.fn());
      expect(typeof unsub).toBe('function');
      expect(() => unsub()).not.toThrow();
    });

    it('calls the callback when a storage event fires for the watched key', () => {
      const callback = vi.fn();
      ExportStateManager.subscribeToChanges('proj-1', callback);

      const state = makeState();
      const stored = JSON.stringify({ timestamp: Date.now(), state });

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'export-state-proj-1',
          newValue: stored,
        })
      );

      expect(callback).toHaveBeenCalledWith(state);
    });

    it('calls callback with null when storage entry is removed', () => {
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
  });

  describe('QuotaExceededError handling', () => {
    it('retries the save after cleaning up expired states', () => {
      let callCount = 0;
      // Patch setItem on the proxy target by replacing the mock setter
      const _original = store;
      let throwOnNext = true;
      // Override the proxy's setItem by rebuilding the mock temporarily
      const patchedMock = {
        ...window.localStorage,
        setItem: (key: string, val: string) => {
          callCount++;
          if (throwOnNext && callCount === 1) {
            throwOnNext = false;
            const err = Object.assign(new Error('QuotaExceededError'), {
              name: 'QuotaExceededError',
              code: 22,
            });
            throw err;
          }
          store[key] = val;
        },
      };
      Object.defineProperty(window, 'localStorage', {
        value: patchedMock,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(global, 'localStorage', {
        value: patchedMock,
        writable: true,
        configurable: true,
      });

      expect(() =>
        ExportStateManager.saveExportState('proj-quota', makeState())
      ).not.toThrow();
    });
  });
});
