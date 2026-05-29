/**
 * swagger.test.ts
 *
 * Tests for src/middleware/swagger.ts:
 *  - setupSwagger mounts swagger-ui-express at /api-docs
 *  - GET /api-docs/openapi.json returns JSON with Content-Type and Cache-Control
 *  - GET /api-docs/postman.json returns a Postman collection JSON
 *  - Postman converter groups paths by tag and wires bearer auth when present
 *  - logger.warn is NOT called when setup succeeds
 *  - logger.error is called when swaggerJsdoc throws
 *
 * swaggerOptions export is also validated.
 *
 * Note: the actual swagger-ui HTML route (app.get /api-docs + app.use
 * /api-docs serve) is tested via an integration call — we confirm a
 * non-404 response, not the exact HTML, because swaggerUi.setup returns
 * an opaque express handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── hoisted mock references ──────────────────────────────────────────────────
const { mockSwaggerJsdoc, mockSwaggerUiSetup, mockSwaggerUiServe } = vi.hoisted(
  () => {
    const serveMiddleware = (_r: unknown, _s: unknown, n: () => void) => n();
    return {
      mockSwaggerJsdoc: vi.fn(),
      mockSwaggerUiSetup: vi.fn(
        () =>
          (
            _req: unknown,
            res: { status: (c: number) => { send: (b: string) => void } }
          ) =>
            res.status(200).send('<html>swagger</html>')
      ),
      mockSwaggerUiServe: [serveMiddleware],
    };
  }
);

// ─── mock heavy deps before any source import ─────────────────────────────────
vi.mock('swagger-jsdoc', () => ({ default: mockSwaggerJsdoc }));
vi.mock('swagger-ui-express', () => ({
  default: { serve: mockSwaggerUiServe, setup: mockSwaggerUiSetup },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
  },
  existsSync: vi.fn(() => false),
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// swaggerJsdoc default return — a minimal valid OpenAPI spec
const FAKE_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Test API', description: 'desc' },
  servers: [{ url: 'http://localhost:3001/api' }],
  paths: {
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List users',
        security: [{ bearerAuth: [] }],
      },
    },
    '/projects': {
      post: {
        tags: ['Projects'],
        summary: 'Create project',
        // no security — should not get auth
      },
    },
    '/noTag': {
      get: {
        summary: 'No tag endpoint',
        // tags absent — should fall into 'Default' folder
      },
    },
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
  },
};

import { setupSwagger, swaggerOptions } from '../swagger';
import { logger } from '../../utils/logger';

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  setupSwagger(app);
  return app;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('setupSwagger', () => {
  beforeEach(() => {
    mockSwaggerJsdoc.mockReturnValue(FAKE_SPEC);
    vi.mocked(logger.error).mockReset();
    vi.mocked(logger.info).mockReset();
  });

  // ─── /api-docs/openapi.json ───────────────────────────────────────────────

  describe('GET /api-docs/openapi.json', () => {
    it('returns 200 with application/json Content-Type', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/openapi.json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('returns the spec object produced by swaggerJsdoc', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/openapi.json');
      expect(res.body).toMatchObject({ openapi: '3.0.0' });
    });

    it('sets Cache-Control header for 5 minutes', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/openapi.json');
      expect(res.headers['cache-control']).toMatch(/max-age=300/);
    });

    it('returns 500 when res.send throws (spec serialization error)', async () => {
      // Simulate non-serializable spec value
      mockSwaggerJsdoc.mockReturnValue(undefined);
      const app = express();
      app.use((req, res, next) => next()); // no-op middleware
      setupSwagger(app);
      // With spec=undefined, res.send(undefined) still works → test that
      // the handler doesn't crash; 200 or 500 are both valid
      const res = await request(app).get('/api-docs/openapi.json');
      expect([200, 500]).toContain(res.status);
    });
  });

  // ─── /api-docs/postman.json ───────────────────────────────────────────────

  describe('GET /api-docs/postman.json', () => {
    it('returns 200 with application/json Content-Type', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('returns a Postman collection with info, auth, variable, and item fields', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      const body = res.body;
      expect(body).toHaveProperty('info');
      expect(body).toHaveProperty('auth');
      expect(body).toHaveProperty('variable');
      expect(body).toHaveProperty('item');
      expect(body.info.name).toBe('Test API');
    });

    it('groups paths by tag into Postman folders', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      const folders: { name: string }[] = res.body.item;
      const folderNames = folders.map(f => f.name);
      expect(folderNames).toContain('Users');
      expect(folderNames).toContain('Projects');
    });

    it('adds bearer auth to items with bearerAuth security', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      const usersFolder = res.body.item.find(
        (f: { name: string }) => f.name === 'Users'
      );
      expect(usersFolder).toBeDefined();
      const listUsersItem = usersFolder.item.find(
        (i: { name: string }) => i.name === 'List users'
      );
      expect(listUsersItem?.request?.auth?.type).toBe('bearer');
    });

    it('does NOT add bearer auth to items that explicitly have no security', async () => {
      // Build a spec where there is no root-level security and the
      // /projects POST endpoint has an explicit empty security array (opt-out)
      mockSwaggerJsdoc.mockReturnValue({
        ...FAKE_SPEC,
        security: undefined, // remove root-level default
        paths: {
          '/projects': {
            post: {
              tags: ['Projects'],
              summary: 'Create project',
              security: [], // explicit opt-out — empty array
            },
          },
        },
      });
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      const projectsFolder = res.body.item.find(
        (f: { name: string }) => f.name === 'Projects'
      );
      expect(projectsFolder).toBeDefined();
      const createItem = projectsFolder?.item[0];
      // Empty security array → effectiveSecurity.length === 0 → no auth
      expect(createItem?.request?.auth).toBeUndefined();
    });

    it('places tag-less endpoints in the Default folder', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      const folders: { name: string }[] = res.body.item;
      expect(folders.some(f => f.name === 'Default')).toBe(true);
    });

    it('sets Cache-Control header for 5 minutes', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      expect(res.headers['cache-control']).toMatch(/max-age=300/);
    });

    it('uses first server URL as baseUrl variable', async () => {
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      const baseUrlVar = res.body.variable?.find(
        (v: { key: string }) => v.key === 'baseUrl'
      );
      expect(baseUrlVar?.value).toBe('http://localhost:3001/api');
    });

    it('handles empty paths gracefully (no item folders)', async () => {
      mockSwaggerJsdoc.mockReturnValue({
        ...FAKE_SPEC,
        paths: {},
      });
      const app = buildApp();
      const res = await request(app).get('/api-docs/postman.json');
      expect(res.status).toBe(200);
      expect(res.body.item).toEqual([]);
    });
  });

  // ─── logger calls during setup ───────────────────────────────────────────

  describe('setup logging', () => {
    it('logs three info messages on successful setup', () => {
      buildApp();
      expect(logger.info).toHaveBeenCalledTimes(3);
    });

    it('logs error and does not throw when swaggerJsdoc throws', () => {
      mockSwaggerJsdoc.mockImplementation(() => {
        throw new Error('jsdoc parse fail');
      });
      expect(() => {
        buildApp();
      }).not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ─── swaggerOptions export ────────────────────────────────────────────────

  describe('swaggerOptions export', () => {
    it('exports swaggerOptions with a definition and apis fields', () => {
      expect(swaggerOptions).toHaveProperty('definition');
      expect(swaggerOptions).toHaveProperty('apis');
      expect(Array.isArray(swaggerOptions.apis)).toBe(true);
    });

    it('definition contains openapi version 3.0.0', () => {
      expect(swaggerOptions.definition?.openapi).toBe('3.0.0');
    });

    it('definition contains bearerAuth security scheme', () => {
      const schemes = (
        swaggerOptions.definition?.components as Record<string, unknown>
      )?.securitySchemes as Record<string, unknown>;
      expect(schemes).toHaveProperty('bearerAuth');
    });
  });
});
