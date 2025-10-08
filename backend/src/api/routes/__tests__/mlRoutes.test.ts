import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  jest,
  afterEach,
} from '@jest/globals';
import mlRoutes from '../mlRoutes';
import { authenticate } from '../../../middleware/auth';
import { apiLimiter } from '../../../middleware/rateLimiter';
import { logger } from '../../../utils/logger';
import { verifyAccessToken } from '../../../auth/jwt';
import { prisma } from '../../../db';

// Mock dependencies
jest.mock('../../../middleware/auth');
jest.mock('../../../middleware/rateLimiter');
jest.mock('../../../utils/logger');
jest.mock('../../../auth/jwt');
jest.mock('../../../db');

// Create mocked functions with proper typing
const mockedAuthenticate = authenticate as jest.MockedFunction<
  typeof authenticate
>;
const mockedApiLimiter = apiLimiter as jest.MockedFunction<typeof apiLimiter>;
const mockedLogger = logger as jest.Mocked<typeof logger>;
const _mockedVerifyAccessToken = verifyAccessToken as jest.MockedFunction<
  typeof verifyAccessToken
>;
const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

// Mock user data
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  emailVerified: true,
  profile: {
    id: 'profile-id',
    userId: 'test-user-id',
    username: 'testuser',
    avatarUrl: null,
    avatarPath: null,
    avatarMimeType: null,
    avatarSize: null,
    bio: null,
    organization: null,
    location: null,
    title: null,
    publicProfile: false,
    preferredModel: 'hrnet',
    modelThreshold: 0.5,
    preferredLang: 'en',
    preferredTheme: 'light',
    emailNotifications: true,
    consentToMLTraining: true,
    consentToAlgorithmImprovement: true,
    consentToFeatureDevelopment: true,
    consentUpdatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe('ML Routes Authentication Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    // Create fresh Express app for each test
    app = express();
    app.use(express.json());

    // Reset all mocks
    jest.clearAllMocks();

    // Mock rate limiter to pass through
    mockedApiLimiter.mockImplementation((req: any, res: any, next: any) => next());

    // Mock logger methods
    mockedLogger.info = jest.fn();
    mockedLogger.error = jest.fn();

    // Mock Prisma user findUnique
    (mockedPrisma as any).user = {
      findUnique: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Public ML Endpoints (No Authentication Required)', () => {
    beforeEach(() => {
      // Setup app with ML routes
      app.use('/api/ml', mlRoutes);
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
        // Mock process.uptime to throw an error
        const originalUptime = process.uptime;
        (process as any).uptime = jest.fn().mockImplementation(() => {
          throw new Error('Uptime calculation failed');
        }) as any;

        const response = await request(app).get('/api/ml/health').expect(500);

        expect(response.body.success).toBe(false);
        expect(mockedLogger.error).toHaveBeenCalledWith(
          '❌ ML: Health check failed:',
          expect.any(Error)
        );

        // Restore original uptime
        process.uptime = originalUptime;
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
        // Force an error by mocking Date to throw
        const originalDate = Date;
        (global as any).Date = (jest.fn().mockImplementation(() => {
          throw new Error('Date creation failed');
        }) as any) as any;

        const response = await request(app).get('/api/ml/status').expect(500);

        expect(response.body.success).toBe(false);
        expect(mockedLogger.error).toHaveBeenCalledWith(
          '❌ ML: Error checking service status:',
          expect.any(Error)
        );

        // Restore original Date
        global.Date = originalDate;
      });
    });

    describe('GET /api/ml/models', () => {
      it('should return available models without authentication', async () => {
        const response = await request(app).get('/api/ml/models').expect(200);

        expect(response.body).toEqual({
          success: true,
          data: [
            {
              id: 'hrnetv2',
              name: 'HRNetV2',
              description: 'Best accuracy, ~3.1s inference time',
              version: '1.0.0',
              status: 'active',
            },
            {
              id: 'cbam-resunet',
              name: 'CBAM-ResUNet',
              description:
                'Precise segmentation with attention mechanisms, optimized inference time',
              version: '2.0.0',
              status: 'active',
            },
            {
              id: 'unet_spherohq',
              name: 'UNet (SpheroHQ)',
              description:
                'Best performance on SpheroHQ dataset, balanced speed and accuracy',
              version: '1.0.0',
              status: 'active',
            },
          ],
          message: 'Available ML models retrieved successfully',
        });

        expect(mockedLogger.info).toHaveBeenCalledWith(
          '📊 ML: Fetching available models'
        );
        expect(mockedAuthenticate).not.toHaveBeenCalled();
      });

      it('should handle models fetch errors', async () => {
        // Mock logger to throw an error
        mockedLogger.info.mockImplementation(() => {
          throw new Error('Logger error');
        });

        const response = await request(app).get('/api/ml/models').expect(500);

        expect(response.body.success).toBe(false);
        expect(mockedLogger.error).toHaveBeenCalledWith(
          '❌ ML: Error fetching models:',
          expect.any(Error)
        );
      });
    });
  });

  describe('Protected ML Endpoints (Authentication Required)', () => {
    beforeEach(() => {
      // Setup successful authentication mock by default
      mockedAuthenticate.mockImplementation((req: any, res, next) => {
        req.user = mockUser;
        next();
      });

      // Setup app with ML routes
      app.use('/api/ml', mlRoutes);
    });

    describe('GET /api/ml/queue', () => {
      it('should return queue status with valid authentication', async () => {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', 'Bearer valid-token')
          .expect(200);

        expect(response.body).toEqual({
          success: true,
          data: {
            totalItems: 0,
            processing: 0,
            pending: 0,
            completed: 0,
            failed: 0,
            averageWaitTime: '2.3s',
            estimatedProcessingTime: '0s',
          },
          message: 'ML queue status retrieved successfully',
        });

        expect(mockedLogger.info).toHaveBeenCalledWith(
          '📋 ML: Fetching queue status'
        );
        expect(mockedAuthenticate).toHaveBeenCalled();
      });

      it('should return 401 without authentication', async () => {
        // Mock authentication to fail
        mockedAuthenticate.mockImplementation((req: any, res: any) => {
          res.status(401).json({
            success: false,
            message: 'Chybí autentizační token',
            source: 'Auth',
          });
        });

        const response = await request(app).get('/api/ml/queue').expect(401);

        expect(response.body).toEqual({
          success: false,
          message: 'Chybí autentizační token',
          source: 'Auth',
        });

        expect(mockedAuthenticate).toHaveBeenCalled();
      });

      it('should return 401 with invalid token', async () => {
        // Mock authentication to fail with invalid token
        mockedAuthenticate.mockImplementation((req: any, res: any) => {
          res.status(401).json({
            success: false,
            message: 'Neplatný token',
            source: 'Auth',
          });
        });

        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);

        expect(response.body).toEqual({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });

        expect(mockedAuthenticate).toHaveBeenCalled();
      });

      it('should return 401 with expired token', async () => {
        // Mock authentication to fail with expired token
        mockedAuthenticate.mockImplementation((req: any, res: any) => {
          res.status(401).json({
            success: false,
            message: 'Token vypršel',
            source: 'Auth',
          });
        });

        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', 'Bearer expired-token')
          .expect(401);

        expect(response.body).toEqual({
          success: false,
          message: 'Token vypršel',
          source: 'Auth',
        });

        expect(mockedAuthenticate).toHaveBeenCalled();
      });

      it('should handle queue fetch errors after authentication', async () => {
        // Mock logger to throw an error after authentication passes
        mockedLogger.info.mockImplementation(message => {
          if (message.includes('Fetching queue status')) {
            throw new Error('Queue service unavailable');
          }
        });

        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', 'Bearer valid-token')
          .expect(500);

        expect(response.body.success).toBe(false);
        expect(mockedLogger.error).toHaveBeenCalledWith(
          '❌ ML: Error fetching queue status:',
          expect.any(Error)
        );
      });
    });

    describe('POST /api/ml/models/:modelId/warm-up', () => {
      it('should warm up model with valid authentication', async () => {
        const modelId = 'hrnetv2';

        const response = await request(app)
          .post(`/api/ml/models/${modelId}/warm-up`)
          .set('Authorization', 'Bearer valid-token')
          .expect(200);

        expect(response.body).toEqual({
          success: true,
          data: { modelId, status: 'warming-up' },
          message: `Model ${modelId} warm-up initiated`,
        });

        expect(mockedLogger.info).toHaveBeenCalledWith(
          `🔥 ML: Warming up model: ${modelId}`
        );
        expect(mockedAuthenticate).toHaveBeenCalled();
      });

      it('should return 401 without authentication', async () => {
        // Mock authentication to fail
        mockedAuthenticate.mockImplementation((req: any, res: any) => {
          res.status(401).json({
            success: false,
            message: 'Chybí autentizační token',
            source: 'Auth',
          });
        });

        const response = await request(app)
          .post('/api/ml/models/hrnetv2/warm-up')
          .expect(401);

        expect(response.body).toEqual({
          success: false,
          message: 'Chybí autentizační token',
          source: 'Auth',
        });

        expect(mockedAuthenticate).toHaveBeenCalled();
      });

      it('should handle warm-up errors after authentication', async () => {
        // Mock logger to throw an error after authentication passes
        mockedLogger.info.mockImplementation(message => {
          if (message.includes('Warming up model')) {
            throw new Error('Model warm-up failed');
          }
        });

        const response = await request(app)
          .post('/api/ml/models/hrnetv2/warm-up')
          .set('Authorization', 'Bearer valid-token')
          .expect(500);

        expect(response.body.success).toBe(false);
        expect(mockedLogger.error).toHaveBeenCalledWith(
          '❌ ML: Error warming up model:',
          expect.any(Error)
        );
      });

      it('should handle special characters in model ID', async () => {
        const modelId = 'model-with-special-chars_123';

        const response = await request(app)
          .post(`/api/ml/models/${modelId}/warm-up`)
          .set('Authorization', 'Bearer valid-token')
          .expect(200);

        expect(response.body.data.modelId).toBe(modelId);
        expect(mockedLogger.info).toHaveBeenCalledWith(
          `🔥 ML: Warming up model: ${modelId}`
        );
      });
    });
  });

  describe('Authentication Boundary Tests', () => {
    beforeEach(() => {
      app.use('/api/ml', mlRoutes);
    });

    it('should verify middleware execution order - public endpoints before auth', async () => {
      const middlewareOrder: string[] = [];

      // Mock rate limiter to track execution
      mockedApiLimiter.mockImplementation((req: any, res: any, next: any) => {
        middlewareOrder.push('rateLimiter');
        next();
      });

      // Mock authentication to track execution
      mockedAuthenticate.mockImplementation((req, res, next) => {
        middlewareOrder.push('authenticate');
        next();
      });

      // Test public endpoint
      await request(app).get('/api/ml/health').expect(200);

      // Should only have rate limiter, not authentication
      expect(middlewareOrder).toEqual(['rateLimiter']);
      expect(middlewareOrder).not.toContain('authenticate');
    });

    it('should verify middleware execution order - protected endpoints after auth', async () => {
      const middlewareOrder: string[] = [];

      // Mock rate limiter to track execution
      mockedApiLimiter.mockImplementation((req: any, res: any, next: any) => {
        middlewareOrder.push('rateLimiter');
        next();
      });

      // Mock authentication to track execution and set user
      mockedAuthenticate.mockImplementation((req: any, res, next) => {
        middlewareOrder.push('authenticate');
        req.user = mockUser;
        next();
      });

      // Test protected endpoint
      await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      // Should have both rate limiter and authentication
      expect(middlewareOrder).toEqual(['rateLimiter', 'authenticate']);
    });

    it('should handle authentication failures gracefully', async () => {
      // Mock authentication to throw an error
      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(500).json({
          success: false,
          message: 'Chyba autentizace',
          source: 'Auth',
        });
      });

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer problematic-token')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Chyba autentizace',
        source: 'Auth',
      });
    });

    it('should ensure public endpoints remain accessible during auth service outages', async () => {
      // Mock authentication to fail completely
      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(503).json({
          success: false,
          message: 'Authentication service unavailable',
          source: 'Auth',
        });
      });

      // Public endpoints should still work
      const healthResponse = await request(app)
        .get('/api/ml/health')
        .expect(200);

      const statusResponse = await request(app)
        .get('/api/ml/status')
        .expect(200);

      const modelsResponse = await request(app)
        .get('/api/ml/models')
        .expect(200);

      expect(healthResponse.body.success).toBe(true);
      expect(statusResponse.body.success).toBe(true);
      expect(modelsResponse.body.success).toBe(true);

      // Protected endpoints should fail
      await request(app).get('/api/ml/queue').expect(503);
    });
  });

  describe('Security Edge Cases', () => {
    beforeEach(() => {
      app.use('/api/ml', mlRoutes);
    });

    it('should handle malformed Authorization headers', async () => {
      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      });

      const malformedHeaders = [
        'Bearer',
        'Bearer ',
        'InvalidFormat token',
        'Bearer token-with-spaces token',
        'Bearer token\nwith\nnewlines',
        'Bearer <script>alert("xss")</script>',
      ];

      for (const header of malformedHeaders) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', header)
          .expect(401);

        expect(response.body.success).toBe(false);
      }
    });

    it('should handle concurrent requests to protected endpoints', async () => {
      // Mock authentication to succeed
      mockedAuthenticate.mockImplementation((req: any, res, next) => {
        req.user = mockUser;
        next();
      });

      // Send multiple concurrent requests
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', 'Bearer valid-token')
      );

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Authentication should have been called for each request
      expect(mockedAuthenticate).toHaveBeenCalledTimes(10);
    });

    it('should handle user context injection attempts', async () => {
      // Mock authentication to set malicious user data
      mockedAuthenticate.mockImplementation((req: any, res, next) => {
        req.user = {
          ...mockUser,
          id: '<script>alert("xss")</script>',
          email: 'malicious@<script>alert("xss")</script>.com',
        };
        next();
      });

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      // Response should be successful but data should be handled safely
      expect(response.body.success).toBe(true);
      // The actual validation would be in the specific endpoint handlers
    });

    it('should ensure rate limiting applies to all endpoints', async () => {
      let rateLimiterCallCount = 0;

      mockedApiLimiter.mockImplementation((req: any, res: any, next: any) => {
        rateLimiterCallCount++;
        next();
      });

      mockedAuthenticate.mockImplementation((req: any, res, next) => {
        req.user = mockUser;
        next();
      });

      // Test all endpoints
      await request(app).get('/api/ml/health').expect(200);
      await request(app).get('/api/ml/status').expect(200);
      await request(app).get('/api/ml/models').expect(200);
      await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);
      await request(app)
        .post('/api/ml/models/hrnetv2/warm-up')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      // Rate limiter should be called for all endpoints
      expect(rateLimiterCallCount).toBe(5);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      app.use('/api/ml', mlRoutes);
    });

    it('should handle database connectivity issues during authentication', async () => {
      // Mock authentication to simulate database error
      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(500).json({
          success: false,
          message: 'Database connection failed',
          source: 'Auth',
        });
      });

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer valid-token')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Database connection failed',
        source: 'Auth',
      });
    });

    it('should handle unexpected errors in middleware chain', async () => {
      // Mock rate limiter to throw an unexpected error
      mockedApiLimiter.mockImplementation(() => {
        throw new Error('Unexpected middleware error');
      });

      // Error handling would depend on Express error middleware configuration
      // This test ensures our routes don't break the middleware chain
      const response = await request(app).get('/api/ml/health').expect(500);

      // The exact response depends on Express error handling middleware
      expect(response.status).toBe(500);
    });
  });
});
