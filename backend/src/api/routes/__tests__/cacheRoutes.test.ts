import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import type { MockedFunction } from 'vitest';
import cacheRoutes from '../cacheRoutes';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';

// Mock config and jwt early to prevent process.exit during module loading
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    FROM_EMAIL: 'test@example.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));
vi.mock('../../../auth/jwt');

// Mock dependencies before router resolution
vi.mock('../../../middleware/auth');
vi.mock('../../../middleware/rateLimiter', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../../middleware/validation', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  validateParams: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../../utils/logger');
vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    success: (res: any, data: any, message: any, statusCode: any) =>
      res.status(statusCode ?? 200).json({ success: true, data, message }),
    unauthorized: (res: any, message: any) =>
      res.status(401).json({ success: false, message }),
    notFound: (res: any, message: any) =>
      res.status(404).json({ success: false, message }),
    badRequest: (res: any, message: any) =>
      res.status(400).json({ success: false, message }),
    internalError: (res: any, _err: any, message: any) =>
      res.status(500).json({ success: false, message }),
  },
}));

const mockedAuthenticate = authenticate as MockedFunction<
  typeof authenticate
>;
const mockedLogger = logger as Mocked<typeof logger>;

const mockUser = {
  id: 'user-id-123',
  email: 'admin@example.com',
  emailVerified: true,
};

describe('Cache Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    vi.clearAllMocks();

    mockedLogger.info = vi.fn() as any;
    mockedLogger.error = vi.fn() as any;
    mockedLogger.warn = vi.fn() as any;

    mockedAuthenticate.mockImplementation(
      ((req: any, _res: any, next: any) => {
        req.user = mockUser;
        next();
      }) as any
    );

    app.use('/api/cache', cacheRoutes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe('GET /api/cache/health', () => {
    it('should return cache health status when authenticated', async () => {
      const response = await request(app)
        .get('/api/cache/health')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('healthy');
      expect(response.body.data.connection).toBe('connected');
      expect(response.body.data.hitRate).toBeDefined();
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      const response = await request(app)
        .get('/api/cache/health')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should log the health check request', async () => {
      await request(app)
        .get('/api/cache/health')
        .set('Authorization', 'Bearer valid-token');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        '🗄️ Cache: Health check requested'
      );
    });

    it('should include uptime and memory usage fields', async () => {
      const response = await request(app)
        .get('/api/cache/health')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.data.uptime).toBeDefined();
      expect(response.body.data.memoryUsage).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/cache/stats', () => {
    it('should return detailed cache statistics when authenticated', async () => {
      const response = await request(app)
        .get('/api/cache/stats')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.general).toBeDefined();
      expect(response.body.data.keyspaces).toBeDefined();
      expect(response.body.data.performance).toBeDefined();
      expect(response.body.data.memory).toBeDefined();
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).get('/api/cache/stats').expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/cache/keys/:key', () => {
    it('should return a cached value for a given key when authenticated', async () => {
      const response = await request(app)
        .get('/api/cache/keys/session:user:123')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.key).toBe('session:user:123');
      expect(response.body.data.value).toBeDefined();
      expect(response.body.data.ttl).toBeDefined();
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).get('/api/cache/keys/some-key').expect(401);
    });

    it('should log the key lookup', async () => {
      await request(app)
        .get('/api/cache/keys/my-key')
        .set('Authorization', 'Bearer valid-token');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Getting value for key: my-key')
      );
    });

    it('should handle keys with colon separators', async () => {
      const response = await request(app)
        .get('/api/cache/keys/api:projects:456')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.data.key).toBe('api:projects:456');
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/cache/keys', () => {
    it('should set a cache value with key and TTL when authenticated', async () => {
      const response = await request(app)
        .post('/api/cache/keys')
        .set('Authorization', 'Bearer valid-token')
        .send({ key: 'test-key', value: 'test-value', ttl: 600 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.key).toBe('test-key');
      expect(response.body.data.ttl).toBe(600);
    });

    it('should default TTL to 3600 when not provided', async () => {
      const response = await request(app)
        .post('/api/cache/keys')
        .set('Authorization', 'Bearer valid-token')
        .send({ key: 'test-key', value: 'test-value' })
        .expect(200);

      expect(response.body.data.ttl).toBe(3600);
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app)
        .post('/api/cache/keys')
        .send({ key: 'k', value: 'v' })
        .expect(401);
    });

    it('should log the set operation', async () => {
      await request(app)
        .post('/api/cache/keys')
        .set('Authorization', 'Bearer valid-token')
        .send({ key: 'my-key', value: 'my-value', ttl: 300 });

      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Setting value for key: my-key')
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /api/cache/keys/:key', () => {
    it('should delete a cached key when authenticated', async () => {
      const response = await request(app)
        .delete('/api/cache/keys/session:user:123')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.key).toBe('session:user:123');
      expect(response.body.data.deleted).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).delete('/api/cache/keys/some-key').expect(401);
    });

    it('should log the delete operation', async () => {
      await request(app)
        .delete('/api/cache/keys/my-key')
        .set('Authorization', 'Bearer valid-token');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleting key: my-key')
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/cache/flush', () => {
    it('should flush all cache keys when no pattern provided', async () => {
      const response = await request(app)
        .post('/api/cache/flush')
        .set('Authorization', 'Bearer valid-token')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deletedKeys).toBe(245);
      expect(response.body.data.pattern).toBe('all');
    });

    it('should flush only matching keys when pattern is provided', async () => {
      const response = await request(app)
        .post('/api/cache/flush')
        .set('Authorization', 'Bearer valid-token')
        .send({ pattern: 'session:*' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deletedKeys).toBe(25);
      expect(response.body.data.pattern).toBe('session:*');
    });

    it('should return 401 without authentication', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).post('/api/cache/flush').send({}).expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/cache/sessions', () => {
    it('should return session information when authenticated', async () => {
      const response = await request(app)
        .get('/api/cache/sessions')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBeDefined();
      expect(response.body.data.active).toBeDefined();
      expect(response.body.data.expired).toBeDefined();
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).get('/api/cache/sessions').expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/cache/keys (list all keys)', () => {
    it('should return list of keys with default pattern', async () => {
      const response = await request(app)
        .get('/api/cache/keys')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.keys)).toBe(true);
      expect(response.body.data.pattern).toBe('*');
    });

    it('should filter keys by pattern query param', async () => {
      const response = await request(app)
        .get('/api/cache/keys?pattern=session')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      (response.body.data.keys as string[]).forEach((key: string) => {
        expect(key).toContain('session');
      });
    });

    it('should respect the limit query param', async () => {
      const response = await request(app)
        .get('/api/cache/keys?limit=2')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.data.keys.length).toBeLessThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('Authentication Boundary — all cache routes require auth', () => {
    it('should block every cache route when authenticate middleware fails', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res.status(401).json({ success: false, message: 'Unauthorized' });
        }) as any
      );

      const routes = [
        { method: 'get', path: '/api/cache/health' },
        { method: 'get', path: '/api/cache/stats' },
        { method: 'get', path: '/api/cache/keys' },
        { method: 'get', path: '/api/cache/keys/some-key' },
        { method: 'post', path: '/api/cache/keys' },
        { method: 'delete', path: '/api/cache/keys/some-key' },
        { method: 'post', path: '/api/cache/flush' },
        { method: 'get', path: '/api/cache/sessions' },
      ];

      for (const route of routes) {
        const res = await (request(app) as any)[route.method](route.path);
        expect(res.status).toBe(401);
      }
    });

    it('should call authenticate exactly once per request', async () => {
      await request(app)
        .get('/api/cache/health')
        .set('Authorization', 'Bearer valid-token');

      expect(mockedAuthenticate).toHaveBeenCalledTimes(1);
    });
  });
});
