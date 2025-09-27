/**
 * Enhanced lazy loading with automatic retry mechanism
 * Handles dynamic import failures gracefully with user feedback
 */

import React, { lazy, ComponentType, Suspense } from 'react';
import { retryWithBackoff, RETRY_CONFIGS } from './retryUtils';
import { logger } from './logger';
import { toast } from 'sonner';

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
        // Check if it's a chunk load error
        if (error instanceof Error) {
          const isChunkError =
            error.message.includes(
              'Failed to fetch dynamically imported module'
            ) ||
            error.message.includes('ChunkLoadError') ||
            error.message.includes('Loading chunk') ||
            error.message.includes('Failed to import');

          if (!isChunkError) {
            return false; // Don't retry non-network errors
          }
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

    // Show error with reload option
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

    // Check if it's a chunk load error
    if (
      error.message.includes('Failed to fetch dynamically imported module') ||
      error.message.includes('ChunkLoadError') ||
      error.message.includes('Loading chunk')
    ) {
      // Attempt automatic retry
      this.handleRetry();
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
