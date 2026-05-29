/**
 * Tests for src/api/routes/rateLimitAdmin.ts
 *
 * Behavioral focus:
 *  - All routes require authentication (authenticate middleware is first)
 *  - GET /status   → returns system/tiers/violations/whitelists structure
 *  - GET /configurations → returns algorithm config + tier configs + endpoint configs
 *  - GET /violations → honours limit/offset/timeRange query params in response
 *  - GET /whitelist/ips → returns array of IP entries
 *  - POST /whitelist/ips → validates body (ip must be valid, reason required);
 *      rejects bad body 400, accepts valid body 200 with ip/reason in data
 *  - GET /whitelist/users → returns array of user entries
 *  - POST /whitelist/users → validates userId (UUID) + reason; 400 on bad UUID
 *  - POST /blacklist/ips → validates target + reason; computes expiresAt from duration
 *  - POST /blacklist/users → same; null expiresAt when duration absent
 *  - GET /tiers → returns distribution/upgrades/usage structure
 *  - PUT /tiers/user → validates userId (UUID) + tier enum; returns updated record
 *  - PUT /tiers/bulk → validates users array + reason; returns updatedCount
 *  - POST /reset → returns key + resetAt
 *  - GET /metrics → returns requests/performance/trends structure
 *  - POST /cleanup → returns expiredWhitelistEntries/totalCleaned/cleanedAt
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks — MUST be before any source import
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/config', () => ({
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

// Stub authenticate to inject a fake userId so route handlers can read it
vi.mock('../../../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId = 'admin-user-uuid';
    next();
  },
  optionalAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Stub rate limiter middleware — just pass through (factory form to avoid hoisting issues)
vi.mock('../../../middleware/rateLimiter', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ---------------------------------------------------------------------------
// Import the router after mocks are registered
// ---------------------------------------------------------------------------
import rateLimitAdminRouter from '../rateLimitAdmin';

// ---------------------------------------------------------------------------
// Build a minimal Express app that mounts the router
// ---------------------------------------------------------------------------
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/', rateLimitAdminRouter);
  // Simple error handler so 4xx/5xx body is returned as JSON
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

let app: Express;

beforeEach(() => {
  app = buildApp();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------
describe('GET /status', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response data contains system.enabled flag', async () => {
    const res = await request(app).get('/status');
    expect(res.body.data.system.enabled).toBe(true);
  });

  it('response data contains all four tiers', async () => {
    const res = await request(app).get('/status');
    const tiers = Object.keys(res.body.data.tiers);
    expect(tiers).toContain('anonymous');
    expect(tiers).toContain('authenticated');
    expect(tiers).toContain('premium');
    expect(tiers).toContain('admin');
  });

  it('response data contains violations summary with last24h', async () => {
    const res = await request(app).get('/status');
    expect(typeof res.body.data.violations.last24h).toBe('number');
  });

  it('response data contains whitelists.ips and whitelists.users counts', async () => {
    const res = await request(app).get('/status');
    expect(typeof res.body.data.whitelists.ips).toBe('number');
    expect(typeof res.body.data.whitelists.users).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// GET /configurations
// ---------------------------------------------------------------------------
describe('GET /configurations', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app).get('/configurations');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response contains default algorithm', async () => {
    const res = await request(app).get('/configurations');
    expect(res.body.data.default.algorithm).toBeTruthy();
  });

  it('response contains tiers object with windowMs for each tier', async () => {
    const res = await request(app).get('/configurations');
    const { tiers } = res.body.data;
    expect(typeof tiers.anonymous.windowMs).toBe('number');
    expect(typeof tiers.authenticated.windowMs).toBe('number');
    expect(typeof tiers.premium.windowMs).toBe('number');
    expect(typeof tiers.admin.windowMs).toBe('number');
  });

  it('response contains endpoint-specific limits', async () => {
    const res = await request(app).get('/configurations');
    const endpoints = res.body.data.endpoints;
    expect(endpoints['/api/auth/login']).toHaveProperty('limit');
  });
});

// ---------------------------------------------------------------------------
// GET /violations
// ---------------------------------------------------------------------------
describe('GET /violations', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app).get('/violations');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response contains pagination with limit and offset', async () => {
    const res = await request(app).get('/violations?limit=10&offset=5');
    expect(res.body.data.pagination.limit).toBe(10);
    expect(res.body.data.pagination.offset).toBe(5);
  });

  it('summary reflects queried timeRange', async () => {
    const res = await request(app).get('/violations?timeRange=1h');
    expect(res.body.data.summary.timeRange).toBe('1h');
  });

  it('violations is an array', async () => {
    const res = await request(app).get('/violations');
    expect(Array.isArray(res.body.data.violations)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /whitelist/ips
// ---------------------------------------------------------------------------
describe('GET /whitelist/ips', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app).get('/whitelist/ips');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response data is an array of IP entries with ip and reason', async () => {
    const res = await request(app).get('/whitelist/ips');
    expect(Array.isArray(res.body.data)).toBe(true);
    const first = res.body.data[0];
    expect(first).toHaveProperty('ip');
    expect(first).toHaveProperty('reason');
  });
});

// ---------------------------------------------------------------------------
// POST /whitelist/ips
// ---------------------------------------------------------------------------
describe('POST /whitelist/ips', () => {
  it('returns 400 when ip is not a valid IP address', async () => {
    const res = await request(app)
      .post('/whitelist/ips')
      .send({ ip: 'not-an-ip', reason: 'testing' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is missing', async () => {
    const res = await request(app)
      .post('/whitelist/ips')
      .send({ ip: '10.0.0.1' });
    expect(res.status).toBe(400);
  });

  it('returns 200 with the whitelisted IP echoed back', async () => {
    const res = await request(app)
      .post('/whitelist/ips')
      .send({ ip: '10.0.0.42', reason: 'internal network' });
    expect(res.status).toBe(200);
    expect(res.body.data.ip).toBe('10.0.0.42');
    expect(res.body.data.reason).toBe('internal network');
  });

  it('includes addedBy from the authenticated userId', async () => {
    const res = await request(app)
      .post('/whitelist/ips')
      .send({ ip: '10.0.0.1', reason: 'ok' });
    expect(res.body.data.addedBy).toBe('admin-user-uuid');
  });

  it('accepts optional expiresAt and reflects it in response', async () => {
    const expiry = new Date(Date.now() + 86400000).toISOString();
    const res = await request(app)
      .post('/whitelist/ips')
      .send({ ip: '10.0.0.1', reason: 'temp', expiresAt: expiry });
    expect(res.status).toBe(200);
    expect(res.body.data.expiresAt).toBe(expiry);
  });

  it('sets expiresAt to null when not provided', async () => {
    const res = await request(app)
      .post('/whitelist/ips')
      .send({ ip: '10.0.0.1', reason: 'permanent' });
    expect(res.body.data.expiresAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /whitelist/users
// ---------------------------------------------------------------------------
describe('GET /whitelist/users', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app).get('/whitelist/users');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response data is an array with userId and reason', async () => {
    const res = await request(app).get('/whitelist/users');
    expect(Array.isArray(res.body.data)).toBe(true);
    const first = res.body.data[0];
    expect(first).toHaveProperty('userId');
    expect(first).toHaveProperty('reason');
  });
});

// ---------------------------------------------------------------------------
// POST /whitelist/users
// ---------------------------------------------------------------------------
describe('POST /whitelist/users', () => {
  it('returns 400 when userId is not a UUID', async () => {
    const res = await request(app)
      .post('/whitelist/users')
      .send({ userId: 'not-uuid', reason: 'testing' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is missing', async () => {
    const res = await request(app)
      .post('/whitelist/users')
      .send({ userId: '00000000-0000-0000-0000-000000000001' });
    expect(res.status).toBe(400);
  });

  it('returns 200 with userId echoed in response', async () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app)
      .post('/whitelist/users')
      .send({ userId, reason: 'api partner' });
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(userId);
    expect(res.body.data.reason).toBe('api partner');
  });
});

// ---------------------------------------------------------------------------
// POST /blacklist/ips
// ---------------------------------------------------------------------------
describe('POST /blacklist/ips', () => {
  it('returns 400 when target is missing', async () => {
    const res = await request(app)
      .post('/blacklist/ips')
      .send({ reason: 'abuser' });
    expect(res.status).toBe(400);
  });

  it('returns 200 with ip derived from target field', async () => {
    const res = await request(app)
      .post('/blacklist/ips')
      .send({ target: '1.2.3.4', reason: 'scraper' });
    expect(res.status).toBe(200);
    expect(res.body.data.ip).toBe('1.2.3.4');
  });

  it('computes expiresAt from duration (seconds) when provided', async () => {
    const before = Date.now();
    const res = await request(app)
      .post('/blacklist/ips')
      .send({ target: '1.2.3.4', reason: 'temp block', duration: 3600 });
    const after = Date.now();
    const expiresMs = new Date(res.body.data.expiresAt as string).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 3600 * 1000 - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + 3600 * 1000 + 1000);
  });

  it('sets expiresAt to null when duration is absent', async () => {
    const res = await request(app)
      .post('/blacklist/ips')
      .send({ target: '1.2.3.4', reason: 'permanent ban' });
    expect(res.body.data.expiresAt).toBeNull();
  });

  it('rejects duration below 60 (schema min)', async () => {
    const res = await request(app)
      .post('/blacklist/ips')
      .send({ target: '1.2.3.4', reason: 'bad', duration: 10 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /blacklist/users
// ---------------------------------------------------------------------------
describe('POST /blacklist/users', () => {
  it('returns 200 with userId derived from target', async () => {
    const res = await request(app)
      .post('/blacklist/users')
      .send({ target: 'user-789', reason: 'spam' });
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe('user-789');
  });

  it('sets null expiresAt when no duration', async () => {
    const res = await request(app)
      .post('/blacklist/users')
      .send({ target: 'user-999', reason: 'abuse' });
    expect(res.body.data.expiresAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /tiers
// ---------------------------------------------------------------------------
describe('GET /tiers', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app).get('/tiers');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response data contains distribution with all tier counts', async () => {
    const res = await request(app).get('/tiers');
    const dist = res.body.data.distribution;
    expect(typeof dist.anonymous).toBe('number');
    expect(typeof dist.authenticated).toBe('number');
    expect(typeof dist.premium).toBe('number');
    expect(typeof dist.admin).toBe('number');
  });

  it('response data contains usage per tier', async () => {
    const res = await request(app).get('/tiers');
    expect(res.body.data.usage.anonymous).toHaveProperty(
      'avgRequestsPerMinute'
    );
  });
});

// ---------------------------------------------------------------------------
// PUT /tiers/user
// ---------------------------------------------------------------------------
describe('PUT /tiers/user', () => {
  it('returns 400 when userId is not a UUID', async () => {
    const res = await request(app)
      .put('/tiers/user')
      .send({ userId: 'bad-id', tier: 'premium' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when tier is not a valid enum value', async () => {
    const res = await request(app)
      .put('/tiers/user')
      .send({
        userId: '00000000-0000-0000-0000-000000000001',
        tier: 'superadmin',
      });
    expect(res.status).toBe(400);
  });

  it('returns 200 with updated userId and tier', async () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const res = await request(app)
      .put('/tiers/user')
      .send({ userId, tier: 'premium' });
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(userId);
    expect(res.body.data.tier).toBe('premium');
  });

  it('includes updatedBy from the authenticated userId', async () => {
    const res = await request(app)
      .put('/tiers/user')
      .send({ userId: '00000000-0000-0000-0000-000000000001', tier: 'admin' });
    expect(res.body.data.updatedBy).toBe('admin-user-uuid');
  });
});

// ---------------------------------------------------------------------------
// PUT /tiers/bulk
// ---------------------------------------------------------------------------
describe('PUT /tiers/bulk', () => {
  it('returns 400 when users array is absent', async () => {
    const res = await request(app)
      .put('/tiers/bulk')
      .send({ reason: 'batch upgrade' });
    expect(res.status).toBe(400);
  });

  it('returns 200 with updatedCount equal to users array length', async () => {
    const users = [
      { userId: '00000000-0000-0000-0000-000000000001', tier: 'premium' },
      { userId: '00000000-0000-0000-0000-000000000002', tier: 'admin' },
    ];
    const res = await request(app)
      .put('/tiers/bulk')
      .send({ users, reason: 'promotion' });
    expect(res.status).toBe(200);
    expect(res.body.data.updatedCount).toBe(2);
    expect(res.body.data.reason).toBe('promotion');
  });
});

// ---------------------------------------------------------------------------
// POST /reset
// ---------------------------------------------------------------------------
describe('POST /reset', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app)
      .post('/reset')
      .send({ key: 'anonymous:ip:1.2.3.4' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('echoes the key back in the response data', async () => {
    const res = await request(app)
      .post('/reset')
      .send({ key: 'auth:ip:5.6.7.8' });
    expect(res.body.data.key).toBe('auth:ip:5.6.7.8');
  });

  it('includes resetAt ISO timestamp in the response data', async () => {
    const res = await request(app).post('/reset').send({ key: 'test-key' });
    expect(res.body.data.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// GET /metrics
// ---------------------------------------------------------------------------
describe('GET /metrics', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response data has requests.total, requests.blocked, requests.blockRate', async () => {
    const res = await request(app).get('/metrics');
    const { requests } = res.body.data;
    expect(typeof requests.total).toBe('number');
    expect(typeof requests.blocked).toBe('number');
    expect(requests.blockRate).toBeTruthy();
  });

  it('response data has performance object', async () => {
    const res = await request(app).get('/metrics');
    expect(res.body.data.performance).toHaveProperty('averageCheckTime');
  });

  it('response data has trends.hourly array', async () => {
    const res = await request(app).get('/metrics');
    expect(Array.isArray(res.body.data.trends.hourly)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /cleanup
// ---------------------------------------------------------------------------
describe('POST /cleanup', () => {
  it('returns 200 with success:true', async () => {
    const res = await request(app).post('/cleanup');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('response data contains totalCleaned count', async () => {
    const res = await request(app).post('/cleanup');
    expect(typeof res.body.data.totalCleaned).toBe('number');
  });

  it('response data contains cleanedAt ISO timestamp', async () => {
    const res = await request(app).post('/cleanup');
    expect(res.body.data.cleanedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('totalCleaned equals sum of expired entries', async () => {
    const res = await request(app).post('/cleanup');
    const {
      expiredWhitelistEntries,
      expiredBlacklistEntries,
      oldViolations,
      totalCleaned,
    } = res.body.data as {
      expiredWhitelistEntries: number;
      expiredBlacklistEntries: number;
      oldViolations: number;
      totalCleaned: number;
    };
    expect(totalCleaned).toBe(
      expiredWhitelistEntries + expiredBlacklistEntries + oldViolations
    );
  });
});
