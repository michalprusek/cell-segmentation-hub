import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../httpUtils';

// Mock fetch globally
global.fetch = vi.fn();

// Helper function to create Response with proper ok property
function createResponse(body: any, init?: ResponseInit): Response {
  const response = new Response(body, init);
  const status = init?.status || 200;
  Object.defineProperty(response, 'ok', {
    value: status >= 200 && status < 300,
    writable: false,
  });
  return response;
}

describe('HTTP Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchWithRetry', () => {
    test('should return response on successful request', async () => {
      const mockResponse = createResponse('success', {
        status: 200,
        statusText: 'OK',
      });
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        {}
      );
      expect(result).toBe(mockResponse);
    });

    test('should pass through request options', async () => {
      const mockResponse = createResponse('success', { status: 200 });
      (global.fetch as any).mockResolvedValue(mockResponse);

      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' }),
      };

      await fetchWithRetry('https://api.example.com/test', options);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        options
      );
    });

    test('should retry on network failure', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any)
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValue(createResponse('success', { status: 200 }));

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result.status).toBe(200);
    });

    test('should retry on HTTP error status', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce(
          createResponse('Server Error', {
            status: 500,
            statusText: 'Internal Server Error',
          })
        )
        .mockResolvedValueOnce(
          createResponse('Bad Gateway', {
            status: 502,
            statusText: 'Bad Gateway',
          })
        )
        .mockResolvedValue(
          createResponse('success', { status: 200, statusText: 'OK' })
        );

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result.status).toBe(200);
    });

    test('should throw error after exhausting retries', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      await expect(
        fetchWithRetry('https://api.example.com/test', {}, { retries: 2 })
      ).rejects.toThrow('Network error');

      expect(global.fetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test('should respect custom retry count', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      await expect(
        fetchWithRetry('https://api.example.com/test', {}, { retries: 1 })
      ).rejects.toThrow('Network error');

      expect(global.fetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    test('should not retry with retries set to 0', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      await expect(
        fetchWithRetry('https://api.example.com/test', {}, { retries: 0 })
      ).rejects.toThrow('Network error');

      expect(global.fetch).toHaveBeenCalledTimes(1); // Only initial attempt
    });

    test('should use exponential backoff by default', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      const start = Date.now();

      try {
        await fetchWithRetry(
          'https://api.example.com/test',
          {},
          {
            retries: 2,
            delay: 100, // 100ms base delay
          }
        );
      } catch (_e) {
        // Expected to fail
      }

      const elapsed = Date.now() - start;

      // Should wait approximately: 100ms (first retry) + 150ms (second retry) = 250ms minimum
      // Plus some tolerance for execution time
      expect(elapsed).toBeGreaterThan(200);
      expect(elapsed).toBeLessThan(500); // Should not take too long
    });

    test('should use custom delay and backoff', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      const start = Date.now();

      try {
        await fetchWithRetry(
          'https://api.example.com/test',
          {},
          {
            retries: 1,
            delay: 200,
            backoff: 2.0,
          }
        );
      } catch (_e) {
        // Expected to fail
      }

      const elapsed = Date.now() - start;

      // Should wait approximately: 200ms (first retry)
      expect(elapsed).toBeGreaterThan(150);
      expect(elapsed).toBeLessThan(350);
    });

    test('should handle custom backoff calculation', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      try {
        await fetchWithRetry(
          'https://api.example.com/test',
          {},
          {
            retries: 3,
            delay: 10, // Very small delay for testing
            backoff: 3.0, // High backoff multiplier
          }
        );
      } catch (_e) {
        // Expected to fail
      }

      // Should have made 4 attempts total (initial + 3 retries)
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    test('should handle non-Error exceptions', async () => {
      (global.fetch as any).mockRejectedValue('String error');

      await expect(
        fetchWithRetry('https://api.example.com/test')
      ).rejects.toThrow('String error');
    });

    test('should handle undefined/null exceptions', async () => {
      (global.fetch as any).mockRejectedValue(null);

      await expect(
        fetchWithRetry('https://api.example.com/test')
      ).rejects.toThrow('null');
    });

    test('should create proper HTTP error messages', async () => {
      (global.fetch as any).mockResolvedValue(
        createResponse('Not Found', { status: 404, statusText: 'Not Found' })
      );

      await expect(
        fetchWithRetry('https://api.example.com/test')
      ).rejects.toThrow('HTTP 404: Not Found');
    });

    test('should handle response with no statusText', async () => {
      (global.fetch as any).mockResolvedValue(
        createResponse('Error', { status: 500, statusText: '' })
      );

      await expect(
        fetchWithRetry('https://api.example.com/test')
      ).rejects.toThrow('HTTP 500: ');
    });

    test.each([200, 201, 202, 204, 206])(
      'should return immediately on successful response status code %i',
      async code => {
        // Response with 204 cannot have a body
        const body = code === 204 ? null : 'success';
        const mockResponse = createResponse(body, { status: code });
        (global.fetch as any).mockResolvedValue(mockResponse);

        const result = await fetchWithRetry('https://api.example.com/test');

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.status).toBe(code);
      }
    );

    test.each([301, 302, 304])(
      'should retry on redirect/not-modified status code %i and eventually succeed',
      async code => {
        // These status codes are not considered "ok" (200-299), so they should trigger retry
        const body = code === 304 ? null : 'redirect';
        const errorResponse = createResponse(body, { status: code });
        const successResponse = createResponse('success', { status: 200 });

        // First call returns redirect/not-modified, second returns success
        (global.fetch as any)
          .mockResolvedValueOnce(errorResponse)
          .mockResolvedValue(successResponse);

        const result = await fetchWithRetry('https://api.example.com/test');

        // Should have retried once after getting non-ok status
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(result.status).toBe(200);
      }
    );

    test('should retry on client and server error status codes', async () => {
      const errorCodes = [400, 401, 403, 404, 500, 502, 503, 504];

      for (const code of errorCodes) {
        (global.fetch as any)
          .mockResolvedValueOnce(createResponse('Error', { status: code }))
          .mockResolvedValue(createResponse('Success', { status: 200 }));

        const result = await fetchWithRetry('https://api.example.com/test');
        expect(result.status).toBe(200);
        expect(global.fetch).toHaveBeenCalledTimes(2);

        vi.clearAllMocks();
      }
    });

    test('should handle edge case where no error is captured', async () => {
      // Mock a scenario where somehow no error is set
      (global.fetch as any).mockImplementation(() => {
        throw undefined;
      });

      await expect(
        fetchWithRetry('https://api.example.com/test')
      ).rejects.toThrow('undefined');
    });

    test('should work with default options', async () => {
      const mockResponse = createResponse('success', { status: 200 });
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(result).toBe(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        {}
      );
    });

    test('should handle mixed success and failure scenarios', async () => {
      // First request fails with network error
      // Second request fails with HTTP error
      // Third request succeeds
      (global.fetch as any)
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce(createResponse('Server Error', { status: 500 }))
        .mockResolvedValue(createResponse('Success', { status: 200 }));

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(result.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test('should preserve last error when all retries fail', async () => {
      const firstError = new Error('First error');
      const secondError = new Error('Second error');
      const thirdError = new Error('Third error');

      (global.fetch as any)
        .mockRejectedValueOnce(firstError)
        .mockRejectedValueOnce(secondError)
        .mockRejectedValue(thirdError);

      await expect(
        fetchWithRetry('https://api.example.com/test', {}, { retries: 2 })
      ).rejects.toThrow('Third error');
    });

    test('should handle fractional backoff values', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      const start = Date.now();

      try {
        await fetchWithRetry(
          'https://api.example.com/test',
          {},
          {
            retries: 1,
            delay: 100,
            backoff: 0.5, // Fractional backoff should decrease wait time
          }
        );
      } catch (_e) {
        // Expected to fail
      }

      const elapsed = Date.now() - start;

      // With backoff 0.5, second attempt should wait 100 * 0.5 = 50ms
      expect(elapsed).toBeGreaterThan(40);
      expect(elapsed).toBeLessThan(150);
    });

    test('should handle zero delay', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      const start = Date.now();

      try {
        await fetchWithRetry(
          'https://api.example.com/test',
          {},
          {
            retries: 2,
            delay: 0,
          }
        );
      } catch (_e) {
        // Expected to fail
      }

      const elapsed = Date.now() - start;

      // Should complete quickly with no delays
      expect(elapsed).toBeLessThan(50);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
