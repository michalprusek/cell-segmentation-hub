import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  jest,
  beforeAll,
  afterAll,
} from '@jest/globals';
import { logger } from '../../utils/logger';
import { prisma } from '../../db';
import { generateTokenPair } from '../../auth/jwt';
import { hashPassword } from '../../auth/password';
import mlRoutes from '../../api/routes/mlRoutes';
// import { authenticate } from '../../middleware/auth';
// import { apiLimiter } from '../../middleware/rateLimiter';
import {
  createTestUser,
  // createTestTokens,
  // authTestScenarios,
  // securityTestVectors,
  // performanceTestUtils,
  TestUser,
  TestTokens,
} from '../utils/jwtTestUtils';

/**
 * ML Authentication Boundaries Integration Tests
 *
 * These tests verify the complete authentication flow for ML routes,
 * testing the integration between:
 * - JWT token validation
 * - Authentication middleware
 * - Database user lookup
 * - ML route handlers
 * - Error handling and security boundaries
 */

// Mock rate limiter for cleaner test output
jest.mock('../../middleware/rateLimiter', () => ({
  apiLimiter: jest.fn((req, res, next) => next()),
}));

// Mock logger to prevent console noise during tests
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('ML Authentication Boundaries Integration Tests', () => {
  let app: express.Application;
  let testUser: TestUser;
  let testTokens: TestTokens;
  let _testSession: any;

  beforeAll(async () => {
    // Setup Express application
    app = express();
    app.use(express.json());
    app.use('/api/ml', mlRoutes);

    // Create test user in database
    testUser = createTestUser({
      id: 'integration-test-user-id',
      email: 'integration.test@spheroseg.com',
    });

    const hashedPassword = await hashPassword('testpassword123');

    try {
      // Clean up any existing test data
      await prisma.session.deleteMany({
        where: { userId: testUser.id },
      });

      await prisma.profile.deleteMany({
        where: { userId: testUser.id },
      });

      await prisma.user.deleteMany({
        where: { id: testUser.id },
      });

      // Create fresh test user
      await prisma.user.create({
        data: {
          id: testUser.id,
          email: testUser.email,
          password: hashedPassword,
          emailVerified: testUser.emailVerified,
          profile: {
            create: {
              id: testUser.profile!.id,
              username: testUser.profile!.username,
              bio: testUser.profile!.bio,
              organization: testUser.profile!.organization,
              location: testUser.profile!.location,
              title: testUser.profile!.title,
              publicProfile: testUser.profile!.publicProfile,
              preferredModel: testUser.profile!.preferredModel,
              modelThreshold: testUser.profile!.modelThreshold,
              preferredLang: testUser.profile!.preferredLang,
              preferredTheme: testUser.profile!.preferredTheme,
              emailNotifications: testUser.profile!.emailNotifications,
              consentToMLTraining: testUser.profile!.consentToMLTraining,
              consentToAlgorithmImprovement:
                testUser.profile!.consentToAlgorithmImprovement,
              consentToFeatureDevelopment:
                testUser.profile!.consentToFeatureDevelopment,
              consentUpdatedAt: testUser.profile!.consentUpdatedAt,
            },
          },
        },
      });

      // Generate real tokens for the test user
      testTokens = generateTokenPair(
        {
          userId: testUser.id,
          email: testUser.email,
          emailVerified: testUser.emailVerified,
        },
        false
      );

      // Create session in database
      _testSession = await prisma.session.create({
        data: {
          userId: testUser.id,
          refreshToken: testTokens.refreshToken,
          isValid: true,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          rememberMe: false,
        },
      });
    } catch (error) {
      console.error('Failed to setup integration test data:', error);
      throw error;
    }
  });

  afterAll(async () => {
    try {
      // Clean up test data
      await prisma.session.deleteMany({
        where: { userId: testUser.id },
      });

      await prisma.profile.deleteMany({
        where: { userId: testUser.id },
      });

      await prisma.user.deleteMany({
        where: { id: testUser.id },
      });
    } catch (error) {
      console.error('Failed to cleanup integration test data:', error);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Authentication Flow Integration', () => {
    it('should complete full authentication flow for protected ML endpoints', async () => {
      // Test the complete flow: Token extraction -> JWT verification -> User lookup -> Route handler
      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${testTokens.accessToken}`)
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
    });

    it('should handle authentication flow with database user lookup', async () => {
      const response = await request(app)
        .post('/api/ml/models/hrnetv2/warm-up')
        .set('Authorization', `Bearer ${testTokens.accessToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { modelId: 'hrnetv2', status: 'warming-up' },
        message: 'Model hrnetv2 warm-up initiated',
      });
    });

    it('should bypass authentication for public endpoints', async () => {
      // Test that public endpoints work without any authentication
      const healthResponse = await request(app)
        .get('/api/ml/health')
        .expect(200);

      expect(healthResponse.body.success).toBe(true);
      expect(healthResponse.body.data.status).toBe('healthy');

      const statusResponse = await request(app)
        .get('/api/ml/status')
        .expect(200);

      expect(statusResponse.body.success).toBe(true);
      expect(statusResponse.body.data.service).toBe('online');

      const modelsResponse = await request(app)
        .get('/api/ml/models')
        .expect(200);

      expect(modelsResponse.body.success).toBe(true);
      expect(Array.isArray(modelsResponse.body.data)).toBe(true);
    });
  });

  describe('Authentication Failure Scenarios', () => {
    it('should fail authentication with non-existent user', async () => {
      // Create a token for a user that doesn't exist in the database
      const fakeTokens = generateTokenPair(
        {
          userId: 'non-existent-user-id',
          email: 'fake@example.com',
          emailVerified: true,
        },
        false
      );

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${fakeTokens.accessToken}`)
        .expect(401);

      expect(response.body).toEqual({
        success: false,
        message: 'Uživatel nenalezen',
        source: 'Auth',
      });
    });

    it('should handle expired tokens correctly', async () => {
      // Create an expired token (this would require modifying JWT generation for testing)
      // For now, we'll test with a clearly invalid token that represents an expired token
      const response = await request(app)
        .get('/api/ml/queue')
        .set(
          'Authorization',
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid'
        )
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.source).toBe('Auth');
    });

    it('should handle malformed tokens', async () => {
      const malformedTokens = [
        'invalid-token',
        'Bearer invalid',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpbnZhbGlkIjoidG9rZW4ifQ.invalid',
      ];

      for (const token of malformedTokens) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', token)
          .expect(401);

        expect(response.body.success).toBe(false);
        expect(response.body.source).toBe('Auth');
      }
    });

    it('should handle missing authorization header', async () => {
      const response = await request(app).get('/api/ml/queue').expect(401);

      expect(response.body).toEqual({
        success: false,
        message: 'Chybí autentizační token',
        source: 'Auth',
      });
    });
  });

  describe('Security Boundary Tests', () => {
    it('should prevent access to protected endpoints with tampered tokens', async () => {
      // Take a valid token and modify its signature
      const tamperedToken =
        testTokens.accessToken.substring(
          0,
          testTokens.accessToken.lastIndexOf('.')
        ) + '.tampered-signature';

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.source).toBe('Auth');
    });

    it('should handle SQL injection attempts in authorization header', async () => {
      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', "Bearer '; DROP TABLE users; --")
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.source).toBe('Auth');
    });

    it('should handle XSS attempts in authorization header', async () => {
      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer <script>alert("xss")</script>')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.source).toBe('Auth');
    });

    it('should handle oversized authorization headers', async () => {
      const oversizedToken = 'Bearer ' + 'a'.repeat(10000);

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', oversizedToken)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.source).toBe('Auth');
    });
  });

  describe('User State Variations', () => {
    let unverifiedUser: any;
    let unverifiedTokens: TestTokens;

    beforeAll(async () => {
      // Create user with unverified email
      const unverifiedTestUser = createTestUser({
        id: 'unverified-user-id',
        email: 'unverified@spheroseg.com',
        emailVerified: false,
      });

      const hashedPassword = await hashPassword('testpassword123');

      unverifiedUser = await prisma.user.create({
        data: {
          id: unverifiedTestUser.id,
          email: unverifiedTestUser.email,
          password: hashedPassword,
          emailVerified: false,
          profile: {
            create: {
              id: 'unverified-profile-id',
              username: 'unverifieduser',
              preferredModel: 'hrnetv2',
              modelThreshold: 0.5,
              preferredLang: 'en',
              preferredTheme: 'light',
              emailNotifications: true,
              consentToMLTraining: false,
              consentToAlgorithmImprovement: false,
              consentToFeatureDevelopment: false,
              publicProfile: false,
            },
          },
        },
      });

      unverifiedTokens = generateTokenPair(
        {
          userId: unverifiedUser.id,
          email: unverifiedUser.email,
          emailVerified: false,
        },
        false
      );
    });

    afterAll(async () => {
      // Clean up unverified user
      try {
        await prisma.profile.deleteMany({
          where: { userId: unverifiedUser.id },
        });
        await prisma.user.deleteMany({
          where: { id: unverifiedUser.id },
        });
      } catch (error) {
        console.error('Failed to cleanup unverified user:', error);
      }
    });

    it('should allow access to ML endpoints for users with unverified email', async () => {
      // Authentication middleware should pass, but individual endpoints might restrict unverified users
      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${unverifiedTokens.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should handle user profile variations correctly', async () => {
      // Test with user that has a profile
      const response1 = await request(app)
        .post('/api/ml/models/cbam-resunet/warm-up')
        .set('Authorization', `Bearer ${testTokens.accessToken}`)
        .expect(200);

      expect(response1.body.success).toBe(true);

      // Test with user that has minimal profile
      const response2 = await request(app)
        .post('/api/ml/models/unet_spherohq/warm-up')
        .set('Authorization', `Bearer ${unverifiedTokens.accessToken}`)
        .expect(200);

      expect(response2.body.success).toBe(true);
    });
  });

  describe('Concurrent Authentication Tests', () => {
    it('should handle multiple concurrent authenticated requests', async () => {
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${testTokens.accessToken}`)
      );

      const responses = await Promise.all(promises);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    it('should handle mixed authenticated and unauthenticated requests', async () => {
      const authenticatedPromises = Array.from({ length: 5 }, () =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${testTokens.accessToken}`)
      );

      const publicPromises = Array.from({ length: 5 }, () =>
        request(app).get('/api/ml/health')
      );

      const allResponses = await Promise.all([
        ...authenticatedPromises,
        ...publicPromises,
      ]);

      // All requests should succeed
      allResponses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    it('should handle concurrent requests with different authentication states', async () => {
      const validAuthPromises = Array.from({ length: 3 }, () =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${testTokens.accessToken}`)
      );

      const invalidAuthPromises = Array.from({ length: 3 }, () =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', 'Bearer invalid-token')
      );

      const noAuthPromises = Array.from({ length: 2 }, () =>
        request(app).get('/api/ml/queue')
      );

      const [validResponses, invalidResponses, noAuthResponses] =
        await Promise.all([
          Promise.all(validAuthPromises),
          Promise.all(invalidAuthPromises),
          Promise.all(noAuthPromises),
        ]);

      // Valid auth should succeed
      validResponses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Invalid auth should fail
      invalidResponses.forEach(response => {
        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });

      // No auth should fail
      noAuthResponses.forEach(response => {
        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });
    });
  });

  describe('Database Integration Edge Cases', () => {
    it('should handle database connection issues during authentication', async () => {
      // Mock database to simulate connection failure
      const originalFindUnique = prisma.user.findUnique;

      (prisma.user.findUnique as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${testTokens.accessToken}`)
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.source).toBe('Auth');

      // Restore original function
      prisma.user.findUnique = originalFindUnique;
    });

    it('should handle database timeout during user lookup', async () => {
      // Mock database to simulate timeout
      const originalFindUnique = prisma.user.findUnique;

      (prisma.user.findUnique as jest.Mock) = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Database timeout')), 100)
            )
        );

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${testTokens.accessToken}`)
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.source).toBe('Auth');

      // Restore original function
      prisma.user.findUnique = originalFindUnique;
    });
  });

  describe('Performance and Load Testing', () => {
    it('should maintain authentication performance under load', async () => {
      const startTime = Date.now();

      // Send 50 concurrent authenticated requests
      const promises = Array.from({ length: 50 }, () =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${testTokens.accessToken}`)
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Performance should be reasonable (less than 5 seconds for 50 requests)
      expect(totalTime).toBeLessThan(5000);

      logger.debug(
        `Authentication load test completed: ${responses.length} requests in ${totalTime}ms`
      );
    });

    it('should handle authentication errors efficiently', async () => {
      const startTime = Date.now();

      // Send 50 concurrent requests with invalid tokens
      const promises = Array.from({ length: 50 }, () =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', 'Bearer invalid-token')
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All requests should fail with 401
      responses.forEach(response => {
        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });

      // Error handling should be fast (less than 2 seconds for 50 requests)
      expect(totalTime).toBeLessThan(2000);

      logger.debug(
        `Authentication error test completed: ${responses.length} failed requests in ${totalTime}ms`
      );
    });
  });

  describe('Route-Level Authentication Boundaries', () => {
    it('should verify exact authentication boundary at middleware level', async () => {
      // Test that public routes come before authentication middleware
      // and protected routes come after

      // Health endpoint should be accessible
      await request(app).get('/api/ml/health').expect(200);

      // Status endpoint should be accessible
      await request(app).get('/api/ml/status').expect(200);

      // Models endpoint should be accessible
      await request(app).get('/api/ml/models').expect(200);

      // Queue endpoint should require authentication
      await request(app).get('/api/ml/queue').expect(401);

      // Warm-up endpoint should require authentication
      await request(app).post('/api/ml/models/test/warm-up').expect(401);
    });

    it('should ensure consistent authentication requirements across all protected endpoints', async () => {
      const protectedEndpoints = [
        { method: 'get', path: '/api/ml/queue' },
        { method: 'post', path: '/api/ml/models/test/warm-up' },
      ];

      for (const endpoint of protectedEndpoints) {
        // Test without auth - should fail

        const unauthorizedResponse = await (request(app) as any)
          [endpoint.method](endpoint.path)
          .expect(401);

        expect(unauthorizedResponse.body.success).toBe(false);
        expect(unauthorizedResponse.body.source).toBe('Auth');

        // Test with valid auth - should succeed

        const authorizedResponse = await (request(app) as any)
          [endpoint.method](endpoint.path)
          .set('Authorization', `Bearer ${testTokens.accessToken}`)
          .expect(200);

        expect(authorizedResponse.body.success).toBe(true);
      }
    });
  });
});
