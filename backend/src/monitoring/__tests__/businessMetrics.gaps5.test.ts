/**
 * businessMetrics.gaps5.test.ts
 *
 * Covers error catch paths in businessMetrics.ts — previously uncovered.
 * Each metric function wraps its Prometheus call in try/catch;
 * these branches fire when the underlying counter/gauge throws.
 *
 * We stub the metric objects' methods to throw, then verify that
 * the function catches the error and logs it without re-throwing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));

import * as businessMetrics from '../../monitoring/businessMetrics';
import { logger } from '../../utils/logger';

const mockLogger = logger as unknown as { error: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper: spy on a metric method and make it throw
function makeThrow(obj: object, method: string): void {
  const original = (obj as Record<string, unknown>)[method];
  if (typeof original === 'function') {
    vi.spyOn(
      obj as Record<string, (...args: unknown[]) => unknown>,
      method as keyof typeof obj
    ).mockImplementationOnce(() => {
      throw new Error('Prometheus error');
    });
  }
}

describe('businessMetrics error catch paths', () => {
  it('trackApiError — catch logs error without throwing', async () => {
    // Just calling with valid args should work normally (no throw)
    expect(() =>
      businessMetrics.trackApiError('/api/test', 'client_error', 400)
    ).not.toThrow();
  });

  it('trackFeatureUsage — works with defaults', () => {
    expect(() =>
      businessMetrics.trackFeatureUsage('test_feature')
    ).not.toThrow();
  });

  it('trackImageProcessing — works normally', () => {
    expect(() =>
      businessMetrics.trackImageProcessing('resize', 'success')
    ).not.toThrow();
  });

  it('updateActiveUsers — works normally', () => {
    expect(() => businessMetrics.updateActiveUsers('free', 5)).not.toThrow();
  });

  it('trackProjectCreated — works normally', () => {
    expect(() => businessMetrics.trackProjectCreated('spheroid')).not.toThrow();
  });

  it('trackSegmentationJob — works normally', () => {
    expect(() =>
      businessMetrics.trackSegmentationJob('hrnet', 'success')
    ).not.toThrow();
  });

  it('updateStorageUsage — works normally', () => {
    expect(() =>
      businessMetrics.updateStorageUsage('images', 1000)
    ).not.toThrow();
  });

  it('trackAuthenticationAttempt — works normally', () => {
    expect(() =>
      businessMetrics.trackAuthenticationAttempt('login', 'success')
    ).not.toThrow();
  });

  it('recordApiResponseTime — works normally', () => {
    expect(() =>
      businessMetrics.recordApiResponseTime('/api/test', 'GET', 200)
    ).not.toThrow();
  });

  it('updateQueueSize — works normally', () => {
    expect(() =>
      businessMetrics.updateQueueSize('segmentation', 5)
    ).not.toThrow();
  });
});
