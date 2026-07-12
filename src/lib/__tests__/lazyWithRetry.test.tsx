/**
 * lazyWithRetry — consolidated tests
 *
 * `lazyWithRetry.tsx` protects the app from stale-chunk failures after a
 * deploy: dynamic import() throws when a hashed chunk no longer exists on the
 * CDN, and the module auto-reloads the page (throttled) so the user recovers
 * without hitting a blank screen. The load-bearing behaviours:
 *
 *   1. Chunk-load-failure detection across browser wordings (isChunkLoadFailure)
 *   2. Auto-reload via window.location.reload + a 30 s sessionStorage throttle
 *   3. The lazy factory: success dismisses the loading toast; a non-chunk
 *      failure shows an error toast and does NOT reload; a chunk failure reloads
 *   4. LazyImportErrorBoundary fallback UI (heading, buttons, onError, retry)
 *   5. LazyWithRetryWrapper Suspense fallback (default spinner vs custom)
 *
 * `isChunkLoadFailure` / `tryAutoReload` are private, so their branches are
 * exercised through the boundary (componentDidCatch) and the factory rather
 * than a hand-copied mirror.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ─── mocks ───────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// retryWithBackoff is mocked so we control the factory's success/failure result
// without a real bundler; RETRY_CONFIGS is preserved for the real config spread.
vi.mock('@/lib/retryUtils', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/retryUtils')>();
  return { ...original, retryWithBackoff: vi.fn() };
});

import {
  lazyWithRetry,
  LazyImportErrorBoundary,
  LazyWithRetryWrapper,
} from '@/lib/lazyWithRetry';
import { retryWithBackoff } from '@/lib/retryUtils';
import { toast } from 'sonner';

// ─── shared helpers ──────────────────────────────────────────────────────────

const RELOAD_KEY = 'spheroseg.chunkReloadAt';
const THROTTLE_MS = 30_000;

const reloadMock = window.location.reload as ReturnType<typeof vi.fn>;

// Component that always throws the given message (error-boundary input).
function Boom({ message = 'boom' }: { message?: string }): null {
  throw new Error(message);
}

// Component that throws once then renders successfully — lets us observe the
// in-place retry path without an infinite re-render loop.
function makeBoomOnce(message: string): React.FC {
  let thrown = false;
  return function BoomOnce() {
    if (!thrown) {
      thrown = true;
      throw new Error(message);
    }
    return <div>recovered</div>;
  };
}

function Fine() {
  return <div>fine</div>;
}

// A lazy component whose import never resolves — keeps a Suspense boundary in
// its fallback state so the fallback UI can be asserted.
const NeverResolves = React.lazy(
  () => new Promise<{ default: React.FC }>(() => {})
);

// Install a real Map-backed sessionStorage (the global setup.ts mock is a no-op
// stub) so the throttle read/write logic can be exercised. Returns a restore fn.
function installRealSessionStorage(): {
  storage: Storage;
  restore: () => void;
} {
  const backing = new Map<string, string>();
  const storage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => Array.from(backing.keys())[i] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage;
  const define = (value: Storage) => {
    Object.defineProperty(global, 'sessionStorage', {
      configurable: true,
      value,
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value,
    });
  };
  define(storage);
  const restore = () =>
    define({
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    } as unknown as Storage);
  return { storage, restore };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Suppress React's error-boundary + act() console noise for clean output.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  reloadMock.mockClear();
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.clearAllTimers();
});

// ─── 1. Chunk-load-failure detection (via real componentDidCatch) ─────────────
//
// Each browser surfaces the same "chunk not on CDN anymore" case with its own
// wording. Missing ANY wording strands the user on a blank screen after a
// deploy. Detection is asserted through the boundary: a recognised chunk error
// triggers window.location.reload; an unrelated error does not.

describe('chunk-load-failure detection', () => {
  const chunkWordings = [
    ['Chrome', 'Failed to fetch dynamically imported module: /assets/x.js'],
    ['Firefox', 'error loading dynamically imported module: /assets/x.js'],
    ['Safari', 'Importing a module script failed.'],
    ['Webpack ChunkLoadError', 'ChunkLoadError'],
    ['Webpack "Loading chunk N failed"', 'Loading chunk 42 failed'],
    ['generic "Failed to import"', 'Failed to import MyComponent'],
  ] as const;

  it.each(chunkWordings)('reloads on %s wording', (_label, message) => {
    render(
      <LazyImportErrorBoundary>
        <Boom message={message} />
      </LazyImportErrorBoundary>
    );
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  const nonChunkWordings = [
    ['TypeError', 'TypeError: x is not a function'],
    ['NetworkError', 'NetworkError'],
    ['SyntaxError', 'SyntaxError: Unexpected token'],
  ] as const;

  it.each(nonChunkWordings)('does NOT reload on %s', (_label, message) => {
    render(
      <LazyImportErrorBoundary>
        <Boom message={message} />
      </LazyImportErrorBoundary>
    );
    expect(reloadMock).not.toHaveBeenCalled();
  });
});

// ─── 2. tryAutoReload throttle (real Map-backed sessionStorage) ───────────────

describe('auto-reload throttle', () => {
  let session: ReturnType<typeof installRealSessionStorage>;

  beforeEach(() => {
    session = installRealSessionStorage();
  });

  afterEach(() => {
    session.restore();
  });

  it('first reload calls window.location.reload and persists a timestamp', () => {
    render(
      <LazyImportErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: /foo.js" />
      </LazyImportErrorBoundary>
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
    const stored = session.storage.getItem(RELOAD_KEY);
    expect(Number(stored)).toBeGreaterThan(0);
  });

  it('reloads again when the last reload was more than 30 s ago', () => {
    session.storage.setItem(
      RELOAD_KEY,
      String(Date.now() - (THROTTLE_MS + 1000))
    );

    render(
      <LazyImportErrorBoundary>
        <Boom message="ChunkLoadError" />
      </LazyImportErrorBoundary>
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload within the 30 s throttle window (retries in-place instead)', () => {
    // Seed a recent reload → throttled. componentDidCatch must skip the reload
    // and fall back to an in-place retry. BoomOnce recovers on the retry render
    // so the boundary settles instead of looping.
    session.storage.setItem(RELOAD_KEY, String(Date.now() - 1000));
    const BoomOnce = makeBoomOnce('ChunkLoadError');

    render(
      <LazyImportErrorBoundary>
        <BoomOnce />
      </LazyImportErrorBoundary>
    );

    expect(reloadMock).not.toHaveBeenCalled();
    // The throttled path calls handleRetry → children re-render → recover.
    expect(screen.getByText('recovered')).toBeDefined();
  });

  it('still reloads when sessionStorage throws (Safari private mode)', () => {
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
      setItem: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(global, 'sessionStorage', {
      configurable: true,
      value: throwing,
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: throwing,
    });

    render(
      <LazyImportErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: /x.js" />
      </LazyImportErrorBoundary>
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

// ─── 3. lazyWithRetry factory (real Suspense render, mocked retryWithBackoff) ──

describe('lazyWithRetry factory', () => {
  beforeEach(() => {
    vi.mocked(retryWithBackoff).mockReset();
    vi.mocked(toast.dismiss).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('renders the loaded component and dismisses the loading toast on success', async () => {
    const Loaded = () => <div>loaded-content</div>;
    vi.mocked(retryWithBackoff).mockResolvedValue({
      success: true,
      data: { default: Loaded },
      attempts: 1,
    });

    const Lazy = lazyWithRetry(
      () => Promise.resolve({ default: Loaded }),
      'Good'
    );
    render(
      <React.Suspense fallback={<span>loading</span>}>
        <Lazy />
      </React.Suspense>
    );

    expect(await screen.findByText('loaded-content')).toBeDefined();
    expect(toast.dismiss).toHaveBeenCalled();
  });

  it('shows an error toast and does NOT reload on a non-chunk failure', async () => {
    const err = new Error('TypeError: boom');
    vi.mocked(retryWithBackoff).mockResolvedValue({
      success: false,
      error: err,
      attempts: 3,
      data: undefined,
    });

    const Lazy = lazyWithRetry(() => Promise.reject(err), 'Bad');
    render(
      <LazyImportErrorBoundary componentName="Bad">
        <React.Suspense fallback={<span>loading</span>}>
          <Lazy />
        </React.Suspense>
      </LazyImportErrorBoundary>
    );

    await screen.findByText(/Failed to load Bad/i);
    expect(toast.error).toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('auto-reloads on a chunk-load failure', async () => {
    const err = new Error(
      'Failed to fetch dynamically imported module: /assets/x.js'
    );
    vi.mocked(retryWithBackoff).mockResolvedValue({
      success: false,
      error: err,
      attempts: 3,
      data: undefined,
    });

    const Lazy = lazyWithRetry(() => Promise.reject(err), 'Chunky');
    render(
      <LazyImportErrorBoundary componentName="Chunky">
        <React.Suspense fallback={<span>loading</span>}>
          <Lazy />
        </React.Suspense>
      </LazyImportErrorBoundary>
    );

    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
  });
});

// ─── 4. LazyImportErrorBoundary — fallback UI ─────────────────────────────────

describe('LazyImportErrorBoundary UI', () => {
  it('renders children when no error is thrown', () => {
    render(
      <LazyImportErrorBoundary componentName="MyComp">
        <Fine />
      </LazyImportErrorBoundary>
    );
    expect(screen.getByText('fine')).toBeDefined();
  });

  it('renders the componentName in the "Failed to load" heading on error', () => {
    render(
      <LazyImportErrorBoundary componentName="MyModule">
        <Boom message="SyntaxError" />
      </LazyImportErrorBoundary>
    );
    expect(screen.getByText(/Failed to load MyModule/i)).toBeDefined();
    // retryCount === 0 → the generic "An error occurred" sub-message.
    expect(screen.getByText(/An error occurred/i)).toBeDefined();
  });

  it('falls back to "component" when no componentName is provided', () => {
    render(
      <LazyImportErrorBoundary>
        <Boom message="SyntaxError" />
      </LazyImportErrorBoundary>
    );
    expect(screen.getByText(/Failed to load component/i)).toBeDefined();
  });

  it('shows both "Try Again" and "Refresh Page" buttons', () => {
    render(
      <LazyImportErrorBoundary>
        <Boom message="SyntaxError" />
      </LazyImportErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Refresh Page/i })).toBeDefined();
  });

  it('calls the onError prop with the caught error', () => {
    const onError = vi.fn();
    render(
      <LazyImportErrorBoundary componentName="X" onError={onError}>
        <Boom message="test error" />
      </LazyImportErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('test error');
  });

  it('"Refresh Page" triggers window.location.reload', () => {
    render(
      <LazyImportErrorBoundary>
        <Boom message="SyntaxError" />
      </LazyImportErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: /Refresh Page/i }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('"Try Again" keeps the boundary in its error state while the child keeps throwing', () => {
    // handleRetry clears hasError, but getDerivedStateFromError resets
    // retryCount to 0 on the re-thrown error, so the "Try Again" button and the
    // "An error occurred" message persist (not "Retry attempt N of 3 failed").
    render(
      <LazyImportErrorBoundary componentName="RetryComp">
        <Boom message="SyntaxError" />
      </LazyImportErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }));

    expect(screen.getByText(/Failed to load RetryComp/i)).toBeDefined();
    expect(screen.getByText(/An error occurred/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeDefined();
  });
});

// ─── 5. LazyWithRetryWrapper — Suspense fallback ──────────────────────────────

describe('LazyWithRetryWrapper', () => {
  it('renders children when nothing suspends', () => {
    render(
      <LazyWithRetryWrapper componentName="TestComp">
        <div>hello</div>
      </LazyWithRetryWrapper>
    );
    expect(screen.getByText('hello')).toBeDefined();
  });

  it('shows the default spinner (with componentName) while a child suspends', () => {
    render(
      <LazyWithRetryWrapper componentName="Editor">
        <NeverResolves />
      </LazyWithRetryWrapper>
    );
    expect(screen.getByText(/Loading Editor/i)).toBeDefined();
  });

  it('shows a custom fallback instead of the default spinner', () => {
    render(
      <LazyWithRetryWrapper
        fallback={<span>custom-loader</span>}
        componentName="C"
      >
        <NeverResolves />
      </LazyWithRetryWrapper>
    );
    expect(screen.getByText('custom-loader')).toBeDefined();
  });
});
