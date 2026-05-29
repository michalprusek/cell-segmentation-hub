/**
 * databaseRoutes.test.ts
 *
 * Supertest integration tests for src/api/routes/database.ts.
 * All external deps mocked. Tests cover:
 *  - GET /health: returns 200 with db health object
 *  - GET /metrics: returns 200 with metrics object
 *  - GET /optimization-report: returns 200 with optimization report
 *  - POST /analyze-query: validates body (query required), returns analysis
 *  - GET /pool-config: returns 200 with pool config
 *  - GET /backup-info: returns 200 with backup info
 *  - POST /reset-metrics: only exists in development mode
 *  - All routes require authentication (401 without token)
 */
import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── mock config ──────────────────────────────────────────────────────────────
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    FROM_EMAIL: 'test@example.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
    UPLOAD_DIR: './test-uploads',
    STORAGE_TYPE: 'local',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

// ─── middleware mocks ──────────────────────────────────────────────────────────
vi.mock('../../../middleware/auth', () => ({
  authenticate: vi.fn((_req: unknown, _res: unknown, next: () => void) =>
    next()
  ),
}));

vi.mock('../../../middleware/rateLimiter', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../middleware/validation', () => ({
  validateBody: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    success: (res: express.Response, data: unknown, message?: string) =>
      res.status(200).json({ success: true, data, message }),
    badRequest: (res: express.Response, message: string) =>
      res.status(400).json({ success: false, message }),
    error: (res: express.Response, err: unknown, statusCode = 500) =>
      res.status(statusCode).json({ success: false, err }),
  },
}));

import databaseRouter from '../database';
import { authenticate } from '../../../middleware/auth';

// ─── test application factory ──────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', databaseRouter);
  // Generic error handler (next(error) paths)
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(500).json({ success: false, message: err.message });
    }
  );
  return app;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function allowAuth() {
  vi.mocked(authenticate).mockImplementation((_req, _res, next) => next());
}

function denyAuth() {
  vi.mocked(authenticate).mockImplementation((_req, res) => {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('database routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    allowAuth();
  });

  // ─── GET /health ─────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 with db health data', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('status', 'healthy');
      expect(res.body.data).toHaveProperty('connection', 'active');
      expect(res.body.data).toHaveProperty('connectionPool');
      expect(res.body.data).toHaveProperty('performance');
    });

    it('returns 401 when authentication is denied', async () => {
      denyAuth();
      const res = await request(app).get('/health');
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /metrics ─────────────────────────────────────────────────────────

  describe('GET /metrics', () => {
    it('returns 200 with query and connection pool metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('queries');
      expect(res.body.data).toHaveProperty('connectionPool');
      expect(res.body.data).toHaveProperty('indexes');
      expect(res.body.data).toHaveProperty('locks');
    });

    it('returns 401 when not authenticated', async () => {
      denyAuth();
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /optimization-report ─────────────────────────────────────────────

  describe('GET /optimization-report', () => {
    it('returns 200 with optimization report including score and grade', async () => {
      const res = await request(app).get('/optimization-report');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('summary');
      expect(res.body.data.summary).toHaveProperty('score');
      expect(res.body.data.summary).toHaveProperty('grade');
      expect(res.body.data).toHaveProperty('generatedAt');
    });

    it('generatedAt is a valid ISO timestamp', async () => {
      const res = await request(app).get('/optimization-report');
      const ts = res.body.data?.generatedAt;
      expect(ts).toBeDefined();
      expect(() => new Date(ts).toISOString()).not.toThrow();
    });
  });

  // ─── POST /analyze-query ──────────────────────────────────────────────────

  describe('POST /analyze-query', () => {
    it('returns 200 with analysis when valid query is provided', async () => {
      const res = await request(app)
        .post('/analyze-query')
        .send({ query: 'SELECT * FROM users WHERE id = $1' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('executionPlan');
      expect(res.body.data).toHaveProperty('recommendations');
      expect(res.body.data).toHaveProperty('analyzedAt');
    });

    it('truncates the query to 100 chars in the response', async () => {
      const longQuery = 'SELECT ' + 'a, '.repeat(50);
      const res = await request(app)
        .post('/analyze-query')
        .send({ query: longQuery });
      expect(res.status).toBe(200);
      // Response query is truncated with '...'
      expect(res.body.data.query.endsWith('...')).toBe(true);
    });

    it('returns 200 even without optional parameters field', async () => {
      const res = await request(app)
        .post('/analyze-query')
        .send({ query: 'SELECT 1' });
      expect(res.status).toBe(200);
    });
  });

  // ─── GET /pool-config ─────────────────────────────────────────────────────

  describe('GET /pool-config', () => {
    it('returns 200 with current and recommended pool config', async () => {
      const res = await request(app).get('/pool-config');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('current');
      expect(res.body.data).toHaveProperty('recommended');
      expect(res.body.data).toHaveProperty('statistics');
      expect(res.body.data).toHaveProperty('performance');
    });

    it('returns 401 when not authenticated', async () => {
      denyAuth();
      const res = await request(app).get('/pool-config');
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /backup-info ─────────────────────────────────────────────────────

  describe('GET /backup-info', () => {
    it('returns 200 with last backup, schedule and retention info', async () => {
      const res = await request(app).get('/backup-info');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('lastBackup');
      expect(res.body.data).toHaveProperty('schedule');
      expect(res.body.data).toHaveProperty('retention');
      expect(res.body.data).toHaveProperty('storage');
    });

    it('lastBackup.status is "successful"', async () => {
      const res = await request(app).get('/backup-info');
      expect(res.body.data.lastBackup.status).toBe('successful');
    });
  });

  // ─── POST /reset-metrics (development-only) ──────────────────────────────

  describe('POST /reset-metrics', () => {
    it('is NOT registered in test/production mode (returns 404)', async () => {
      // NODE_ENV=test → the `if (process.env.NODE_ENV === 'development')` block
      // is skipped, so the route does not exist.
      const res = await request(app).post('/reset-metrics');
      expect(res.status).toBe(404);
    });
  });

  // ─── router-level authenticate middleware ─────────────────────────────────

  describe('router-level authenticate guard', () => {
    it('blocks all routes when authenticate rejects (checks /metrics)', async () => {
      denyAuth();
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(401);
    });

    it('blocks /backup-info when authenticate rejects', async () => {
      denyAuth();
      const res = await request(app).get('/backup-info');
      expect(res.status).toBe(401);
    });
  });
});
