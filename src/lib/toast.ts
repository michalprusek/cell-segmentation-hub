import { toast as sonnerToast } from 'sonner';

export type ToastFunction = (
  message: string,
  options?: Parameters<typeof sonnerToast.error>[1]
) => void;

/**
 * Centralized toast utility for consistent localized messaging
 *
 * This utility provides a single interface for toast notifications that:
 * - Ensures consistent error handling
 * - Provides fallback messages for missing translations
 * - Maintains the same API as sonner for easy migration
 */
export const toast = {
  /**
   * Show success toast message
   */
  success: (
    message: string,
    options?: Parameters<typeof sonnerToast.success>[1]
  ) => {
    sonnerToast.success(message, options);
  },

  /**
   * Show error toast message
   */
  error: (
    message: string,
    options?: Parameters<typeof sonnerToast.error>[1]
  ) => {
    sonnerToast.error(message, options);
  },

  /**
   * Show info toast message
   */
  info: (message: string, options?: Parameters<typeof sonnerToast.info>[1]) => {
    sonnerToast.info(message, options);
  },

  /**
   * Show warning toast message
   */
  warning: (
    message: string,
    options?: Parameters<typeof sonnerToast.warning>[1]
  ) => {
    sonnerToast.warning(message, options);
  },

  /**
   * Show loading toast message
   */
  loading: (
    message: string,
    options?: Parameters<typeof sonnerToast.loading>[1]
  ) => {
    return sonnerToast.loading(message, options);
  },

  /**
   * Dismiss a toast by ID
   */
  dismiss: (toastId?: string | number) => {
    sonnerToast.dismiss(toastId);
  },

  /**
   * Promise-based toast for async operations
   */
  promise: sonnerToast.promise,
};

/**
 * Helper to create localized toast messages with fallbacks
 *
 * @param translationFunction - The t() function from useLanguage
 * @param key - Translation key
 * @param fallback - Fallback message if translation is missing
 * @returns Object with localized toast methods
 */
export const createLocalizedToast = (
  translationFunction: (key: string) => string,
  fallback?: {
    error?: string;
    success?: string;
    info?: string;
    warning?: string;
  }
) => ({
  success: (
    key: string,
    options?: Parameters<typeof sonnerToast.success>[1]
  ) => {
    const message = translationFunction(key) || fallback?.success || key;
    toast.success(message, options);
  },

  error: (key: string, options?: Parameters<typeof sonnerToast.error>[1]) => {
    const message = translationFunction(key) || fallback?.error || key;
    toast.error(message, options);
  },

  info: (key: string, options?: Parameters<typeof sonnerToast.info>[1]) => {
    const message = translationFunction(key) || fallback?.info || key;
    toast.info(message, options);
  },

  warning: (
    key: string,
    options?: Parameters<typeof sonnerToast.warning>[1]
  ) => {
    const message = translationFunction(key) || fallback?.warning || key;
    toast.warning(message, options);
  },

  loading: (
    key: string,
    options?: Parameters<typeof sonnerToast.loading>[1]
  ) => {
    const message = translationFunction(key) || fallback?.info || key;
    return toast.loading(message, options);
  },
});

/**
 * Hook for localized toasts
 * Use this in React components that need localized toast messages
 */
export const useLocalizedToast = (
  useLanguageHook: () => { t: (key: string) => string }
) => {
  const { t } = useLanguageHook();

  return createLocalizedToast(t, {
    error: 'An error occurred',
    success: 'Operation successful',
    info: 'Information',
    warning: 'Warning',
  });
};
