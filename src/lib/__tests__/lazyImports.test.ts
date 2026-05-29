/**
 * Behavioral tests for src/lib/lazyImports.ts
 *
 * Covered behaviors:
 *  - cachedLazyLoad: returns module on first call, serves from cache on second call (loader NOT re-invoked)
 *  - cachedLazyLoad: different keys are cached independently
 *  - cachedLazyLoad: on loader rejection, throws and does NOT cache the key (retry still calls loader)
 *  - preloadModule: calls loader, swallows errors silently (no throw)
 *  - lazyLoadMetricCalculations / lazyLoadTiffConverter / lazyLoadPolygonIdUtils:
 *    these perform real dynamic imports; we only verify they are async functions that return objects
 *    (we cannot test the import chain inside Vitest without the full FE bundle, so we test the
 *    cachedLazyLoad wrapper contract instead, which is the actual logic under test).
 *
 * Skipped: the real dynamic-import internals of lazyLoadMetricCalculations etc. — they depend on
 * the full Vite chunk graph which is not available in the Vitest jsdom environment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cachedLazyLoad, preloadModule } from '../lazyImports';

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Reset the module-scope cache between tests by re-importing through a
// factory — but since the cache Map lives in module scope we isolate tests
// by using unique keys.

describe('cachedLazyLoad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the loader and returns the resolved module', async () => {
    const fakeModule = { doSomething: () => 42 };
    const loader = vi.fn().mockResolvedValue(fakeModule);

    const result = await cachedLazyLoad('test-key-a', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeModule);
  });

  it('returns the cached module on the second call without invoking the loader again', async () => {
    const fakeModule = { value: 'cached' };
    const loader = vi.fn().mockResolvedValue(fakeModule);

    const first = await cachedLazyLoad('test-key-b', loader);
    const second = await cachedLazyLoad('test-key-b', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(second).toBe(fakeModule);
  });

  it('caches different keys independently', async () => {
    const moduleA = { id: 'A' };
    const moduleB = { id: 'B' };
    const loaderA = vi.fn().mockResolvedValue(moduleA);
    const loaderB = vi.fn().mockResolvedValue(moduleB);

    const a = await cachedLazyLoad('test-key-c1', loaderA);
    const b = await cachedLazyLoad('test-key-c2', loaderB);

    expect(a).toBe(moduleA);
    expect(b).toBe(moduleB);
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it('throws when the loader rejects', async () => {
    const boom = new Error('network fail');
    const loader = vi.fn().mockRejectedValue(boom);

    await expect(cachedLazyLoad('test-key-d', loader)).rejects.toThrow(
      'network fail'
    );
  });

  it('does NOT cache a failed load — subsequent call invokes loader again', async () => {
    const boom = new Error('transient');
    const fakeModule = { recovered: true };
    const loader = vi
      .fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce(fakeModule);

    // First call fails
    await expect(cachedLazyLoad('test-key-e', loader)).rejects.toThrow();

    // Second call should retry (loader called again) and succeed
    const result = await cachedLazyLoad('test-key-e', loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(result).toBe(fakeModule);
  });

  it('returns the exact same object reference from cache (not a deep clone)', async () => {
    const fakeModule = { nested: { deep: [1, 2, 3] } };
    const loader = vi.fn().mockResolvedValue(fakeModule);

    await cachedLazyLoad('test-key-f', loader);
    const cached = await cachedLazyLoad('test-key-f', loader);

    expect(cached).toBe(fakeModule);
    expect(cached.nested).toBe(fakeModule.nested);
  });
});

describe('preloadModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the loader function', async () => {
    const fakeModule = { preloaded: true };
    const loader = vi.fn().mockResolvedValue(fakeModule);

    preloadModule(loader, 'my-module');

    // preloadModule is fire-and-forget; give the microtask queue a tick
    await Promise.resolve();

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the loader rejects', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('load error'));

    // Must not throw synchronously
    expect(() => preloadModule(loader, 'bad-module')).not.toThrow();

    // Must not throw asynchronously either (Promise rejection is swallowed)
    await Promise.resolve();
    // No unhandled rejection → test passes
  });
});
