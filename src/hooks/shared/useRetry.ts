/**
 * Universal retry hook for React components
 * Provides retry functionality with loading states and error handling
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useLanguage } from '@/contexts/exports';
import { toast } from 'sonner';
import {
  RetryConfig,
  retryWithBackoff,
  RetryResult,
  RETRY_CONFIGS,
} from '@/lib/retryUtils';
import { useAbortController } from './useAbortController';
import { logger } from '@/lib/logger';

export interface UseRetryOptions<T> extends RetryConfig {
  /** Preset configuration to use */
  preset?: keyof typeof RETRY_CONFIGS;
  /** Show toast notifications on retry */
  showToast?: boolean;
  /** Show loading state during retries */
  showLoading?: boolean;
  /** Custom error message */
  errorMessage?: string;
  /** Custom success message */
  successMessage?: string;
  /** Callback on successful completion */
  onSuccess?: (data: T) => void;
  /** Callback on failure after all retries */
  onFailure?: (error: unknown) => void;
  /** Transform error for display */
  formatError?: (error: unknown) => string;
}

export interface UseRetryState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  retrying: boolean;
  attempt: number;
  maxAttempts: number;
  nextRetryIn: number | null;
}

export interface UseRetryReturn<T> extends UseRetryState<T> {
  execute: (fn: () => Promise<T>) => Promise<RetryResult<T>>;
  reset: () => void;
  cancel: () => void;
  retry: () => Promise<void>;
}

/**
 * Hook for retryable operations with UI feedback
 */
export function useRetry<T>(
  options: UseRetryOptions<T> = {}
): UseRetryReturn<T> {
  const { t } = useLanguage();
  const { getSignal, abort } = useAbortController();

  const {
    preset,
    showToast = true,
    showLoading = true,
    errorMessage,
    successMessage,
    onSuccess,
    onFailure,
    formatError,
    ...retryConfig
  } = options;

  // Merge preset config if provided
  const finalConfig = preset
    ? { ...RETRY_CONFIGS[preset], ...retryConfig }
    : retryConfig;

  const [state, setState] = useState<UseRetryState<T>>({
    data: null,
    error: null,
    loading: false,
    retrying: false,
    attempt: 0,
    maxAttempts: finalConfig.maxAttempts || 3,
    nextRetryIn: null,
  });

  const fnRef = useRef<(() => Promise<T>) | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const toastIdRef = useRef<string | number | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
      }
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
      }
    };
  }, []);

  const reset = useCallback(() => {
    setState({
      data: null,
      error: null,
      loading: false,
      retrying: false,
      attempt: 0,
      maxAttempts: finalConfig.maxAttempts || 3,
      nextRetryIn: null,
    });

    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (toastIdRef.current) {
      toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, [finalConfig.maxAttempts]);

  const cancel = useCallback(() => {
    abort();
    reset();
  }, [abort, reset]);

  const handleRetry = useCallback(
    (error: unknown, attempt: number, nextDelay: number) => {
      setState(prev => ({
        ...prev,
        retrying: true,
        attempt,
        nextRetryIn: Math.ceil(nextDelay / 1000),
      }));

      // Show toast notification
      if (showToast && attempt > 1) {
        const message =
          formatError?.(error) ||
          errorMessage ||
          t('common.retryAttempt', {
            attempt,
            max: finalConfig.maxAttempts || 3,
          });

        if (toastIdRef.current) {
          toast.dismiss(toastIdRef.current);
        }

        toastIdRef.current = toast.loading(message, {
          description: t('common.retryingIn', {
            seconds: Math.ceil(nextDelay / 1000),
          }),
        });
      }

      // Update countdown
      let remaining = Math.ceil(nextDelay / 1000);
      retryTimerRef.current = setInterval(() => {
        remaining--;
        setState(prev => ({
          ...prev,
          nextRetryIn: remaining > 0 ? remaining : null,
        }));

        if (remaining <= 0 && retryTimerRef.current) {
          clearInterval(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      }, 1000);
    },
    [showToast, formatError, errorMessage, t, finalConfig.maxAttempts]
  );

  const execute = useCallback(
    async (fn: () => Promise<T>): Promise<RetryResult<T>> => {
      fnRef.current = fn;

      setState(prev => ({
        ...prev,
        loading: showLoading,
        retrying: false,
        error: null,
        attempt: 0,
        nextRetryIn: null,
      }));

      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }

      try {
        const result = await retryWithBackoff(fn, {
          ...finalConfig,
          signal: getSignal(),
          onRetry: handleRetry,
        });

        if (result.success && result.data) {
          setState(prev => ({
            ...prev,
            data: result.data,
            loading: false,
            retrying: false,
            error: null,
            attempt: result.attempts,
          }));

          if (showToast && successMessage) {
            toast.success(successMessage);
          }

          if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            toastIdRef.current = null;
          }

          onSuccess?.(result.data);
        } else {
          setState(prev => ({
            ...prev,
            error: result.error,
            loading: false,
            retrying: false,
            attempt: result.attempts,
          }));

          if (showToast) {
            const message =
              formatError?.(result.error) ||
              errorMessage ||
              t('common.operationFailed');

            if (toastIdRef.current) {
              toast.error(message, { id: toastIdRef.current });
              toastIdRef.current = null;
            } else {
              toast.error(message);
            }
          }

          onFailure?.(result.error);
        }

        return result;
      } catch (error) {
        // Handle unexpected errors
        logger.error('Unexpected error in retry execution', error);

        setState(prev => ({
          ...prev,
          error,
          loading: false,
          retrying: false,
        }));

        if (showToast) {
          toast.error(t('common.unexpectedError'));
        }

        return {
          error,
          attempts: state.attempt,
          success: false,
        };
      }
    },
    [
      finalConfig,
      getSignal,
      handleRetry,
      showLoading,
      showToast,
      successMessage,
      errorMessage,
      formatError,
      t,
      onSuccess,
      onFailure,
      state.attempt,
    ]
  );

  const retry = useCallback(async () => {
    if (fnRef.current) {
      return execute(fnRef.current).then(() => undefined);
    }
  }, [execute]);

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    retrying: state.retrying,
    attempt: state.attempt,
    maxAttempts: state.maxAttempts,
    nextRetryIn: state.nextRetryIn,
    execute,
    reset,
    cancel,
    retry,
  };
}

/**
 * Hook for retrying failed dynamic imports
 */
export function useRetryImport() {
  const { execute } = useRetry({
    preset: 'dynamicImport',
    showToast: true,
    errorMessage: 'Failed to load module. Retrying...',
  });

  const retryImport = useCallback(
    async <T>(importFn: () => Promise<{ default: T }>): Promise<T> => {
      const result = await execute(importFn);

      if (result.success && result.data) {
        return result.data.default;
      }

      // Fallback - reload the page
      window.location.reload();
      throw result.error;
    },
    [execute]
  );

  return retryImport;
}

/**
 * Hook for retrying image loads with fallback URLs
 */
export function useRetryImage(urls: string[]) {
  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  const { execute, loading, retrying, attempt, nextRetryIn } = useRetry<string>(
    {
      preset: 'imageLoad',
      showToast: false,
      onFailure: () => {
        // Try next URL if available
        if (currentUrlIndex < urls.length - 1) {
          setCurrentUrlIndex(prev => prev + 1);
        } else {
          setImageError(true);
        }
      },
    }
  );

  const loadImage = useCallback(async (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }, []);

  const tryLoadImage = useCallback(async () => {
    if (currentUrlIndex >= urls.length) {
      setImageError(true);
      return;
    }

    const result = await execute(() => loadImage(urls[currentUrlIndex]));

    if (!result.success && currentUrlIndex < urls.length - 1) {
      // Try next URL
      setCurrentUrlIndex(prev => prev + 1);
    } else if (!result.success) {
      setImageError(true);
    }
  }, [currentUrlIndex, urls, execute, loadImage]);

  useEffect(() => {
    if (urls.length > 0 && currentUrlIndex < urls.length) {
      tryLoadImage();
    }
  }, [currentUrlIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    currentUrl: urls[currentUrlIndex],
    loading,
    retrying,
    attempt,
    nextRetryIn,
    imageError,
    retry: tryLoadImage,
  };
}
