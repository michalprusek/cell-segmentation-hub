/**
 * @file Race condition fix validation tests
 * Tests for the comprehensive fix of race conditions in Segmentation Editor
 * during rapid image switching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isCancelledError,
  handleCancelledError,
  handleRequestError,
} from '../errorUtils';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Race Condition Fix - Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isCancelledError', () => {
    it('should identify Axios CanceledError (ERR_CANCELED)', () => {
      const error = {
        name: 'CanceledError',
        code: 'ERR_CANCELED',
        message: 'canceled',
        isAxiosError: true,
      };

      expect(isCancelledError(error)).toBe(true);
    });

    it('should identify standard AbortError', () => {
      const error = {
        name: 'AbortError',
        message: 'The operation was aborted',
      };

      expect(isCancelledError(error)).toBe(true);
    });

    it('should identify cancellation by message', () => {
      const error = {
        message: 'canceled',
      };

      expect(isCancelledError(error)).toBe(true);
    });

    it('should identify Axios cancellation by message', () => {
      const error = {
        isAxiosError: true,
        message: 'Request was canceled',
      };

      expect(isCancelledError(error)).toBe(true);
    });

    it('should NOT identify regular errors as cancelled', () => {
      const error = {
        name: 'Error',
        message: 'Network Error',
      };

      expect(isCancelledError(error)).toBe(false);
    });

    it('should NOT identify null/undefined as cancelled', () => {
      expect(isCancelledError(null)).toBe(false);
      expect(isCancelledError(undefined)).toBe(false);
      expect(isCancelledError('')).toBe(false);
    });
  });

  describe('handleCancelledError', () => {
    it('should return true and log debug for cancelled errors', async () => {
      const { logger } = await import('@/lib/logger');

      const error = {
        name: 'CanceledError',
        code: 'ERR_CANCELED',
      };

      const result = handleCancelledError(error, 'test context');

      expect(result).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        'Request cancelled in test context',
        expect.any(Object)
      );
    });

    it('should return false for non-cancelled errors', () => {
      const error = {
        name: 'Error',
        message: 'Network Error',
      };

      const result = handleCancelledError(error, 'test context');

      expect(result).toBe(false);
    });
  });

  describe('handleRequestError', () => {
    it('should handle cancellation first and return true', () => {
      const onError = vi.fn();
      const error = {
        name: 'CanceledError',
        code: 'ERR_CANCELED',
      };

      const result = handleRequestError(error, 'test context', onError);

      expect(result).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it('should call onError for non-cancelled errors', () => {
      const onError = vi.fn();
      const error = {
        name: 'Error',
        message: 'Network Error',
      };

      const result = handleRequestError(error, 'test context', onError);

      expect(result).toBe(true);
      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should return false when no onError handler is provided for non-cancelled errors', () => {
      const error = {
        name: 'Error',
        message: 'Network Error',
      };

      const result = handleRequestError(error, 'test context');

      expect(result).toBe(false);
    });
  });

  describe('Real-world race condition scenarios', () => {
    it('should properly handle rapid image switching cancellations', () => {
      // Simulate Axios cancellation during rapid image switching
      const axiosError = {
        name: 'CanceledError',
        code: 'ERR_CANCELED',
        message: 'canceled',
        isAxiosError: true,
        config: { url: '/api/segmentation/images/123/results' },
      };

      // This should be handled gracefully without showing user errors
      expect(handleCancelledError(axiosError, 'segmentation loading')).toBe(
        true
      );
    });

    it('should properly handle WebSocket reload cancellations', () => {
      // Simulate AbortController cancellation during WebSocket reload
      const abortError = {
        name: 'AbortError',
        message: 'The operation was aborted',
      };

      // This should be handled gracefully without showing user errors
      expect(handleCancelledError(abortError, 'websocket reload')).toBe(true);
    });

    it('should properly handle autosave cancellations', () => {
      // Simulate autosave cancellation when user switches images rapidly
      const cancelError = {
        message: 'canceled',
      };

      // This should be handled gracefully without showing user errors
      expect(handleCancelledError(cancelError, 'autosave')).toBe(true);
    });
  });
});
