import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import axios from 'axios';
import mlRoutes from '../../api/routes/mlRoutes';
import { apiLimiter } from '../../middleware/rateLimiter';

/**
 * ML Public Endpoint Security Tests
 *
 * The ML router now exposes only public endpoints (GET /health, GET /status).
 * The authenticated endpoints (/queue, /models/:modelId/warm-up) and the
 * /models catalog were removed as dead stubs that returned hardcoded data and
 * were called by no client (commit 85fb78c). The OWASP authentication-boundary
 * tests that targeted those protected routes were removed with them, since
 * there is no longer any authenticated surface on this router to enforce.
 *
 * What remains are the response-hardening checks that still apply to the
 * surviving public endpoints:
 *   - no server technology disclosure in response headers
 *   - no sensitive data / internals leaked in response bodies
 *   - rate limiting is wired on public endpoints
 *   - unsupported HTTP methods are rejected without leaking internals
 *   - consistent response envelope shape
 */

vi.mock('../../utils/config', () => ({
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
    REDIS_URL: 'redis://localhost:6379',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test',
    UPLOAD_DIR: './uploads',
    EMAIL_SERVICE: 'smtp',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: { status: 'healthy', uptime: 123 },
      status: 200,
    }),
    post: vi.fn().mockResolvedValue({ data: {}, status: 200 }),
  },
}));

vi.mock('../../middleware/rateLimiter', () => ({
  apiLimiter: vi.fn((req: any, res: any, next: any) => next()),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockedApiLimiter = apiLimiter as MockedFunction<typeof apiLimiter>;

describe('ML Public Endpoint Security Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use('/api/ml', mlRoutes);

    vi.clearAllMocks();

    // Default: axios.get resolves successfully (ML service is reachable)
    vi.mocked(axios.get).mockResolvedValue({
      data: { status: 'healthy', uptime: 123 },
      status: 200,
    });

    mockedApiLimiter.mockImplementation(((req: any, res: any, next: any) =>
      next()) as any);
  });

  describe('OWASP A04: Insecure Design', () => {
    it('should wire rate limiting on public endpoints', async () => {
      let rateLimitCalls = 0;

      mockedApiLimiter.mockImplementation((req: any, res: any, next: any) => {
        rateLimitCalls++;
        next();
      });

      // Simulate rapid requests
      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/api/ml/health')
      );

      await Promise.all(promises);

      expect(rateLimitCalls).toBe(10);
    });

    it('should implement secure defaults', async () => {
      // Public endpoints should be minimal
      const response = await request(app).get('/api/ml/health').expect(200);

      // Should not expose sensitive information
      expect(response.body.data).not.toHaveProperty('config');
      expect(response.body.data).not.toHaveProperty('secrets');
      expect(response.body.data).not.toHaveProperty('environment');
    });
  });

  describe('OWASP A05: Security Misconfiguration', () => {
    it('should not expose server information in headers', async () => {
      const response = await request(app).get('/api/ml/health').expect(200);

      // Should not expose server technology
      expect(response.headers).not.toHaveProperty('x-powered-by');
      expect(response.headers).not.toHaveProperty('server');
    });

    it('should handle invalid HTTP methods securely', async () => {
      // Test unsupported HTTP methods (only GET is registered)
      const response = await request(app).patch('/api/ml/health').expect(404);

      expect(JSON.stringify(response.body)).not.toContain('stack');
    });
  });

  describe('Response Security', () => {
    it('should not expose sensitive information in responses', async () => {
      const response = await request(app).get('/api/ml/health').expect(200);

      const responseString = JSON.stringify(response.body);

      // Should not contain sensitive keywords
      const sensitiveKeywords = [
        'password',
        'secret',
        'key',
        'token',
        'credential',
        'private',
        'internal',
        'config',
        'env',
        'database',
      ];

      sensitiveKeywords.forEach(keyword => {
        expect(responseString.toLowerCase()).not.toContain(keyword);
      });
    });

    it('should implement consistent response format', async () => {
      // Test the surviving public endpoints
      const responses = [
        await request(app).get('/api/ml/health').expect(200),
        await request(app).get('/api/ml/status').expect(200),
      ];

      responses.forEach(response => {
        expect(response.body).toHaveProperty('success');
        expect(response.body).toHaveProperty('data');
        expect(response.body).toHaveProperty('message');
        expect(typeof response.body.success).toBe('boolean');
      });
    });
  });
});
