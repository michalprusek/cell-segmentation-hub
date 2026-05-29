/**
 * businessMetrics.gaps6.test.ts
 *
 * Covers the error catch-branches (lines 93, 110, 127, 138, 149, 166, 177,
 * 194, 209, 220) and the initializeBusinessMetricsCollection /
 * getBusinessMetricsSummary error path (lines 245, 281-282).
 *
 * Strategy: import the real module, then mock-spy individual metric-object
 * methods to throw synchronously, confirming that each public function swallows
 * the error and delegates it to logger.error instead of re-throwing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  trackApiError,
  trackFeatureUsage,
  trackImageProcessing,
  updateActiveUsers,
  trackProjectCreated,
  trackSegmentationJob,
  updateStorageUsage,
  trackAuthenticationAttempt,
  recordApiResponseTime,
  updateQueueSize,
  initializeBusinessMetricsCollection,
  getBusinessMetricsSummary,
  businessMetricsRegistry,
  apiErrorsTotal,
  featureUsageCounter,
  imageProcessingCounter,
  userActivityGauge,
  projectsCreatedTotal,
  segmentationJobsTotal,
  storageUsageGauge,
  authenticationAttempts,
  apiResponseTime,
  queueSize,
} from '../../monitoring/businessMetrics';
import { logger } from '../../utils/logger';

const mockLogger = logger as unknown as {
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Each metric function has a try/catch — verify catch logs without throwing
// ---------------------------------------------------------------------------

describe('businessMetrics catch-branch coverage', () => {
  it('trackApiError — catches and logs when counter.inc throws', () => {
    const spy = vi.spyOn(apiErrorsTotal, 'inc').mockImplementationOnce(() => {
      throw new Error('prom error');
    });

    expect(() => trackApiError('/api/test', 'server_error', 500)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track API error metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('trackFeatureUsage — catches and logs when counter.inc throws', () => {
    const spy = vi
      .spyOn(featureUsageCounter, 'inc')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });

    expect(() => trackFeatureUsage('export', 'admin')).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track feature usage metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('trackImageProcessing — catches and logs when counter.inc throws', () => {
    const spy = vi
      .spyOn(imageProcessingCounter, 'inc')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });

    expect(() => trackImageProcessing('resize', 'failure')).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track image processing metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('updateActiveUsers — catches and logs when gauge.set throws', () => {
    const spy = vi
      .spyOn(userActivityGauge, 'set')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });

    expect(() => updateActiveUsers('premium', 10)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update active users metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('trackProjectCreated — catches and logs when counter.inc throws', () => {
    const spy = vi
      .spyOn(projectsCreatedTotal, 'inc')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });

    expect(() => trackProjectCreated()).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track project creation metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('trackSegmentationJob — catches and logs when counter.inc throws', () => {
    const spy = vi
      .spyOn(segmentationJobsTotal, 'inc')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });

    expect(() => trackSegmentationJob('hrnet', 'failed')).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track segmentation job metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('updateStorageUsage — catches and logs when gauge.set throws', () => {
    const spy = vi
      .spyOn(storageUsageGauge, 'set')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });

    expect(() => updateStorageUsage('thumbnails', 512)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update storage usage metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('trackAuthenticationAttempt — catches and logs when counter.inc throws', () => {
    const spy = vi
      .spyOn(authenticationAttempts, 'inc')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });

    expect(() =>
      trackAuthenticationAttempt('refresh', 'failure')
    ).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track authentication attempt metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('recordApiResponseTime — catches and logs when histogram.observe throws', () => {
    const spy = vi
      .spyOn(apiResponseTime, 'observe')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });

    expect(() =>
      recordApiResponseTime('/api/projects', 'GET', 0.05)
    ).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to record API response time metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('updateQueueSize — catches and logs when gauge.set throws', () => {
    const spy = vi.spyOn(queueSize, 'set').mockImplementationOnce(() => {
      throw new Error('prom error');
    });

    expect(() => updateQueueSize('export', 3)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update queue size metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// initializeBusinessMetricsCollection — normal call + error path
// ---------------------------------------------------------------------------

describe('initializeBusinessMetricsCollection()', () => {
  it('does not throw on normal call', () => {
    expect(() => initializeBusinessMetricsCollection()).not.toThrow();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Business metrics collection initialized')
    );
  });

  it('catches and logs when inner calls throw', () => {
    // Make updateActiveUsers throw by spying on gauge.set
    const spy = vi
      .spyOn(userActivityGauge, 'set')
      .mockImplementationOnce(() => {
        throw new Error('init error');
      });

    expect(() => initializeBusinessMetricsCollection()).not.toThrow();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getBusinessMetricsSummary — error path returns zero-filled object
// ---------------------------------------------------------------------------

describe('getBusinessMetricsSummary() error path', () => {
  it('returns zero summary when registry.getMetricsAsJSON throws', async () => {
    const spy = vi
      .spyOn(businessMetricsRegistry, 'getMetricsAsJSON')
      .mockRejectedValueOnce(new Error('registry error'));

    const summary = await getBusinessMetricsSummary();

    expect(summary).toEqual({
      totalApiErrors: 0,
      totalFeatureUsage: 0,
      totalImagesProcessed: 0,
      totalProjects: 0,
      totalSegmentationJobs: 0,
      totalAuthAttempts: 0,
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to get business metrics summary:',
      expect.any(Error)
    );
    spy.mockRestore();
  });
});
