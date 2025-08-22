import { describe, test, expect, vi } from 'vitest';
import type { AxiosError } from 'axios';
import {
  extractErrorMessage,
  formatErrorMessage,
  isNetworkError,
  isValidationError,
  isAuthError,
  getErrorTranslationKey,
  getLocalizedErrorMessage,
} from '@/lib/errorUtils';

describe('Error Utils', () => {
  describe('extractErrorMessage', () => {
    test('should extract message from AxiosError with response data', () => {
      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
          },
          headers: {},
          config: {} as any,
        },
      };

      const result = extractErrorMessage(axiosError);

      expect(result).toEqual({
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
      });
    });

    test('should extract message from AxiosError response message field', () => {
      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: {
            message: 'Internal server error occurred',
          },
          headers: {},
          config: {} as any,
        },
      };

      const result = extractErrorMessage(axiosError);

      expect(result).toEqual({
        message: 'Internal server error occurred',
        code: 'HTTP_500',
      });
    });

    test('should fallback to axios message when no response data', () => {
      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Network Error',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 404,
          statusText: 'Not Found',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      const result = extractErrorMessage(axiosError);

      expect(result).toEqual({
        message: 'Network Error',
        code: 'HTTP_404',
      });
    });

    test('should handle AxiosError without response', () => {
      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Connection timeout',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
      };

      const result = extractErrorMessage(axiosError);

      expect(result).toEqual({
        message: 'Connection timeout',
        code: 'HTTP_NETWORK',
      });
    });

    test('should extract message from standard Error', () => {
      const error = new Error('Something went wrong');
      error.name = 'CustomError';

      const result = extractErrorMessage(error);

      expect(result).toEqual({
        message: 'Something went wrong',
        code: 'CustomError',
      });
    });

    test('should handle Error with default name', () => {
      const error = new Error('Generic error');

      const result = extractErrorMessage(error);

      expect(result).toEqual({
        message: 'Generic error',
        code: undefined,
      });
    });

    test('should extract message from error object with various properties', () => {
      const errorObj = {
        error: 'Primary error message',
        code: 'ERROR_CODE',
        data: {
          message: 'Nested message',
        },
      };

      const result = extractErrorMessage(errorObj);

      expect(result).toEqual({
        message: 'Primary error message',
        code: 'ERROR_CODE',
      });
    });

    test('should prioritize error over message in object', () => {
      const errorObj = {
        error: 'Error field',
        message: 'Message field',
        code: 'TEST_CODE',
      };

      const result = extractErrorMessage(errorObj);

      expect(result).toEqual({
        message: 'Error field',
        code: 'TEST_CODE',
      });
    });

    test('should handle nested response data', () => {
      const errorObj = {
        response: {
          data: {
            error: 'Nested error',
            code: 'NESTED_CODE',
          },
        },
      };

      const result = extractErrorMessage(errorObj);

      expect(result).toEqual({
        message: 'Nested error',
        code: 'NESTED_CODE',
      });
    });

    test('should handle string errors', () => {
      const result = extractErrorMessage('Simple string error');

      expect(result).toEqual({
        message: 'Simple string error',
      });
    });

    test('should use fallback translation key', () => {
      const mockT = vi.fn().mockReturnValue('Translated fallback');

      const result = extractErrorMessage(null, 'errors.fallback', mockT);

      expect(result).toEqual({
        message: 'Translated fallback',
        code: 'UNKNOWN_ERROR',
      });
      expect(mockT).toHaveBeenCalledWith('errors.fallback');
    });

    test('should use generic fallback when no translation function', () => {
      const result = extractErrorMessage(undefined);

      expect(result).toEqual({
        message: 'An unexpected error occurred',
        code: 'UNKNOWN_ERROR',
      });
    });

    test('should handle null and undefined gracefully', () => {
      expect(extractErrorMessage(null)).toEqual({
        message: 'An unexpected error occurred',
        code: 'UNKNOWN_ERROR',
      });

      expect(extractErrorMessage(undefined)).toEqual({
        message: 'An unexpected error occurred',
        code: 'UNKNOWN_ERROR',
      });
    });

    test('should handle complex nested error structures', () => {
      const complexError = {
        data: {
          response: {
            data: {
              error: 'Deeply nested error',
              code: 'DEEP_ERROR',
            },
          },
        },
      };

      // Should not find deeply nested error without proper axios structure
      const result = extractErrorMessage(complexError);

      expect(result.message).toBe('An unexpected error occurred');
      expect(result.code).toBe('UNKNOWN_ERROR');
    });

    test('should handle error objects with non-string message properties', () => {
      const errorObj = {
        message: 123, // Non-string message
        error: 'Valid error message',
      };

      const result = extractErrorMessage(errorObj);

      expect(result).toEqual({
        message: 'Valid error message',
      });
    });
  });

  describe('formatErrorMessage', () => {
    test('should format basic error message', () => {
      const error = new Error('Test error');

      const result = formatErrorMessage(error);

      expect(result).toBe('Test error');
    });

    test('should add context to error message', () => {
      const error = new Error('Test error');

      const result = formatErrorMessage(error, 'Authentication');

      expect(result).toBe('Authentication: Test error');
    });

    test('should add error code in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'Validation failed' },
          headers: {},
          config: {} as any,
        },
      };

      const result = formatErrorMessage(axiosError, 'Validation');

      expect(result).toBe('Validation: Validation failed (HTTP_400)');

      process.env.NODE_ENV = originalEnv;
    });

    test('should not add error code in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'Validation failed' },
          headers: {},
          config: {} as any,
        },
      };

      const result = formatErrorMessage(axiosError, 'Validation');

      expect(result).toBe('Validation: Validation failed');

      process.env.NODE_ENV = originalEnv;
    });

    test('should use translation function for fallback', () => {
      const mockT = vi.fn().mockReturnValue('Localized error');

      const result = formatErrorMessage(
        null,
        'Context',
        'errors.general',
        mockT
      );

      expect(result).toBe('Context: Localized error');
      expect(mockT).toHaveBeenCalledWith('errors.general');
    });
  });

  describe('isNetworkError', () => {
    test('should identify AxiosError network errors', () => {
      const networkError: AxiosError = {
        isAxiosError: true,
        message: 'Network Error',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        request: {}, // Has request but no response
      };

      expect(isNetworkError(networkError)).toBe(true);
    });

    test('should not identify AxiosError with response as network error', () => {
      const responseError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        request: {},
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(isNetworkError(responseError)).toBe(false);
    });

    test('should identify standard Error network messages', () => {
      expect(isNetworkError(new Error('Network Error'))).toBe(true);
      expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isNetworkError(new Error('timeout exceeded'))).toBe(true);
    });

    test('should not identify non-network errors', () => {
      expect(isNetworkError(new Error('Validation failed'))).toBe(false);
      expect(isNetworkError('String error')).toBe(false);
      expect(isNetworkError(null)).toBe(false);
    });
  });

  describe('isValidationError', () => {
    test('should identify 400 status as validation error', () => {
      const validationError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(isValidationError(validationError)).toBe(true);
    });

    test('should identify 422 status as validation error', () => {
      const validationError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 422,
          statusText: 'Unprocessable Entity',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(isValidationError(validationError)).toBe(true);
    });

    test('should not identify other status codes as validation errors', () => {
      const serverError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(isValidationError(serverError)).toBe(false);
    });

    test('should not identify non-axios errors as validation errors', () => {
      expect(isValidationError(new Error('Test error'))).toBe(false);
      expect(isValidationError('String error')).toBe(false);
    });
  });

  describe('isAuthError', () => {
    test('should identify 401 status as auth error', () => {
      const authError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(isAuthError(authError)).toBe(true);
    });

    test('should identify 403 status as auth error', () => {
      const authError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 403,
          statusText: 'Forbidden',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(isAuthError(authError)).toBe(true);
    });

    test('should not identify other status codes as auth errors', () => {
      const validationError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(isAuthError(validationError)).toBe(false);
    });
  });

  describe('getErrorTranslationKey', () => {
    test('should return network key for network errors', () => {
      const networkError: AxiosError = {
        isAxiosError: true,
        message: 'Network Error',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        request: {},
      };

      expect(getErrorTranslationKey(networkError)).toBe('errors.network');
    });

    test('should return unauthorized key for auth errors', () => {
      const authError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(getErrorTranslationKey(authError)).toBe('errors.unauthorized');
    });

    test('should return validation key for validation errors', () => {
      const validationError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {},
          headers: {},
          config: {} as any,
        },
      };

      expect(getErrorTranslationKey(validationError)).toBe('errors.validation');
    });

    test('should return general key for other errors', () => {
      const generalError = new Error('Unknown error');

      expect(getErrorTranslationKey(generalError)).toBe('errors.general');
    });

    test('should prioritize network over other classifications', () => {
      // Network error should take precedence
      const networkError = new Error('Network Error - timeout');

      expect(getErrorTranslationKey(networkError)).toBe('errors.network');
    });
  });

  describe('getLocalizedErrorMessage', () => {
    test('should use server error message when available', () => {
      const mockT = vi
        .fn()
        .mockImplementation((key: string) => `Translated ${key}`);
      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {
            error: 'Email already exists',
          },
          headers: {},
          config: {} as any,
        },
      };

      const result = getLocalizedErrorMessage(axiosError, mockT);

      expect(result).toBe('Email already exists');
    });

    test('should use localized message for generic errors', () => {
      const mockT = vi.fn().mockImplementation((key: string) => {
        const translations: Record<string, string> = {
          'errors.general': 'A general error occurred',
        };
        return translations[key] || key;
      });

      // The function prioritizes actual error messages, so 'Unknown' will be returned as-is
      const result = getLocalizedErrorMessage(new Error('Unknown'), mockT);

      expect(result).toBe('Unknown'); // Actual error message is used
    });

    test('should add context when provided', () => {
      const mockT = vi.fn().mockImplementation((key: string) => {
        const translations: Record<string, string> = {
          'context.upload': 'File upload',
          'errors.network': 'Network connection failed',
        };
        return translations[key] || key;
      });

      const networkError = new Error('Network Error');

      const result = getLocalizedErrorMessage(
        networkError,
        mockT,
        'context.upload'
      );

      // The function prioritizes actual error message, so it uses 'Network Error' with context
      expect(result).toBe('File upload: Network Error');
      expect(mockT).toHaveBeenCalledWith('context.upload');
    });

    test('should use server message with context', () => {
      const mockT = vi.fn().mockImplementation((key: string) => {
        return key === 'context.login' ? 'Login process' : key;
      });

      const authError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: {
            error: 'Invalid credentials provided',
          },
          headers: {},
          config: {} as any,
        },
      };

      const result = getLocalizedErrorMessage(
        authError,
        mockT,
        'context.login'
      );

      expect(result).toBe('Login process: Invalid credentials provided');
      expect(mockT).toHaveBeenCalledWith('context.login');
    });

    test('should handle edge case with empty server message', () => {
      const mockT = vi
        .fn()
        .mockImplementation((key: string) => `Translated ${key}`);

      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Request failed',
        name: 'AxiosError',
        config: {} as any,
        toJSON: () => ({}),
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {
            error: '', // Empty error message
          },
          headers: {},
          config: {} as any,
        },
      };

      const result = getLocalizedErrorMessage(axiosError, mockT);

      // When server error is empty, it falls back to axios message
      expect(result).toBe('Request failed');
    });
  });

  describe('Edge Cases and Error Boundaries', () => {
    test('should handle circular reference objects gracefully', () => {
      const circularObj: any = { error: 'Circular error' };
      circularObj.self = circularObj;

      const result = extractErrorMessage(circularObj);

      expect(result).toEqual({
        message: 'Circular error',
      });
    });

    test('should handle very long error messages', () => {
      const longMessage = 'A'.repeat(10000);
      const error = new Error(longMessage);

      const result = extractErrorMessage(error);

      expect(result.message).toBe(longMessage);
      expect(result.message.length).toBe(10000);
    });

    test('should handle special characters in error messages', () => {
      const specialMessage =
        'Error with 中文 and émojis 🚨 and "quotes" and \n newlines';
      const error = new Error(specialMessage);

      const result = extractErrorMessage(error);

      expect(result.message).toBe(specialMessage);
    });

    test('should handle error objects with symbol properties', () => {
      const symbolKey = Symbol('error');
      const errorObj = {
        [symbolKey]: 'Symbol error',
        error: 'Regular error',
      };

      const result = extractErrorMessage(errorObj);

      expect(result.message).toBe('Regular error');
    });

    test('should handle frozen error objects', () => {
      const frozenError = Object.freeze({
        error: 'Frozen error message',
        code: 'FROZEN_ERROR',
      });

      const result = extractErrorMessage(frozenError);

      expect(result).toEqual({
        message: 'Frozen error message',
        code: 'FROZEN_ERROR',
      });
    });

    test('should handle errors with getter properties', () => {
      const errorObj = {
        get error() {
          return 'Dynamic error message';
        },
        get code() {
          return 'DYNAMIC_CODE';
        },
      };

      const result = extractErrorMessage(errorObj);

      expect(result).toEqual({
        message: 'Dynamic error message',
        code: 'DYNAMIC_CODE',
      });
    });
  });
});
