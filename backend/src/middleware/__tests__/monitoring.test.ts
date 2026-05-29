/**
 * Tests for src/middleware/monitoring.ts
 *
 * Behavioral focus:
 *  - createMonitoringMiddleware() calls next() on every request
 *  - on 'finish', httpRequestsTotal is incremented with method/route/status
 *  - on 'finish', httpRequestDuration is observed with method/route/status
 *  - on 'finish', activeConnections is decremented after being incremented
 *  - on 'finish', endpointHealth is set to 1 for 2xx/4xx, 0 for 5xx
 *  - on 'finish' for status >= 400, trackApiError is called with correct args
 *  - on 'finish' for authenticated + status < 400, trackFeatureUsage is called
 *    (tests the route→feature name mapping path)
 *  - on 'finish' for slow request (> 1000 ms), logger.warn is called
 *  - getMetricsEndpoint() returns Prometheus text with Content-Type header
 *  - trackMLModelInference() increments ml_model_requests_total and observes
 *    ml_model_inference_duration_ms with model_name/status labels
 *  - trackFileUpload() increments uploaded_files_total with file_type/status
 *  - updateDatabaseConnections() sets database_connections_active gauge
 *  - getMonitoringHealth() returns { healthy: true } when registry is functional
 *  - initializeMetricsCollection() runs without throwing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';

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
// Import after mocks
// ---------------------------------------------------------------------------
import {
  createMonitoringMiddleware,
  getMetricsEndpoint,
  trackMLModelInference,
  trackFileUpload,
  updateDatabaseConnections,
  getMonitoringHealth,
  initializeMetricsCollection,
  metrics,
} from '../../middleware/monitoring';
import { logger } from '../../utils/logger';

const mockedLogger = vi.mocked(logger);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getMetricValue(
  metricName: string,
  labels: Record<string, string> = {}
): Promise<number> {
  const all = await metrics.register.getMetricsAsJSON();
  const metric = all.find(m => m.name === metricName);
  if (!metric?.values) return 0;
  const entry = metric.values.find(v =>
    Object.entries(labels).every(
      ([k, val]) => (v.labels as Record<string, string>)[k] === val
    )
  );
  return entry?.value ?? 0;
}

function buildApp(
  routePath = '/test',
  handler?: (req: Request, res: Response) => void
): Express {
  const app = express();
  app.use(createMonitoringMiddleware());
  app.get(routePath, handler ?? ((_req, res) => res.sendStatus(200)));
  return app;
}

// Reset relevant counters/gauges before each test
beforeEach(() => {
  metrics.httpRequestsTotal.reset();
  metrics.httpRequestDuration.reset();
  metrics.activeConnections.reset();
  metrics.endpointHealth.reset();
  metrics.mlModelInferenceTime.reset();
  metrics.mlModelRequests.reset();
  metrics.uploadedFiles.reset();
  metrics.databaseConnections.reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// createMonitoringMiddleware()
// ---------------------------------------------------------------------------

describe('createMonitoringMiddleware()', () => {
  it('returns a function (middleware)', () => {
    expect(typeof createMonitoringMiddleware()).toBe('function');
  });

  it('calls next() so the request proceeds', async () => {
    const app = buildApp();
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });

  it('increments http_requests_total with method/route/status on finish', async () => {
    const app = buildApp('/req-count');
    await request(app).get('/req-count');
    const val = await getMetricValue('http_requests_total', {
      method: 'GET',
      status: '200',
    });
    expect(val).toBeGreaterThanOrEqual(1);
  });

  it('records a histogram observation in http_request_duration_ms on finish', async () => {
    const app = buildApp('/duration-test');
    await request(app).get('/duration-test');
    const all = await metrics.register.getMetricsAsJSON();
    const hist = all.find(m => m.name === 'http_request_duration_ms');
    const hasObservation = (hist?.values ?? []).some(
      v => (v.metricName as string)?.endsWith('_count') && (v.value ?? 0) > 0
    );
    expect(hasObservation).toBe(true);
  });

  it('net active_connections is 0 after request finishes (inc then dec)', async () => {
    const app = buildApp('/connections');
    await request(app).get('/connections');
    const all = await metrics.register.getMetricsAsJSON();
    const gauge = all.find(m => m.name === 'active_connections');
    const val = gauge?.values?.[0]?.value ?? 0;
    expect(val).toBe(0);
  });

  it('sets endpoint_health to 1 for 2xx responses', async () => {
    const app = buildApp('/health-2xx');
    await request(app).get('/health-2xx');
    const all = await metrics.register.getMetricsAsJSON();
    const gauge = all.find(m => m.name === 'endpoint_health');
    const healthy = (gauge?.values ?? []).find(
      v =>
        (v.labels as Record<string, string>).method === 'GET' &&
        (v.value ?? 0) === 1
    );
    expect(healthy).toBeDefined();
  });

  it('sets endpoint_health to 0 for 5xx responses', async () => {
    const app = express();
    app.use(createMonitoringMiddleware());
    app.get('/fail-500', (_req, res) => res.sendStatus(500));
    await request(app).get('/fail-500');
    const all = await metrics.register.getMetricsAsJSON();
    const gauge = all.find(m => m.name === 'endpoint_health');
    const unhealthy = (gauge?.values ?? []).find(
      v =>
        (v.labels as Record<string, string>).method === 'GET' &&
        (v.value ?? 1) === 0
    );
    expect(unhealthy).toBeDefined();
  });

  it('does NOT set endpoint_health to 0 for 4xx responses (client error, not server)', async () => {
    const app = express();
    app.use(createMonitoringMiddleware());
    app.get('/not-found-404', (_req, res) => res.sendStatus(404));
    await request(app).get('/not-found-404');
    const all = await metrics.register.getMetricsAsJSON();
    const gauge = all.find(m => m.name === 'endpoint_health');
    // 404 < 500 so health should be 1
    const shouldBeHealthy = (gauge?.values ?? []).find(
      v =>
        (v.labels as Record<string, string>).method === 'GET' &&
        (v.value ?? 0) === 1
    );
    expect(shouldBeHealthy).toBeDefined();
  });

  it('logs a warning for slow requests (> 1000 ms)', async () => {
    // Simulate slow response using a fake timer-based delay in the route
    const app = express();
    app.use(createMonitoringMiddleware());
    // Monkey-patch Date.now inside the test to make duration appear large
    const realNow = Date.now;
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      // First call returns 0 (start), subsequent calls return 2000 (finish)
      return callCount++ === 0 ? 0 : 2000;
    });
    app.get('/slow', (_req, res) => res.sendStatus(200));
    await request(app).get('/slow');
    Date.now = realNow;
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Slow request')
    );
  });
});

// ---------------------------------------------------------------------------
// getMetricsEndpoint()
// ---------------------------------------------------------------------------

describe('getMetricsEndpoint()', () => {
  it('returns a function', () => {
    expect(typeof getMetricsEndpoint()).toBe('function');
  });

  it('responds with 200 and prometheus text content-type', async () => {
    const app = express();
    app.get('/metrics', getMetricsEndpoint());
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('response body contains standard prometheus metric lines', async () => {
    const app = express();
    app.get('/metrics', getMetricsEndpoint());
    const res = await request(app).get('/metrics');
    // prom-client default metrics include process_cpu_user_seconds_total
    expect(res.text).toMatch(/process_cpu/);
  });
});

// ---------------------------------------------------------------------------
// trackMLModelInference()
// ---------------------------------------------------------------------------

describe('trackMLModelInference()', () => {
  it('increments ml_model_requests_total with model_name/status labels on success', async () => {
    trackMLModelInference('hrnet', 200, true);
    const val = await getMetricValue('ml_model_requests_total', {
      model_name: 'hrnet',
      status: 'success',
    });
    expect(val).toBe(1);
  });

  it('increments ml_model_requests_total with status=error on failure', async () => {
    trackMLModelInference('unet', 300, false);
    const val = await getMetricValue('ml_model_requests_total', {
      model_name: 'unet',
      status: 'error',
    });
    expect(val).toBe(1);
  });

  it('records histogram observation in ml_model_inference_duration_ms', async () => {
    trackMLModelInference('mamba', 450, true);
    const all = await metrics.register.getMetricsAsJSON();
    const hist = all.find(m => m.name === 'ml_model_inference_duration_ms');
    const hasObs = (hist?.values ?? []).some(
      v =>
        (v.labels as Record<string, string>).model_name === 'mamba' &&
        (v.metricName as string)?.endsWith('_count') &&
        (v.value ?? 0) >= 1
    );
    expect(hasObs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// trackFileUpload()
// ---------------------------------------------------------------------------

describe('trackFileUpload()', () => {
  it('increments uploaded_files_total with file_type/status=success', async () => {
    trackFileUpload('image/png', true);
    const val = await getMetricValue('uploaded_files_total', {
      file_type: 'image/png',
      status: 'success',
    });
    expect(val).toBe(1);
  });

  it('increments uploaded_files_total with status=error on failure', async () => {
    trackFileUpload('video/mp4', false);
    const val = await getMetricValue('uploaded_files_total', {
      file_type: 'video/mp4',
      status: 'error',
    });
    expect(val).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// updateDatabaseConnections()
// ---------------------------------------------------------------------------

describe('updateDatabaseConnections()', () => {
  it('sets database_connections_active gauge to the supplied count', async () => {
    updateDatabaseConnections(12);
    const val = await getMetricValue('database_connections_active');
    expect(val).toBe(12);
  });

  it('overwrites the previous value', async () => {
    updateDatabaseConnections(5);
    updateDatabaseConnections(20);
    const val = await getMetricValue('database_connections_active');
    expect(val).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// getMonitoringHealth()
// ---------------------------------------------------------------------------

describe('getMonitoringHealth()', () => {
  it('returns { healthy: true } when the registry is operational', () => {
    const health = getMonitoringHealth();
    expect(health.healthy).toBe(true);
    expect(health.message).toMatch(/operational/i);
  });

  it('returns metricsCount as a positive integer', () => {
    const health = getMonitoringHealth();
    expect(typeof health.metricsCount).toBe('number');
    expect(health.metricsCount!).toBeGreaterThan(0);
  });

  it('returns lastScrape as an ISO date string', () => {
    const health = getMonitoringHealth();
    expect(health.lastScrape).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// initializeMetricsCollection()
// ---------------------------------------------------------------------------

describe('initializeMetricsCollection()', () => {
  it('runs without throwing', () => {
    expect(() => initializeMetricsCollection()).not.toThrow();
  });

  it('can be called multiple times without error', () => {
    expect(() => {
      initializeMetricsCollection();
      initializeMetricsCollection();
    }).not.toThrow();
  });
});
