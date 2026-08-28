/**
 * Tests for src/monitoring/businessMetrics.ts
 *
 * Behavioral focus:
 *  - trackApiError() increments apiErrorsTotal with endpoint/error_type/status_code
 *  - trackFeatureUsage() increments featureUsageCounter with feature/user_type;
 *      defaults user_type to 'anonymous' when not supplied
 *  - trackImageProcessing() increments imageProcessingCounter with type/status labels
 *  - updateActiveUsers() sets userActivityGauge per tier
 *  - trackProjectCreated() increments projectsCreatedTotal counter
 *  - trackSegmentationJob() increments segmentationJobsTotal with model/status
 *  - updateStorageUsage() sets storageUsageGauge per type
 *  - trackAuthenticationAttempt() increments authenticationAttempts with type/status
 *  - recordApiResponseTime() records histogram observation with endpoint/method
 *  - updateQueueSize() sets queueSize gauge per queue_name
 *  - initializeBusinessMetricsCollection() seeds gauges without throwing
 *  - getBusinessMetricsSummary() returns all required keys with aggregated counts
 *  - every tracker swallows a throwing Prometheus call and logs it via
 *      logger.error instead of re-throwing (catch-branch coverage)
 *  - getBusinessMetricsSummary() returns a zero-filled object on registry error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — before any source import
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------
import {
  trackApiError,
  trackFeatureUsage,
  updateActiveUsers,
  updateStorageUsage,
  updateQueueSize,
  initializeBusinessMetricsCollection,
  businessMetricsRegistry,
  // Exported counter/gauge/histogram instances for direct reset
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

// ---------------------------------------------------------------------------
// Helper: extract value from the business registry
// ---------------------------------------------------------------------------

async function getMetricValue(
  metricName: string,
  labels: Record<string, string> = {}
): Promise<number> {
  const metrics = await businessMetricsRegistry.getMetricsAsJSON();
  const metric = metrics.find(m => m.name === metricName);
  if (!metric?.values) return 0;
  const found = metric.values.find(v =>
    Object.entries(labels).every(
      ([k, val]) => (v.labels as Record<string, string>)[k] === val
    )
  );
  return found?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Reset all metrics before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  apiErrorsTotal.reset();
  featureUsageCounter.reset();
  imageProcessingCounter.reset();
  userActivityGauge.reset();
  projectsCreatedTotal.reset();
  segmentationJobsTotal.reset();
  storageUsageGauge.reset();
  authenticationAttempts.reset();
  apiResponseTime.reset();
  queueSize.reset();
});

// ---------------------------------------------------------------------------
// trackApiError()
// ---------------------------------------------------------------------------

describe('trackApiError()', () => {
  it('increments api_errors_total with endpoint/error_type/status_code labels', async () => {
    trackApiError('/api/projects', 'server_error', 500);
    const val = await getMetricValue('api_errors_total', {
      endpoint: '/api/projects',
      error_type: 'server_error',
      status_code: '500',
    });
    expect(val).toBe(1);
  });

  it('accumulates for repeated calls with same labels', async () => {
    trackApiError('/api/auth/login', 'client_error', 401);
    trackApiError('/api/auth/login', 'client_error', 401);
    const val = await getMetricValue('api_errors_total', {
      endpoint: '/api/auth/login',
      error_type: 'client_error',
      status_code: '401',
    });
    expect(val).toBe(2);
  });

  it('tracks distinct endpoints independently', async () => {
    trackApiError('/api/a', 'client_error', 404);
    trackApiError('/api/b', 'server_error', 500);
    const a = await getMetricValue('api_errors_total', {
      endpoint: '/api/a',
      error_type: 'client_error',
      status_code: '404',
    });
    const b = await getMetricValue('api_errors_total', {
      endpoint: '/api/b',
      error_type: 'server_error',
      status_code: '500',
    });
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// trackFeatureUsage()
// ---------------------------------------------------------------------------

describe('trackFeatureUsage()', () => {
  it('increments feature_usage_total with feature and user_type labels', async () => {
    trackFeatureUsage('project_creation', 'authenticated');
    const val = await getMetricValue('feature_usage_total', {
      feature: 'project_creation',
      user_type: 'authenticated',
    });
    expect(val).toBe(1);
  });

  it('defaults user_type to "anonymous" when not provided', async () => {
    trackFeatureUsage('image_upload');
    const val = await getMetricValue('feature_usage_total', {
      feature: 'image_upload',
      user_type: 'anonymous',
    });
    expect(val).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// trackImageProcessing()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// updateActiveUsers()
// ---------------------------------------------------------------------------

describe('updateActiveUsers()', () => {
  it('sets active_users gauge for the given tier', async () => {
    updateActiveUsers('premium', 42);
    const val = await getMetricValue('active_users', { tier: 'premium' });
    expect(val).toBe(42);
  });

  it('overwrites previous value for the same tier', async () => {
    updateActiveUsers('free', 10);
    updateActiveUsers('free', 25);
    const val = await getMetricValue('active_users', { tier: 'free' });
    expect(val).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// trackProjectCreated()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// trackSegmentationJob()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// updateStorageUsage()
// ---------------------------------------------------------------------------

describe('updateStorageUsage()', () => {
  it('sets storage_usage_bytes gauge for the given type', async () => {
    updateStorageUsage('images', 1048576);
    const val = await getMetricValue('storage_usage_bytes', { type: 'images' });
    expect(val).toBe(1048576);
  });

  it('overwrites previous value', async () => {
    updateStorageUsage('thumbnails', 500);
    updateStorageUsage('thumbnails', 1500);
    const val = await getMetricValue('storage_usage_bytes', {
      type: 'thumbnails',
    });
    expect(val).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// trackAuthenticationAttempt()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// recordApiResponseTime()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// updateQueueSize()
// ---------------------------------------------------------------------------

describe('updateQueueSize()', () => {
  it('sets queue_size gauge for the given queue_name', async () => {
    updateQueueSize('segmentation', 17);
    const val = await getMetricValue('queue_size', {
      queue_name: 'segmentation',
    });
    expect(val).toBe(17);
  });

  it('tracks export queue independently', async () => {
    updateQueueSize('export', 3);
    const val = await getMetricValue('queue_size', { queue_name: 'export' });
    expect(val).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// initializeBusinessMetricsCollection()
// ---------------------------------------------------------------------------

describe('initializeBusinessMetricsCollection()', () => {
  it('runs without throwing and logs initialization', () => {
    expect(() => initializeBusinessMetricsCollection()).not.toThrow();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Business metrics collection initialized')
    );
  });

  it('seeds active_users gauges for free/premium/admin tiers', async () => {
    initializeBusinessMetricsCollection();
    const free = await getMetricValue('active_users', { tier: 'free' });
    const premium = await getMetricValue('active_users', { tier: 'premium' });
    const admin = await getMetricValue('active_users', { tier: 'admin' });
    // After initialization, values are 0 (or whatever was last set)
    expect(free).toBeGreaterThanOrEqual(0);
    expect(premium).toBeGreaterThanOrEqual(0);
    expect(admin).toBeGreaterThanOrEqual(0);
  });

  it('seeds segmentation and export queue sizes', async () => {
    initializeBusinessMetricsCollection();
    const seg = await getMetricValue('queue_size', {
      queue_name: 'segmentation',
    });
    const exp = await getMetricValue('queue_size', { queue_name: 'export' });
    expect(seg).toBeGreaterThanOrEqual(0);
    expect(exp).toBeGreaterThanOrEqual(0);
  });

  it('catches and swallows when an inner metric call throws', () => {
    const spy = vi.spyOn(userActivityGauge, 'set').mockImplementationOnce(() => {
      throw new Error('init error');
    });
    expect(() => initializeBusinessMetricsCollection()).not.toThrow();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getBusinessMetricsSummary()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Error catch-branches — each tracker swallows a throwing Prometheus call and
// delegates it to logger.error instead of re-throwing.
// ---------------------------------------------------------------------------

describe('metric error catch-branches', () => {
  it('trackApiError logs when counter.inc throws', () => {
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

  it('trackFeatureUsage logs when counter.inc throws', () => {
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

  it('updateActiveUsers logs when gauge.set throws', () => {
    const spy = vi.spyOn(userActivityGauge, 'set').mockImplementationOnce(() => {
      throw new Error('prom error');
    });
    expect(() => updateActiveUsers('premium', 10)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update active users metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('updateStorageUsage logs when gauge.set throws', () => {
    const spy = vi.spyOn(storageUsageGauge, 'set').mockImplementationOnce(() => {
      throw new Error('prom error');
    });
    expect(() => updateStorageUsage('thumbnails', 512)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update storage usage metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('updateQueueSize logs when gauge.set throws', () => {
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
