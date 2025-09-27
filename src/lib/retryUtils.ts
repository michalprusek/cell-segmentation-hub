/**
 * Unified retry utilities for the Cell Segmentation Hub
 * Provides consistent retry behavior across the application
 */

import { logger } from './logger';

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
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  shouldRetry: (error: unknown, attempt: number) => {
    // Don't retry on client errors (4xx) except 429 (rate limit)
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as any).status;
      if (status >= 400 && status < 500 && status !== 429) {
        return false;
      }
    }

    // Don't retry on abort
    if (error && typeof error === 'object' && 'name' in error) {
      const name = (error as any).name;
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
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
  },
  upload: {
    maxAttempts: 5,
    initialDelay: 2000,
    maxDelay: 60000,
    backoffFactor: 2,
  },
  websocket: {
    maxAttempts: Infinity,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 1.5,
  },
  dynamicImport: {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 5000,
    backoffFactor: 2,
  },
  imageLoad: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
  },
  auth: {
    maxAttempts: 2,
    initialDelay: 500,
    maxDelay: 2000,
    backoffFactor: 2,
  },
} as const;

/**
 * Calculate delay for exponential backoff
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
 */
export function addJitter(delay: number, jitterFactor = 0.1): number {
  const jitter = delay * jitterFactor * Math.random();
  return delay + jitter;
}

/**
 * Sleep utility with cancellation support
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
 * Core retry function with exponential backoff
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
 * Retry with timeout wrapper
 */
export async function retryWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  config: RetryConfig = {}
): Promise<RetryResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await retryWithBackoff(fn, {
      ...config,
      signal: controller.signal,
    });

    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Create a retryable version of a function
 */
export function makeRetryable<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: RetryConfig = {}
): T {
  return (async (...args: Parameters<T>) => {
    const result = await retryWithBackoff(() => fn(...args), config);

    if (result.success) {
      return result.data;
    } else {
      throw result.error;
    }
  }) as T;
}

/**
 * Detect if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  // Timeout errors
  if (error && typeof error === 'object' && 'name' in error) {
    const errorName = (error as any).name;
    if (errorName === 'TimeoutError' || errorName === 'NetworkError') {
      return true;
    }
  }

  // HTTP errors that are retryable
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as any).status;
    // Retry on 429 (rate limit), 503 (service unavailable), 504 (gateway timeout)
    if (status === 429 || status === 503 || status === 504) {
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

/**
 * Circuit breaker for preventing repeated failures
 */
export class CircuitBreaker {
  private failures = new Map<string, { count: number; lastFailure: number }>();
  private readonly threshold: number;
  private readonly timeout: number;

  constructor(threshold = 3, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  recordFailure(key: string): void {
    const current = this.failures.get(key) || { count: 0, lastFailure: 0 };
    this.failures.set(key, {
      count: current.count + 1,
      lastFailure: Date.now(),
    });
  }

  isOpen(key: string): boolean {
    const failure = this.failures.get(key);
    if (!failure) return false;

    // Reset if timeout has passed
    if (Date.now() - failure.lastFailure > this.timeout) {
      this.failures.delete(key);
      return false;
    }

    return failure.count >= this.threshold;
  }

  reset(key?: string): void {
    if (key) {
      this.failures.delete(key);
    } else {
      this.failures.clear();
    }
  }
}

// Global circuit breaker instance
export const globalCircuitBreaker = new CircuitBreaker();
