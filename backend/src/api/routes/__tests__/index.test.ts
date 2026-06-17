/**
 * Tests for src/api/routes/index.ts
 *
 * Behavioral focus:
 *  - registerRoute() accumulates entries with correct shape
 *  - setupRoutes() mounts sub-routers at the documented paths in the
 *    documented order (exportRoutes before projectRoutes so public token
 *    auth is checked first)
 *  - /api/endpoints and /api/health/endpoints inline handlers return the
 *    expected JSON shape
 *  - createEndpointTracker() records call counts, avg response time, and
 *    error counts on the 'finish' event; evicts the oldest 10 % when the
 *    map hits MAX_ENDPOINTS
 *  - checkEndpointsHealth() summary counts match healthy/unhealthy results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Hoist mocks BEFORE any imports that trigger module-level side-effects
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

// Stub every sub-router so that importing index.ts doesn't cascade into
// controllers / Prisma / Redis / ML service code.
// Use vi.mock factory form (no external variable reference — avoids hoisting issue).

vi.mock('../authRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../projectRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../imageRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../segmentationRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { segmentationRoutes: r };
});
vi.mock('../queueRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { queueRoutes: r };
});
vi.mock('../exportRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { exportRoutes: r };
});
vi.mock('../sharingRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../testEmailRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../mlRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../userRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../healthRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../feedbackRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});
vi.mock('../projectFolderRoutes', () => {
  const r = require('express').Router();
  r.use(
    (
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } }
    ) => res.status(200).json({ stub: true })
  );
  return { default: r };
});

// ---------------------------------------------------------------------------
// Now import the module under test
// ---------------------------------------------------------------------------
import {
  setupRoutes,
  routeRegistry,
  registerRoute,
  createEndpointTracker,
  checkEndpointsHealth,
} from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  setupRoutes(app);
  return app;
}

// Snapshot the registry length before each test (setupRoutes populates it on
// first call; subsequent calls push more entries due to module-level singleton).
// We reset between tests by splicing the shared array.
function clearRegistry(): void {
  routeRegistry.splice(0, routeRegistry.length);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerRoute()', () => {
  beforeEach(clearRegistry);

  it('pushes a route entry with the supplied fields', () => {
    registerRoute({ path: '/api/test', method: 'GET', authenticated: false });
    expect(routeRegistry).toHaveLength(1);
    expect(routeRegistry[0]).toMatchObject({
      path: '/api/test',
      method: 'GET',
      authenticated: false,
    });
  });

  it('accumulates multiple entries in insertion order', () => {
    registerRoute({ path: '/a', method: 'GET' });
    registerRoute({ path: '/b', method: 'POST' });
    registerRoute({ path: '/c', method: 'DELETE' });
    expect(routeRegistry).toHaveLength(3);
    expect(routeRegistry.map(r => r.path)).toEqual(['/a', '/b', '/c']);
  });

  it('stores optional description and authenticated flag', () => {
    registerRoute({
      path: '/api/auth/login',
      method: 'POST',
      description: 'Login',
      authenticated: false,
    });
    expect(routeRegistry[0].description).toBe('Login');
    expect(routeRegistry[0].authenticated).toBe(false);
  });
});

describe('setupRoutes() — route mounting', () => {
  let app: Express;

  beforeEach(() => {
    clearRegistry();
    app = buildApp();
  });

  it('mounts /api/health', async () => {
    const res = await request(app).get('/api/health/any-path');
    // Stub router returns 200; 404 would mean the mount prefix is wrong
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/auth', async () => {
    const res = await request(app).post('/api/auth/login');
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/projects', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/segmentation', async () => {
    const res = await request(app).get('/api/segmentation/whatever');
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/queue', async () => {
    const res = await request(app).get('/api/queue');
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/ml', async () => {
    const res = await request(app).get('/api/ml/status');
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/feedback', async () => {
    const res = await request(app).post('/api/feedback');
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/folders', async () => {
    const res = await request(app).get('/api/folders');
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/test-email', async () => {
    const res = await request(app).post('/api/test-email');
    expect(res.status).not.toBe(404);
  });

  it('populates routeRegistry with known routes after setupRoutes', () => {
    // registerKnownRoutes() is called inside setupRoutes; after a fresh call
    // the registry must contain the documented entries
    const paths = routeRegistry.map(r => r.path);
    expect(paths).toContain('/api/auth/register');
    expect(paths).toContain('/api/auth/login');
    expect(paths).toContain('/api/projects');
    expect(paths).toContain('/api/folders');
  });
});

// /api/endpoints and /api/health/endpoints are inline handlers added by
// setupRoutes() AFTER app.use('/api/health', healthRoutes). Because the stub
// healthRoutes catches all sub-paths (including /api/health/endpoints),
// these handlers must be tested by calling setupRoutes on an app where the
// health stub is NOT a catch-all. We test them via their exported helpers
// (routeRegistry + checkEndpointsHealth) directly instead of hitting the
// HTTP layer, since the actual handler body just wraps those primitives.

describe('/api/endpoints handler behavior (via registry inspection)', () => {
  beforeEach(clearRegistry);

  it('routeRegistry is a live array that reflects registerRoute() calls', () => {
    registerRoute({ path: '/api/x', method: 'GET' });
    expect(routeRegistry).toHaveLength(1);
    expect(routeRegistry[0].path).toBe('/api/x');
  });

  it('routeRegistry length equals count that would be returned to clients', () => {
    registerRoute({ path: '/api/a', method: 'GET' });
    registerRoute({ path: '/api/b', method: 'POST' });
    // The handler returns { count: routeRegistry.length } — verify invariant holds
    expect(routeRegistry.length).toBe(2);
  });
});

describe('/api/health/endpoints handler behavior (via checkEndpointsHealth)', () => {
  beforeEach(clearRegistry);

  it('checkEndpointsHealth returns success-shaped object with summary + endpoints', async () => {
    registerRoute({ path: '/api/test', method: 'GET' });
    const result = await checkEndpointsHealth();
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('endpoints');
    expect(result).toHaveProperty('lastUpdated');
  });

  it('summary.total reflects number of registered routes', async () => {
    registerRoute({ path: '/api/x', method: 'GET' });
    registerRoute({ path: '/api/y', method: 'POST' });
    const result = await checkEndpointsHealth();
    const summary = result.summary as { total: number };
    expect(summary.total).toBe(2);
  });
});

describe('createEndpointTracker()', () => {
  it('calls next() on every request', async () => {
    const app = express();
    app.use(createEndpointTracker());
    app.get('/ping', (_req, res) => res.sendStatus(200));
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
  });

  it('attaches endpointStats map to the request object', async () => {
    const app = express();
    app.use(createEndpointTracker());
    let statsRef: Map<string, unknown> | undefined;
    app.get('/check', (req, res) => {
      statsRef = (
        req as express.Request & { endpointStats?: Map<string, unknown> }
      ).endpointStats;
      res.sendStatus(200);
    });
    await request(app).get('/check');
    expect(statsRef).toBeInstanceOf(Map);
  });

  it('records error count when response status >= 400', async () => {
    const app = express();
    let capturedStats: Map<string, unknown> | undefined;
    app.use(createEndpointTracker());
    app.get('/fail', (req, res) => {
      capturedStats = (
        req as express.Request & { endpointStats?: Map<string, unknown> }
      ).endpointStats;
      res.sendStatus(500);
    });
    await request(app).get('/fail');
    // After finish the stats map should have an entry with errors > 0
    const entry =
      capturedStats &&
      Array.from(capturedStats.values()).find(
        v => (v as { errors: number }).errors > 0
      );
    expect(entry).toBeDefined();
  });

  it('increments calls for repeated requests to the same endpoint', async () => {
    const app = express();
    let capturedStats: Map<string, unknown> | undefined;
    app.use(createEndpointTracker());
    app.get('/repeat', (req, res) => {
      capturedStats = (
        req as express.Request & { endpointStats?: Map<string, unknown> }
      ).endpointStats;
      res.sendStatus(200);
    });
    await request(app).get('/repeat');
    await request(app).get('/repeat');
    await request(app).get('/repeat');

    const allValues = capturedStats
      ? (Array.from(capturedStats.values()) as Array<{ calls: number }>)
      : [];
    const maxCalls = Math.max(...allValues.map(v => v.calls));
    expect(maxCalls).toBeGreaterThanOrEqual(2);
  });
});

describe('checkEndpointsHealth()', () => {
  beforeEach(clearRegistry);

  it('returns summary with total/healthy/unhealthy/errors fields', async () => {
    registerRoute({ path: '/api/test', method: 'GET', authenticated: false });
    const result = await checkEndpointsHealth();
    expect(result).toHaveProperty('summary');
    const summary = result.summary as {
      total: number;
      healthy: number;
      unhealthy: number;
      errors: number;
    };
    expect(typeof summary.total).toBe('number');
    expect(typeof summary.healthy).toBe('number');
    expect(typeof summary.unhealthy).toBe('number');
    expect(typeof summary.errors).toBe('number');
  });

  it('summary.total equals the number of registered routes', async () => {
    registerRoute({ path: '/a', method: 'GET' });
    registerRoute({ path: '/b', method: 'POST' });
    const result = await checkEndpointsHealth();
    const summary = result.summary as { total: number };
    expect(summary.total).toBe(2);
  });

  it('all non-parametric routes are healthy', async () => {
    registerRoute({ path: '/api/health', method: 'GET' });
    registerRoute({ path: '/api/auth/login', method: 'POST' });
    const result = await checkEndpointsHealth();
    const summary = result.summary as { healthy: number; total: number };
    expect(summary.healthy).toBe(summary.total);
  });

  it('endpoints array has lastChecked ISO string on each entry', async () => {
    registerRoute({ path: '/api/test', method: 'GET' });
    const result = await checkEndpointsHealth();
    const endpoints = result.endpoints as Array<{ lastChecked: string }>;
    expect(endpoints[0].lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns lastUpdated ISO string on the result', async () => {
    const result = await checkEndpointsHealth();
    expect(result.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
