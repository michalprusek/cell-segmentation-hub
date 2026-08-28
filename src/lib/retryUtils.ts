/**
 * Unified retry utilities for the Cell Segmentation Hub
 * Provides consistent retry behavior across the application
 */

import { logger } from './logger';
import { TIMEOUTS, RETRY_ATTEMPTS, HTTP_STATUS } from './constants';

export interface RetryConfig {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, nextDelay: number) => void;
  signal?: AbortSignal;
}

export interface RetryResult<T> {
  data?: T;
  error?: unknown;
  attempts: number;
  success: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: Required<
  Omit<RetryConfig, 'signal' | 'onRetry'>
> = {
  maxAttempts: RETRY_ATTEMPTS.API,
  initialDelay: TIMEOUTS.RETRY_INITIAL,
  maxDelay: TIMEOUTS.RETRY_MAX,
  backoffFactor: 2,
  shouldRetry: (error: unknown, attempt: number) => {
    // Don't retry on client errors (4xx) except 429 (rate limit)
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        return false;
      }
    }

    // Don't retry on abort
    if (error && typeof error === 'object' && 'name' in error) {
      const name = (error as { name?: string }).name;
      if (name === 'AbortError' || name === 'CanceledError') {
        return false;
      }
    }

    return attempt < DEFAULT_RETRY_CONFIG.maxAttempts;
  },
};

/**
 * Retry configurations for different operation types
 */
export const RETRY_CONFIGS = {
  api: {
    maxAttempts: RETRY_ATTEMPTS.API,
    initialDelay: TIMEOUTS.RETRY_INITIAL,
    maxDelay: TIMEOUTS.API_REQUEST_LONG,
    backoffFactor: 2,
  },
  upload: {
    maxAttempts: RETRY_ATTEMPTS.UPLOAD,
    initialDelay: TIMEOUTS.RETRY_SHORT,
    maxDelay: TIMEOUTS.FILE_UPLOAD_RETRY_MAX_DELAY,
    backoffFactor: 2,
  },
  websocket: {
    maxAttempts: RETRY_ATTEMPTS.WEBSOCKET,
    initialDelay: TIMEOUTS.RETRY_INITIAL,
    maxDelay: TIMEOUTS.RETRY_MAX,
    backoffFactor: 1.5,
  },
  dynamicImport: {
    maxAttempts: RETRY_ATTEMPTS.API,
    initialDelay: 500,
    maxDelay: TIMEOUTS.API_REQUEST,
    backoffFactor: 2,
  },
  imageLoad: {
    maxAttempts: RETRY_ATTEMPTS.API,
    initialDelay: TIMEOUTS.RETRY_INITIAL,
    maxDelay: TIMEOUTS.API_REQUEST_LONG,
    backoffFactor: 2,
  },
  auth: {
    maxAttempts: RETRY_ATTEMPTS.AUTH,
    initialDelay: 500,
    maxDelay: TIMEOUTS.RETRY_SHORT,
    backoffFactor: 2,
  },
} as const;

/**
 * Calculate delay for exponential backoff with configurable parameters
 * @param attempt - The current attempt number (1-indexed)
 * @param config - Configuration object containing delay parameters
 * @returns Calculated delay in milliseconds, capped at maxDelay
 * @example
 * // First attempt: 1000ms, Second: 2000ms, Third: 4000ms (capped at maxDelay)
 * calculateBackoffDelay(1, { initialDelay: 1000, maxDelay: 5000, backoffFactor: 2 })
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Pick<RetryConfig, 'initialDelay' | 'maxDelay' | 'backoffFactor'>
): number {
  const { initialDelay = 1000, maxDelay = 30000, backoffFactor = 2 } = config;
  const delay = initialDelay * Math.pow(backoffFactor, attempt - 1);
  return Math.min(delay, maxDelay);
}

/**
 * Add jitter to delay to avoid thundering herd problem
 * @param delay - Base delay in milliseconds
 * @param jitterFactor - Percentage of delay to use as maximum jitter (0.1 = 10%)
 * @returns Delay with random jitter added
 * @example
 * // Adds 0-100ms of jitter to a 1000ms delay
 * addJitter(1000, 0.1) // Returns between 1000-1100ms
 */
export function addJitter(delay: number, jitterFactor = 0.1): number {
  const jitter = delay * jitterFactor * Math.random();
  return delay + jitter;
}

/**
 * Sleep utility with cancellation support via AbortSignal
 * @param ms - Milliseconds to sleep
 * @param signal - Optional AbortSignal to cancel the sleep
 * @returns Promise that resolves after the specified time or rejects if aborted
 * @throws {DOMException} Throws 'AbortError' if the signal is aborted
 * @example
 * const controller = new AbortController();
 * await sleep(5000, controller.signal); // Sleep for 5 seconds
 * controller.abort(); // Cancel the sleep early
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    const handleAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

/**
 * Core retry function with exponential backoff and configurable parameters
 * @param fn - The async function to retry
 * @param config - Configuration for retry behavior
 * @returns Result object containing data or error with attempt count
 * @example
 * const result = await retryWithBackoff(
 *   () => fetch('/api/data'),
 *   { maxAttempts: 3, initialDelay: 1000 }
 * );
 * if (result.success) {
 *   logger.debug('Success after', result.attempts, 'attempts');
 * }
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<RetryResult<T>> {
  const mergedConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const { maxAttempts, signal, onRetry, shouldRetry } = mergedConfig;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Check if aborted before attempting
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const data = await fn();

      logger.debug('Retry operation succeeded', {
        attempt,
        totalAttempts: maxAttempts,
      });

      return {
        data,
        attempts: attempt,
        success: true,
      };
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!shouldRetry(error, attempt)) {
        logger.warn('Retry operation failed - not retrying', {
          error,
          attempt,
          totalAttempts: maxAttempts,
        });
        break;
      }

      // Don't delay after the last attempt
      if (attempt < maxAttempts) {
        const delay = calculateBackoffDelay(attempt, mergedConfig);
        const jitteredDelay = addJitter(delay);

        logger.debug('Retry operation failed - retrying', {
          error,
          attempt,
          totalAttempts: maxAttempts,
          nextDelay: jitteredDelay,
        });

        // Call onRetry callback if provided
        onRetry?.(error, attempt, jitteredDelay);

        try {
          await sleep(jitteredDelay, signal);
        } catch (abortError) {
          // If sleep was aborted, return the abort error
          return {
            error: abortError,
            attempts: attempt,
            success: false,
          };
        }
      } else {
        logger.error('Retry operation failed - max attempts reached', {
          error,
          attempts: maxAttempts,
        });
      }
    }
  }

  return {
    error: lastError,
    attempts: maxAttempts,
    success: false,
  };
}

/**
 * Detect if an error is retryable based on type and status code
 * @param error - The error to evaluate
 * @returns True if the error should trigger a retry attempt
 * @example
 * try {
 *   await apiCall();
 * } catch (error) {
 *   if (isRetryableError(error)) {
 *     // Retry the operation
 *   }
 * }
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  // Timeout errors
  if (typeof error === 'object' && 'name' in error) {
    const errorName = (error as { name?: string }).name;
    if (errorName === 'TimeoutError' || errorName === 'NetworkError') {
      return true;
    }
  }

  // HTTP errors that are retryable
  if (typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: number }).status;
    // Retry on rate limit, bad gateway, service unavailable, gateway timeout
    if (
      status === HTTP_STATUS.TOO_MANY_REQUESTS ||
      status === HTTP_STATUS.BAD_GATEWAY ||
      status === HTTP_STATUS.SERVICE_UNAVAILABLE ||
      status === HTTP_STATUS.GATEWAY_TIMEOUT
    ) {
      return true;
    }
  }

  // Dynamic import errors
  if (error instanceof Error) {
    if (
      error.message.includes('Failed to fetch dynamically imported module') ||
      error.message.includes('ChunkLoadError') ||
      error.message.includes('Loading chunk')
    ) {
      return true;
    }
  }

  return false;
}
