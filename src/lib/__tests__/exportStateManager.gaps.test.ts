/**
 * exportStateManager — gap coverage targeting the branches not hit
 * by the existing exportStateManager.test.ts:
 *
 *   1. getExportState — state.startedAt is 0/falsy → set from timestamp
 *   2. getExportState — parse error on corrupt JSON → returns null
 *   3. clearExportState — cancels a pending throttled save for the same project
 *   4. hasExportState — returns true when key exists, false when absent
 *   5. subscribeToChanges — corrupt newValue JSON → calls callback(null)
 *   6. subscribeToChanges — storage event for different key is ignored
 *   7. getAllActiveStates — handles localStorage.getItem returning null mid-loop
 *   8. QuotaExceededError with code=22 (not name) → retry path
 *   9. cleanup() — when cleanupTimer is already null (no double-clear error)
 *  10. updateExportProgress — exportStatus NOT provided → field unchanged
 */

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
// localStorage backed by a plain object (mirrors the pattern in the original test)
// ---------------------------------------------------------------------------

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

beforeEach(() => {
  vi.useFakeTimers();
  store = {};
  (ExportStateManager as any).isInitialized = false;
  (ExportStateManager as any).cleanupTimer = null;
  (ExportStateManager as any).throttledSaves = new Map();
  (ExportStateManager as any).pendingRequests = new Map();
  (ExportStateManager as any).lastCleanupTime = 0;

  const mock = makeLocalStorageMock();
  Object.defineProperty(window, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(global, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  ExportStateManager.cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. getExportState — startedAt is 0/falsy → gets set from timestamp
// ---------------------------------------------------------------------------

describe('getExportState — startedAt=0 branch', () => {
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
});

// ---------------------------------------------------------------------------
// 2. getExportState — JSON parse error
// ---------------------------------------------------------------------------

describe('getExportState — corrupt JSON', () => {
  it('returns null when stored JSON is malformed', () => {
    store['export-state-proj-bad'] = '{{{not-json';
    expect(ExportStateManager.getExportState('proj-bad')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. clearExportState — cancels pending throttled save
// ---------------------------------------------------------------------------

describe('clearExportState — cancels pending throttled save', () => {
  it('removes a pending throttled save so it does not fire after clear', () => {
    // Schedule a throttled save (does not execute immediately)
    ExportStateManager.saveExportStateThrottled(
      'proj-2',
      makeState({ projectId: 'proj-2' })
    );

    // Immediately clear before the 500ms fires
    ExportStateManager.clearExportState('proj-2');

    // Advance time past the 500ms debounce window
    vi.advanceTimersByTime(600);

    // The state must NOT have been saved (clear cancelled the timeout)
    expect(ExportStateManager.getExportState('proj-2')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. hasExportState
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 5. subscribeToChanges — corrupt newValue
// ---------------------------------------------------------------------------

describe('subscribeToChanges — corrupt newValue', () => {
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
});

// ---------------------------------------------------------------------------
// 6. subscribeToChanges — different key is ignored
// ---------------------------------------------------------------------------

describe('subscribeToChanges — ignores unrelated keys', () => {
  it('does not call callback when storage event key does not match', () => {
    const callback = vi.fn();
    ExportStateManager.subscribeToChanges('proj-watch', callback);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'export-state-other-project',
        newValue: JSON.stringify({ timestamp: Date.now(), state: makeState() }),
      })
    );

    expect(callback).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. getAllActiveStates — key present but getItem returns null mid-loop
// ---------------------------------------------------------------------------

describe('getAllActiveStates — handles null item mid-loop', () => {
  it('skips keys where getItem returns null (e.g. race condition)', () => {
    // Write two keys; patch getItem to return null for the second one
    ExportStateManager.saveExportState(
      'proj-a',
      makeState({ projectId: 'proj-a', jobId: 'j-a' })
    );
    store['export-state-proj-b'] = null as any; // simulate a key that exists but reads as null

    // getAllActiveStates should return only the valid one
    const all = ExportStateManager.getAllActiveStates();
    expect(all['proj-a']).toBeDefined();
    expect(all['proj-b']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. updateExportProgress — without exportStatus (branch where exportStatus is falsy)
// ---------------------------------------------------------------------------

describe('updateExportProgress — no exportStatus argument', () => {
  it('updates progress but leaves exportStatus unchanged when not provided', () => {
    ExportStateManager.saveExportState(
      'proj-1',
      makeState({ exportStatus: 'Processing', progress: 10 })
    );
    ExportStateManager.updateExportProgress('proj-1', 50);
    const loaded = ExportStateManager.getExportState('proj-1');
    expect(loaded!.progress).toBe(50);
    expect(loaded!.exportStatus).toBe('Processing'); // unchanged
  });
});

// ---------------------------------------------------------------------------
// 9. cleanup() when cleanupTimer is already null
// ---------------------------------------------------------------------------

describe('cleanup — idempotent', () => {
  it('does not throw when called with no active timer', () => {
    // cleanupTimer is null (initialized above)
    expect(() => ExportStateManager.cleanup()).not.toThrow();
    // Calling again is also safe
    expect(() => ExportStateManager.cleanup()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. QuotaExceededError via code=22 (alternate detection path)
// ---------------------------------------------------------------------------

describe('saveExportState — QuotaExceededError via error.code=22', () => {
  it('retries after cleanup when error has code=22 (not just name)', () => {
    let firstCall = true;
    const patchedMock = {
      ...window.localStorage,
      setItem: (key: string, val: string) => {
        if (firstCall) {
          firstCall = false;
          const err = new Error('Storage full');
          (err as any).code = 22; // No `name = QuotaExceededError`, only code
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

    // Should not throw; retry save should work
    expect(() =>
      ExportStateManager.saveExportState('proj-quota-code22', makeState())
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// QuotaExceededError — retry also fails (inner catch path)
// ---------------------------------------------------------------------------

describe('saveExportState — QuotaExceededError when retry also fails', () => {
  it('does not throw even when retry also throws', () => {
    const patchedMock = {
      ...window.localStorage,
      setItem: (_key: string, _val: string) => {
        const err = new Error('QuotaExceededError');
        (err as any).name = 'QuotaExceededError';
        throw err;
      },
      getItem: (key: string) => store[key] ?? null,
      removeItem: (key: string) => {
        delete store[key];
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
      ExportStateManager.saveExportState('proj-retry-fail', makeState())
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Non-quota error in saveExportState (warn branch)
// ---------------------------------------------------------------------------

describe('saveExportState — non-quota error', () => {
  it('does not throw when setItem throws a non-quota error', () => {
    const patchedMock = {
      ...window.localStorage,
      setItem: () => {
        throw new TypeError('Unexpected type');
      },
      getItem: (key: string) => store[key] ?? null,
      removeItem: (key: string) => {
        delete store[key];
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
      ExportStateManager.saveExportState('proj-type-err', makeState())
    ).not.toThrow();
  });
});
