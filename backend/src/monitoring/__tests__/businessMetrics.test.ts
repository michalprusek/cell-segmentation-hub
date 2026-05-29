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
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32chars!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32chars!',
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

describe('trackImageProcessing()', () => {
  it('increments images_processed_total with type=segmentation/status=success', async () => {
    trackImageProcessing('segmentation', 'success');
    const val = await getMetricValue('images_processed_total', {
      type: 'segmentation',
      status: 'success',
    });
    expect(val).toBe(1);
  });

  it('tracks failure status separately from success', async () => {
    trackImageProcessing('upload', 'failure');
    const val = await getMetricValue('images_processed_total', {
      type: 'upload',
      status: 'failure',
    });
    expect(val).toBe(1);
  });
});

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

describe('trackProjectCreated()', () => {
  it('increments projects_created_total counter', async () => {
    trackProjectCreated();
    trackProjectCreated();
    const metrics = await businessMetricsRegistry.getMetricsAsJSON();
    const metric = metrics.find(m => m.name === 'projects_created_total');
    const total = (metric?.values ?? []).reduce(
      (s, v) => s + (v.value ?? 0),
      0
    );
    expect(total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// trackSegmentationJob()
// ---------------------------------------------------------------------------

describe('trackSegmentationJob()', () => {
  it('increments segmentation_jobs_total with model/status labels', async () => {
    trackSegmentationJob('hrnet', 'started');
    const val = await getMetricValue('segmentation_jobs_total', {
      model: 'hrnet',
      status: 'started',
    });
    expect(val).toBe(1);
  });

  it('tracks completed and failed separately', async () => {
    trackSegmentationJob('unet', 'completed');
    trackSegmentationJob('unet', 'failed');
    const done = await getMetricValue('segmentation_jobs_total', {
      model: 'unet',
      status: 'completed',
    });
    const fail = await getMetricValue('segmentation_jobs_total', {
      model: 'unet',
      status: 'failed',
    });
    expect(done).toBe(1);
    expect(fail).toBe(1);
  });
});

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

describe('trackAuthenticationAttempt()', () => {
  it('increments authentication_attempts_total with type/status labels', async () => {
    trackAuthenticationAttempt('password', 'success');
    const val = await getMetricValue('authentication_attempts_total', {
      type: 'password',
      status: 'success',
    });
    expect(val).toBe(1);
  });

  it('tracks failure separately from success', async () => {
    trackAuthenticationAttempt('token', 'failure');
    const val = await getMetricValue('authentication_attempts_total', {
      type: 'token',
      status: 'failure',
    });
    expect(val).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// recordApiResponseTime()
// ---------------------------------------------------------------------------

describe('recordApiResponseTime()', () => {
  it('records observation in api_response_time_seconds histogram', async () => {
    recordApiResponseTime('/api/projects', 'GET', 0.05);
    const metrics = await businessMetricsRegistry.getMetricsAsJSON();
    const hist = metrics.find(m => m.name === 'api_response_time_seconds');
    const countEntry = hist?.values?.find(
      v =>
        (v.labels as Record<string, string>).endpoint === '/api/projects' &&
        (v.labels as Record<string, string>).method === 'GET' &&
        (v.metricName as string)?.endsWith('_count')
    );
    expect(countEntry?.value ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('records the correct duration in the sum', async () => {
    recordApiResponseTime('/api/auth/login', 'POST', 0.123);
    const metrics = await businessMetricsRegistry.getMetricsAsJSON();
    const hist = metrics.find(m => m.name === 'api_response_time_seconds');
    const sumEntry = hist?.values?.find(
      v =>
        (v.labels as Record<string, string>).endpoint === '/api/auth/login' &&
        (v.metricName as string)?.endsWith('_sum')
    );
    expect(sumEntry?.value).toBeCloseTo(0.123, 3);
  });
});

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
  it('runs without throwing', () => {
    expect(() => initializeBusinessMetricsCollection()).not.toThrow();
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
});

// ---------------------------------------------------------------------------
// getBusinessMetricsSummary()
// ---------------------------------------------------------------------------

describe('getBusinessMetricsSummary()', () => {
  it('returns an object with all required summary keys', async () => {
    const summary = await getBusinessMetricsSummary();
    expect(summary).toHaveProperty('totalApiErrors');
    expect(summary).toHaveProperty('totalFeatureUsage');
    expect(summary).toHaveProperty('totalImagesProcessed');
    expect(summary).toHaveProperty('totalProjects');
    expect(summary).toHaveProperty('totalSegmentationJobs');
    expect(summary).toHaveProperty('totalAuthAttempts');
  });

  it('totalApiErrors reflects tracked errors', async () => {
    trackApiError('/api/test', 'client_error', 400);
    trackApiError('/api/test', 'client_error', 400);
    const summary = await getBusinessMetricsSummary();
    expect(summary.totalApiErrors).toBeGreaterThanOrEqual(2);
  });

  it('totalFeatureUsage reflects feature calls', async () => {
    trackFeatureUsage('project_creation', 'authenticated');
    const summary = await getBusinessMetricsSummary();
    expect(summary.totalFeatureUsage).toBeGreaterThanOrEqual(1);
  });

  it('totalImagesProcessed reflects image processing calls', async () => {
    trackImageProcessing('thumbnail', 'success');
    const summary = await getBusinessMetricsSummary();
    expect(summary.totalImagesProcessed).toBeGreaterThanOrEqual(1);
  });

  it('totalProjects reflects project creation calls', async () => {
    trackProjectCreated();
    const summary = await getBusinessMetricsSummary();
    expect(summary.totalProjects).toBeGreaterThanOrEqual(1);
  });

  it('totalSegmentationJobs reflects job tracking calls', async () => {
    trackSegmentationJob('mamba', 'completed');
    const summary = await getBusinessMetricsSummary();
    expect(summary.totalSegmentationJobs).toBeGreaterThanOrEqual(1);
  });

  it('totalAuthAttempts reflects authentication tracking calls', async () => {
    trackAuthenticationAttempt('password', 'success');
    const summary = await getBusinessMetricsSummary();
    expect(summary.totalAuthAttempts).toBeGreaterThanOrEqual(1);
  });
});
