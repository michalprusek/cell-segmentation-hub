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

      const result = await fetchWithRetry(
        'https://api.example.com/test',
        {},
        { delay: 0 }
      );

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

      const result = await fetchWithRetry(
        'https://api.example.com/test',
        {},
        { delay: 0 }
      );

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

      const result = await fetchWithRetry(
        'https://api.example.com/test',
        {},
        { delay: 0 }
      );

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result.status).toBe(200);
    });

    test('should throw error after exhausting retries', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      await expect(
        fetchWithRetry(
          'https://api.example.com/test',
          {},
          { retries: 2, delay: 0 }
        )
      ).rejects.toThrow('Network error');

      expect(global.fetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test('should respect custom retry count', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      await expect(
        fetchWithRetry(
          'https://api.example.com/test',
          {},
          { retries: 1, delay: 0 }
        )
      ).rejects.toThrow('Network error');

      expect(global.fetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    test('should not retry with retries set to 0', async () => {
      const networkError = new Error('Network error');
      (global.fetch as any).mockRejectedValue(networkError);

      await expect(
        fetchWithRetry(
          'https://api.example.com/test',
          {},
          { retries: 0, delay: 0 }
        )
      ).rejects.toThrow('Network error');

      expect(global.fetch).toHaveBeenCalledTimes(1); // Only initial attempt
    });

    // ── retry SCHEDULE, asserted exactly ────────────────────────────────────
    //
    // These tests used to assert a wall-clock window (`elapsed > 200 &&
    // elapsed < 2500`). That window cannot tell exponential backoff from a
    // constant delay: with delay=100 / retries=2 the real schedule is
    // 100 + 150 = 250 ms and a constant-delay regression gives 100 + 100 =
    // 200 ms, still inside the window. Proven by mutation on 2026-09-04 —
    // replacing `delay * Math.pow(backoff, attempt)` with a bare `delay` left
    // all 29 tests in this file green, three of them named after the backoff.
    //
    // Spying on setTimeout asserts the exact sequence of requested delays
    // instead: deterministic, discriminates every backoff value, and sleeps
    // ~50 ms across all five tests where the old ones slept ~700 ms.
    const captureRetryDelays = async (
      retryOptions: Parameters<typeof fetchWithRetry>[2]
    ): Promise<number[]> => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      try {
        await expect(
          fetchWithRetry('https://api.example.com/test', {}, retryOptions)
        ).rejects.toThrow();
        return setTimeoutSpy.mock.calls.map(call => call[1] as number);
      } finally {
        setTimeoutSpy.mockRestore();
      }
    };

    test('waits delay * backoff^attempt between retries (default backoff 1.5)', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const delays = await captureRetryDelays({ retries: 2, delay: 20 });

      // 20 * 1.5^0, then 20 * 1.5^1 — and no wait after the final attempt.
      expect(delays).toEqual([20, 30]);
    });

    test('honours an explicit backoff multiplier', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const delays = await captureRetryDelays({
        retries: 3,
        delay: 2,
        backoff: 3.0,
      });

      expect(delays).toEqual([2, 6, 18]);
      // initial attempt + 3 retries
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    test('a backoff of exactly 1 degrades to a constant delay', async () => {
      // The discriminating case: this is what the old wall-clock window could
      // not separate from the exponential one.
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const delays = await captureRetryDelays({
        retries: 2,
        delay: 15,
        backoff: 1,
      });

      expect(delays).toEqual([15, 15]);
    });

    test('a fractional backoff shortens each successive wait', async () => {
      // Needs retries >= 2 to mean anything. The old test used retries: 1 with
      // a comment claiming "second attempt should wait 100 * 0.5 = 50ms" — but
      // `attempt` is 0 on the first retry, so its one and only wait was the
      // full 100 ms. It never exercised the multiplier at all.
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const delays = await captureRetryDelays({
        retries: 3,
        delay: 8,
        backoff: 0.5,
      });

      expect(delays).toEqual([8, 4, 2]);
    });

    test('should handle non-Error exceptions', async () => {
      (global.fetch as any).mockRejectedValue('String error');

      await expect(
        // delay: 0 — these five assert the ERROR MESSAGE, not the schedule, and
        // the default 1000ms/1.5x backoff made each of them sleep 4.75s.
        fetchWithRetry('https://api.example.com/test', {}, { delay: 0 })
      ).rejects.toThrow('String error');
    });

    test('should handle undefined/null exceptions', async () => {
      (global.fetch as any).mockRejectedValue(null);

      await expect(
        // delay: 0 — these five assert the ERROR MESSAGE, not the schedule, and
        // the default 1000ms/1.5x backoff made each of them sleep 4.75s.
        fetchWithRetry('https://api.example.com/test', {}, { delay: 0 })
      ).rejects.toThrow('null');
    });

    test('should create proper HTTP error messages', async () => {
      (global.fetch as any).mockResolvedValue(
        createResponse('Not Found', { status: 404, statusText: 'Not Found' })
      );

      await expect(
        // delay: 0 — these five assert the ERROR MESSAGE, not the schedule, and
        // the default 1000ms/1.5x backoff made each of them sleep 4.75s.
        fetchWithRetry('https://api.example.com/test', {}, { delay: 0 })
      ).rejects.toThrow('HTTP 404: Not Found');
    });

    test('should handle response with no statusText', async () => {
      (global.fetch as any).mockResolvedValue(
        createResponse('Error', { status: 500, statusText: '' })
      );

      await expect(
        // delay: 0 — these five assert the ERROR MESSAGE, not the schedule, and
        // the default 1000ms/1.5x backoff made each of them sleep 4.75s.
        fetchWithRetry('https://api.example.com/test', {}, { delay: 0 })
      ).rejects.toThrow('HTTP 500: ');
    });

    test.each([200, 201, 202, 204, 206])(
      'should return immediately on successful response status code %i',
      async code => {
        // Response with 204 cannot have a body
        const body = code === 204 ? null : 'success';
        const mockResponse = createResponse(body, { status: code });
        (global.fetch as any).mockResolvedValue(mockResponse);

        const result = await fetchWithRetry(
          'https://api.example.com/test',
          {},
          { delay: 0 }
        );

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

        const result = await fetchWithRetry(
          'https://api.example.com/test',
          {},
          { delay: 0 }
        );

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

        const result = await fetchWithRetry(
          'https://api.example.com/test',
          {},
          { delay: 0 }
        );
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
        // delay: 0 — these five assert the ERROR MESSAGE, not the schedule, and
        // the default 1000ms/1.5x backoff made each of them sleep 4.75s.
        fetchWithRetry('https://api.example.com/test', {}, { delay: 0 })
      ).rejects.toThrow('undefined');
    });

    test('should work with default options', async () => {
      const mockResponse = createResponse('success', { status: 200 });
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await fetchWithRetry(
        'https://api.example.com/test',
        {},
        { delay: 0 }
      );

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

      const result = await fetchWithRetry(
        'https://api.example.com/test',
        {},
        { delay: 0 }
      );

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
        fetchWithRetry(
          'https://api.example.com/test',
          {},
          { retries: 2, delay: 0 }
        )
      ).rejects.toThrow('Third error');
    });

    test('a zero delay schedules no waiting between attempts', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      try {
        await expect(
          fetchWithRetry(
            'https://api.example.com/test',
            {},
            { retries: 2, delay: 0 }
          )
        ).rejects.toThrow();
        expect(setTimeoutSpy.mock.calls.map(call => call[1])).toEqual([0, 0]);
      } finally {
        setTimeoutSpy.mockRestore();
      }

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
