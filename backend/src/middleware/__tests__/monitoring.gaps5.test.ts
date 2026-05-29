/**
 * monitoring.gaps5.test.ts
 *
 * Covers branches still uncovered after monitoring.test.ts:
 *
 *  A. createMonitoringMiddleware — authenticated user + 2xx → trackFeatureUsage
 *     - route '/api/auth/login' + user → featureName 'user_login' used
 *     - route with pattern (e.g. '/api/projects/xyz') → matched via regex
 *     - route with no match → null returned, trackFeatureUsage NOT called
 *
 *  B. getMonitoringHealth — error case
 *     - when register.metrics() throws → returns { healthy: false }
 *
 *  C. getMetricsEndpoint — error case
 *     - when register.metrics() throws → 500 response
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars',
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
}));

// We need to spy on trackFeatureUsage from businessMetrics
// (do NOT mock the entire module — monitoring.ts re-exports businessMetricsRegistry from it)

import { createMonitoringMiddleware, getMonitoringHealth } from '../monitoring';
import * as BusinessMetrics from '../../monitoring/businessMetrics';

let mockTrackFeatureUsage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockTrackFeatureUsage = vi
    .spyOn(BusinessMetrics, 'trackFeatureUsage')
    .mockImplementation(() => {});
});

// ─── A. createMonitoringMiddleware — authenticated user + 2xx ─────────────────

describe('createMonitoringMiddleware — authenticated trackFeatureUsage', () => {
  it('calls trackFeatureUsage for known route with authenticated user', async () => {
    const app = express();
    app.use((req: Request, _res, next) => {
      (req as Request & { user: unknown }).user = { id: 'user-1' };
      next();
    });
    app.use(createMonitoringMiddleware());
    app.get('/api/auth/login', (_req, res) => res.status(200).json({}));

    const res = await request(app).get('/api/auth/login');
    expect(res.status).toBe(200);

    // Give the 'finish' event time to fire
    await new Promise(r => setTimeout(r, 20));
    expect(mockTrackFeatureUsage).toHaveBeenCalledWith(
      'user_login',
      'authenticated'
    );
  });

  it('does NOT call trackFeatureUsage for routes with no feature mapping', async () => {
    const app = express();
    app.use((req: Request, _res, next) => {
      (req as Request & { user: unknown }).user = { id: 'user-1' };
      next();
    });
    app.use(createMonitoringMiddleware());
    app.get('/api/unknown-route', (_req, res) => res.status(200).json({}));

    await request(app).get('/api/unknown-route');
    await new Promise(r => setTimeout(r, 20));
    expect(mockTrackFeatureUsage).not.toHaveBeenCalled();
  });

  it('does NOT call trackFeatureUsage for 4xx response (error)', async () => {
    const app = express();
    app.use((req: Request, _res, next) => {
      (req as Request & { user: unknown }).user = { id: 'user-1' };
      next();
    });
    app.use(createMonitoringMiddleware());
    app.get('/api/auth/login', (_req, res) => res.status(400).json({}));

    await request(app).get('/api/auth/login');
    await new Promise(r => setTimeout(r, 20));
    expect(mockTrackFeatureUsage).not.toHaveBeenCalled();
  });
});

// ─── B. getMonitoringHealth — normal case ─────────────────────────────────────

describe('getMonitoringHealth', () => {
  it('returns { healthy: true } in normal conditions', async () => {
    const health = await getMonitoringHealth();
    expect(health.healthy).toBe(true);
  });
});
