import { AxiosError } from 'axios';

/**
 * Interface for standardized error structure
 */
export interface ApiError {
  code?: string;
  message: string;
  details?: any;
}

/**
 * Interface for error response from backend
 */
export interface ErrorResponse {
  error?: string;
  message?: string;
  code?: string;
  details?: any;
}

/**
 * Extracts a user-friendly error message from various error types
 *
 * @param error - The error object (can be AxiosError, Error, string, or any object)
 * @param fallbackKey - Translation key to use as fallback
 * @param t - Translation function
 * @returns Object with message and optional code
 */
export function extractErrorMessage(
  error: unknown,
  fallbackKey?: string,
  t?: (key: string) => string
): { message: string; code?: string } {
  // Handle AxiosError (API errors)
  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosError = error as AxiosError<ErrorResponse>;

    // Try to get error message from response data
    const responseData = axiosError.response?.data;
    if (responseData) {
      const message = responseData.error || responseData.message;
      if (message) {
        return {
          message,
          code: responseData.code || `HTTP_${axiosError.response?.status}`,
        };
      }
    }

    // Fallback to axios error message
    if (axiosError.message) {
      return {
        message: axiosError.message,
        code: `HTTP_${axiosError.response?.status || 'NETWORK'}`,
      };
    }
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    return {
      message: error.message,
      code: error.name !== 'Error' ? error.name : undefined,
    };
  }

  // Handle error objects with message property
  if (error && typeof error === 'object') {
    const errorObj = error as any;

    // Try various common error message properties
    const message =
      errorObj.error ||
      errorObj.message ||
      errorObj.data?.error ||
      errorObj.data?.message ||
      errorObj.response?.data?.error ||
      errorObj.response?.data?.message;

    if (message && typeof message === 'string') {
      return {
        message,
        code:
          errorObj.code || errorObj.data?.code || errorObj.response?.data?.code,
      };
    }
  }

  // Handle string errors
  if (typeof error === 'string') {
    return { message: error };
  }

  // Fallback to translation key or generic message
  const fallbackMessage =
    fallbackKey && t ? t(fallbackKey) : 'An unexpected error occurred';

  return {
    message: fallbackMessage,
    code: 'UNKNOWN_ERROR',
  };
}

/**
 * Creates a user-friendly error message with optional details
 *
 * @param error - The error object
 * @param context - Context about where the error occurred
 * @param fallbackKey - Translation key for fallback message
 * @param t - Translation function
 * @returns Formatted error message
 */
export function formatErrorMessage(
  error: unknown,
  context?: string,
  fallbackKey?: string,
  t?: (key: string) => string
): string {
  const { message, code } = extractErrorMessage(error, fallbackKey, t);

  let formattedMessage = message;

  // Add context if provided
  if (context) {
    formattedMessage = `${context}: ${message}`;
  }

  // Add error code for debugging (only in development)
  if (code && process.env.NODE_ENV === 'development') {
    formattedMessage += ` (${code})`;
  }

  return formattedMessage;
}

/**
 * Checks if an error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosError = error as AxiosError;
    return !axiosError.response && !!axiosError.request;
  }

  if (error instanceof Error) {
    return (
      error.message.includes('Network Error') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('timeout')
    );
  }

  return false;
}

/**
 * Checks if an error is a validation error
 */
export function isValidationError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosError = error as AxiosError;
    return (
      axiosError.response?.status === 400 || axiosError.response?.status === 422
    );
  }

  return false;
}

/**
 * Checks if an error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosError = error as AxiosError;
    return (
      axiosError.response?.status === 401 || axiosError.response?.status === 403
    );
  }

  return false;
}

/**
 * Gets appropriate translation key based on error type
 */
export function getErrorTranslationKey(error: unknown): string {
  if (isNetworkError(error)) {
    return 'errors.network';
  }

  if (isAuthError(error)) {
    return 'errors.unauthorized';
  }

  if (isValidationError(error)) {
    return 'errors.validation';
  }

  return 'errors.general';
}

/**
 * Enhanced error message extractor with translation support
 * This is the main function components should use
 */
export function getLocalizedErrorMessage(
  error: unknown,
  t: (key: string) => string,
  context?: string
): string {
  // First try to extract the actual error message
  const { message } = extractErrorMessage(error);

  // If we have a specific error message from the server, use it
  // But still apply context if provided
  if (message && message !== 'An unexpected error occurred') {
    return context ? `${t(context)}: ${message}` : message;
  }

  // Otherwise use appropriate translation based on error type
  const translationKey = getErrorTranslationKey(error);
  let localizedMessage = t(translationKey);

  // Add context if provided
  if (context) {
    localizedMessage = `${t(context)}: ${localizedMessage}`;
  }

  return localizedMessage;
}
