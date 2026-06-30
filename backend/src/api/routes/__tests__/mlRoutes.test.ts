import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach } from 'vitest';
import mlRoutes from '../mlRoutes';
import { authenticate } from '../../../middleware/auth';
import { apiLimiter } from '../../../middleware/rateLimiter';
import { logger } from '../../../utils/logger';
import axios from 'axios';

/**
 * Tests for the public ML routes that actually exist in mlRoutes.ts:
 *   GET /api/ml/health and GET /api/ml/status — both public (no auth).
 *
 * The former /api/ml/models catalog and the protected /api/ml/queue and
 * /api/ml/models/:modelId/warm-up handlers were removed as dead stubs that
 * returned hardcoded fake data and were called by no client (commit 85fb78c).
 * Their tests — and the authentication-boundary tests that depended on them —
 * were removed with them.
 */

// Mock axios to prevent real HTTP calls to the ML service
vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// Mock config so importing the route graph never trips process.exit in non-test
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));
vi.mock('../../../middleware/auth');
vi.mock('../../../middleware/rateLimiter');
vi.mock('../../../utils/logger');

const mockedAuthenticate = authenticate as any;
const mockedApiLimiter = apiLimiter as any;
const mockedLogger = logger as Mocked<typeof logger>;

describe('ML Routes (public endpoints)', () => {
  let app: express.Application;

  beforeEach(() => {
    // Fresh Express app per test
    app = express();
    app.use(express.json());

    vi.clearAllMocks();

    // Rate limiter passes through by default
    mockedApiLimiter.mockImplementation((req: any, res: any, next: any) =>
      next()
    );

    mockedLogger.info = vi.fn();
    mockedLogger.error = vi.fn();

    // Default axios mock: ML service returns a healthy response
    mockedAxios.get = vi.fn(() =>
      Promise.resolve({ data: { status: 'healthy', gpu_available: false } })
    ) as any;

    app.use('/api/ml', mlRoutes);
    // JSON error handler (catches next(error) and thrown middleware errors)
    app.use((err: any, req: any, res: any, _next: any) => {
      res.status(500).json({ success: false, error: err.message });
    });
  });

  describe('GET /api/ml/health', () => {
    it('should return health status without authentication', async () => {
      const response = await request(app).get('/api/ml/health').expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          status: 'healthy',
          uptime: expect.any(Number),
          models: {
            loaded: 3,
            failed: 0,
          },
          memory: {
            used: '256MB',
            available: '1.2GB',
          },
          gpu: {
            available: false,
            utilization: '0%',
          },
        },
        message: 'ML service health check completed',
      });

      expect(mockedLogger.info).toHaveBeenCalledWith(
        '🏥 ML: Health check requested'
      );
      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });

    it('should handle health check errors gracefully', async () => {
      // Override axios to simulate ML service being unavailable
      mockedAxios.get = vi.fn(() =>
        Promise.reject(new Error('connect ECONNREFUSED'))
      ) as any;

      const response = await request(app).get('/api/ml/health');

      // Route returns 503 when ML service is unavailable
      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
    });

    it('should work without Authorization header', async () => {
      const response = await request(app).get('/api/ml/health').expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should work with invalid Authorization header', async () => {
      const response = await request(app)
        .get('/api/ml/health')
        .set('Authorization', 'Invalid token format')
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/ml/status', () => {
    it('should return service status without authentication', async () => {
      const response = await request(app).get('/api/ml/status').expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          service: 'online',
          version: '1.0.0',
          modelsLoaded: 3,
          queueSize: 0,
          lastHealthCheck: expect.any(String),
          performance: {
            averageInferenceTime: '8.5s',
            successRate: '99.2%',
            errorRate: '0.8%',
          },
        },
        message: 'ML service status retrieved successfully',
      });

      expect(mockedLogger.info).toHaveBeenCalledWith(
        '🔍 ML: Checking service status'
      );
      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });

    it('should handle status check errors', async () => {
      // Override axios to simulate ML service being unavailable
      mockedAxios.get = vi.fn(() =>
        Promise.reject(new Error('connect ECONNREFUSED'))
      ) as any;

      const response = await request(app).get('/api/ml/status');

      // Route returns 503 when ML service is unavailable
      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Public endpoints stay public', () => {
    it('should run the rate limiter but never invoke authenticate', async () => {
      const middlewareOrder: string[] = [];

      mockedApiLimiter.mockImplementation((req: any, res: any, next: any) => {
        middlewareOrder.push('rateLimiter');
        next();
      });

      mockedAuthenticate.mockImplementation((req: any, res: any, next: any) => {
        middlewareOrder.push('authenticate');
        next();
      });

      await request(app).get('/api/ml/health').expect(200);

      expect(middlewareOrder).toEqual(['rateLimiter']);
      expect(middlewareOrder).not.toContain('authenticate');
    });
  });

  describe('Error handling', () => {
    it('should surface unexpected middleware errors as 500', async () => {
      // Rate limiter throws synchronously → Express forwards to error handler
      mockedApiLimiter.mockImplementation(() => {
        throw new Error('Unexpected middleware error');
      });

      const response = await request(app).get('/api/ml/health').expect(500);

      expect(response.status).toBe(500);
    });
  });
});
