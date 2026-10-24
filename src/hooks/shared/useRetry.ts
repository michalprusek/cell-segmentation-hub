/**
 * Universal retry hook for React components
 * Provides retry functionality with loading states and error handling
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
} from 'react';
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

  // Merge preset config if provided. Wrap in useMemo to keep stable reference
  // for downstream useCallback hooks; otherwise the config object would change
  // every render and cause `execute` to re-create on every render.
  const finalConfig = useMemo(
    () => (preset ? { ...RETRY_CONFIGS[preset], ...retryConfig } : retryConfig),
    [preset, retryConfig]
  );

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
 * Hook for retrying image loads with fallback URLs
 */
export function useRetryImage(urls: string[]) {
  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  // A new candidate list starts from its first entry. The list changes when
  // the server hands out a new preview URL (every segmentation edit does), and
  // without this a card whose previous preview had failed stayed on its
  // fallback — or on "no preview" — and never tried the new one. Adjusted
  // during render, React's documented pattern for state derived from props,
  // so the stale index is never rendered.
  const urlsKey = urls.join('\n');
  const [loadedKey, setLoadedKey] = useState(urlsKey);
  if (loadedKey !== urlsKey) {
    setLoadedKey(urlsKey);
    setCurrentUrlIndex(0);
    setImageError(false);
  }

  // The list a load was started for. A result that arrives after the list
  // changed belongs to a picture nobody shows any more and is dropped —
  // otherwise a late failure of the OLD preview marks the NEW one as broken.
  const latestKeyRef = useRef(urlsKey);
  useLayoutEffect(() => {
    latestKeyRef.current = urlsKey;
  }, [urlsKey]);

  // No `onFailure` here: the failure is acted on once, below. It used to be
  // acted on in both places, so one failed preview advanced the index TWICE
  // and skipped the upload thumbnail — straight to the full-size original.
  const { execute, loading, retrying, attempt, nextRetryIn } = useRetry<string>(
    { preset: 'imageLoad', showToast: false }
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
    const key = urlsKey;
    const index = currentUrlIndex;
    if (index >= urls.length) {
      setImageError(true);
      return;
    }

    const result = await execute(() => loadImage(urls[index]));
    if (result.success || latestKeyRef.current !== key) {
      return;
    }
    if (index < urls.length - 1) {
      setCurrentUrlIndex(index + 1);
    } else {
      setImageError(true);
    }
  }, [currentUrlIndex, urls, urlsKey, execute, loadImage]);

  useEffect(() => {
    if (urls.length > 0 && currentUrlIndex < urls.length) {
      tryLoadImage();
    }
  }, [currentUrlIndex, urlsKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
