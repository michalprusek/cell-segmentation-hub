/**
 * Enhanced lazy loading with automatic retry mechanism
 * Handles dynamic import failures gracefully with user feedback
 */
/* eslint-disable react-refresh/only-export-components -- factory exports both helpers and component */

import React, { lazy, ComponentType } from 'react';
import { retryWithBackoff, RETRY_CONFIGS } from './retryUtils';
import { logger } from './logger';
import { toast } from 'sonner';

// After deploy, the in-page bundle still references chunk filenames
// hashed with the previous build (e.g. `SignIn-DE8PRhyt.js`). Those files
// no longer exist on the CDN, so dynamic import() throws. The user can't
// see this — they just hit a blank screen on navigation. Auto-reload the
// page so they get the fresh index.html with current chunk hashes. The
// reload throttle prevents an infinite loop if the failure is something
// else (genuine network error, CSP block, etc.).
const RELOAD_KEY = 'spheroseg.chunkReloadAt';
const RELOAD_THROTTLE_MS = 30_000;

function tryAutoReload(): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return false;
  }
  try {
    const lastRaw = sessionStorage.getItem(RELOAD_KEY);
    const lastAt = lastRaw ? Number(lastRaw) : 0;
    const now = Date.now();
    if (lastAt && now - lastAt < RELOAD_THROTTLE_MS) {
      logger.warn(
        `Skipping auto-reload: last reload was ${Math.round((now - lastAt) / 1000)}s ago`
      );
      return false;
    }
    sessionStorage.setItem(RELOAD_KEY, String(now));
    logger.info('Auto-reloading to recover from stale chunk reference');
    window.location.reload();
    return true;
  } catch {
    // sessionStorage unavailable (Safari private mode, quota) — skip
    // throttling but still reload, accepting the small loop risk.
    window.location.reload();
    return true;
  }
}

// Recognise the dynamic-import failure across browsers. Each browser
// emits its own wording for the same underlying chunk-not-found case;
// missing any of them means the user is stuck on a stale tab forever.
//   Chrome:  "Failed to fetch dynamically imported module: <url>"
//   Firefox: "error loading dynamically imported module: <url>"
//   Safari:  "Importing a module script failed."
function isChunkLoadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('ChunkLoadError') ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to import')
  );
}

/**
 * Create a lazy component with automatic retry on import failure
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  componentName?: string
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const result = await retryWithBackoff(importFn, {
      ...RETRY_CONFIGS.dynamicImport,
      shouldRetry: (error, attempt) => {
        if (error instanceof Error && !isChunkLoadFailure(error)) {
          return false; // Don't retry non-network errors
        }
        return attempt < 3;
      },
      onRetry: (error, attempt, nextDelay) => {
        logger.warn(
          `Failed to load ${componentName || 'component'}, retrying...`,
          {
            error,
            attempt,
            nextDelay,
          }
        );

        // Show user feedback on second attempt
        if (attempt === 2) {
          toast.loading(`Loading ${componentName || 'component'}...`, {
            description: 'Having trouble loading resources. Retrying...',
          });
        }
      },
    });

    if (result.success && result.data) {
      toast.dismiss(); // Clear any loading toast
      return result.data;
    }

    // If all retries failed, try one last time with page reload fallback
    logger.error(
      `Failed to load ${componentName || 'component'} after retries`,
      result.error
    );

    // Stale chunks on deploy: reload automatically (throttled) so the
    // user doesn't have to find and click a button to recover. Falls
    // through to the manual toast when throttled or when the error
    // isn't a recognised chunk failure.
    if (isChunkLoadFailure(result.error) && tryAutoReload()) {
      // Reload is in-flight; throw to satisfy lazy() contract — the new
      // page will replace this one before the boundary renders.
      throw result.error;
    }

    // Show error with reload option (fallback when auto-reload is
    // throttled to avoid loops, or for non-chunk errors).
    toast.error(`Failed to load ${componentName || 'component'}`, {
      description: 'Please refresh the page to try again',
      action: {
        label: 'Refresh',
        onClick: () => window.location.reload(),
      },
      duration: Infinity, // Keep showing until user acts
    });

    throw result.error;
  });
}

/**
 * Wrapper component that provides retry UI for lazy loaded components
 */
interface LazyWithRetryWrapperProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  componentName?: string;
}

export const LazyWithRetryWrapper: React.FC<LazyWithRetryWrapperProps> = ({
  children,
  fallback,
  componentName = 'component',
}) => {
  return (
    <React.Suspense
      fallback={
        fallback || (
          <div className="flex items-center justify-center p-4">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
              <span className="text-sm text-gray-600">
                Loading {componentName}...
              </span>
            </div>
          </div>
        )
      }
    >
      {children}
    </React.Suspense>
  );
};

/**
 * Error boundary specifically for lazy imports with retry capability
 */
interface LazyImportErrorBoundaryState {
  hasError: boolean;
  retryCount: number;
}

interface LazyImportErrorBoundaryProps {
  children: React.ReactNode;
  componentName?: string;
  onError?: (error: Error) => void;
}

export class LazyImportErrorBoundary extends React.Component<
  LazyImportErrorBoundaryProps,
  LazyImportErrorBoundaryState
> {
  constructor(props: LazyImportErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, retryCount: 0 };
  }

  static getDerivedStateFromError(_: Error): LazyImportErrorBoundaryState {
    return { hasError: true, retryCount: 0 };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { componentName, onError } = this.props;

    logger.error(
      `LazyImportErrorBoundary caught error in ${componentName || 'component'}`,
      {
        error,
        errorInfo,
      }
    );

    onError?.(error);

    // Chunk load failure → if we haven't reloaded recently, do it now.
    // Otherwise retry in-place with exponential backoff.
    if (isChunkLoadFailure(error)) {
      if (!tryAutoReload()) {
        this.handleRetry();
      }
    }
  }

  handleRetry = () => {
    const { retryCount } = this.state;

    if (retryCount < 3) {
      this.setState({ hasError: false, retryCount: retryCount + 1 });

      // Force re-render after a delay
      setTimeout(
        () => {
          this.forceUpdate();
        },
        Math.pow(2, retryCount) * 1000
      ); // Exponential backoff
    }
  };

  render() {
    const { hasError, retryCount } = this.state;
    const { children, componentName } = this.props;

    if (hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Failed to load {componentName || 'component'}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {retryCount > 0
                ? `Retry attempt ${retryCount} of 3 failed`
                : 'An error occurred while loading the component'}
            </p>
          </div>

          <div className="flex gap-2">
            {retryCount < 3 && (
              <button
                onClick={this.handleRetry}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            )}

            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}

/**
 * Preload a lazy component to avoid loading delays
 */
export function preloadLazyComponent<T extends ComponentType<any>>(
  lazyComponent: React.LazyExoticComponent<T>
): void {
  // Trigger the lazy loading
  const componentPromise =
    (lazyComponent as any)._result || (lazyComponent as any)._ctor?.();

  if (componentPromise && typeof componentPromise.then === 'function') {
    componentPromise.catch((error: Error) => {
      logger.warn('Failed to preload lazy component', error);
    });
  }
}
