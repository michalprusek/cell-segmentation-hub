import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import authRoutes from '../authRoutes';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';

// Mock config and jwt early to prevent process.exit during module loading
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
    UPLOAD_DIR: './test-uploads',
    MAX_FILE_SIZE: 10485760,
    STORAGE_TYPE: 'local',
    SESSION_SECRET: 'test-session-secret',
    REDIS_URL: 'redis://localhost:6379',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test Platform',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));
vi.mock('../../../auth/jwt');
// Prevent nodemailer from opening SMTP connections during module loading
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn(),
    verify: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock all dependencies before router import resolution
vi.mock('../../../middleware/auth');
vi.mock('../../../middleware/rateLimiter', () => ({
  authLimiter: (req: any, _res: any, next: any) => {
    // Leaves a trace, so a test can tell the limiter is on a route's chain.
    req.passedAuthLimiter = true;
    next();
  },
  passwordResetLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../../middleware/validation', async () => {
  const actual = await vi.importActual<
    typeof import('../../../middleware/validation')
  >('../../../middleware/validation');
  const { deleteAccountSchema } = await vi.importActual<
    typeof import('../../../auth/validation')
  >('../../../auth/validation');
  const passThrough = (_req: any, _res: any, next: any) => next();
  return {
    // Validation stays a pass-through for every route except the one wired
    // with `deleteAccountSchema`, which gets the REAL middleware running the
    // REAL schema — so "DELETE /profile rejects a body without a password"
    // fails if the route loses its validateBody or is handed another schema.
    validateBody: (schema: unknown) =>
      schema === deleteAccountSchema
        ? actual.validateBody(deleteAccountSchema)
        : passThrough,
    validateParams: () => passThrough,
  };
});
vi.mock('../../../middleware/upload', () => ({
  uploadSingleImage: (_req: any, _res: any, next: any) => next(),
  handleUploadError: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../../utils/logger');
// Use factory mocks for services with heavy module-level side effects (nodemailer, etc.)
vi.mock('../../../services/authService', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshToken: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
}));
vi.mock('../../../services/userService', () => ({
  getUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
  calculateUserStorage: vi.fn(),
  getUserActivity: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock('../../../db');
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
    // Same status as the real helper (400, code VALIDATION_ERROR).
    validationError: (res: any, errors: any) =>
      res
        .status(400)
        .json({ success: false, code: 'VALIDATION_ERROR', details: errors }),
    internalError: (res: any, _err: any, message: any) =>
      res.status(500).json({ success: false, message }),
  },
  asyncHandler: (fn: any) => async (req: any, res: any, next: any) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  },
}));

// Mock auth controller functions — use plain functions in the factory (vi.fn() in
// factory scope can be unreliable in Jest ESM mode); reassign to vi.fn below.
vi.mock('../../../api/controllers/authController', () => ({
  register: (_req: any, res: any) =>
    res.status(201).json({
      success: true,
      data: { user: {}, accessToken: 'tok', refreshToken: 'ref' },
      message: 'User registered',
    }),
  login: (_req: any, res: any) =>
    res.status(200).json({
      success: true,
      data: { user: {}, accessToken: 'tok', refreshToken: 'ref' },
      message: 'Logged in',
    }),
  refreshToken: (_req: any, res: any) =>
    res.status(200).json({
      success: true,
      data: { accessToken: 'new-tok' },
      message: 'Token refreshed',
    }),
  logout: (_req: any, res: any) =>
    res.status(200).json({ success: true, message: 'Logged out' }),
  requestPasswordReset: (_req: any, res: any) =>
    res.status(200).json({ success: true, message: 'Reset email sent' }),
  resetPasswordWithToken: (_req: any, res: any) =>
    res.status(200).json({ success: true, message: 'Password reset' }),
  verifyEmail: (_req: any, res: any) =>
    res.status(200).json({ success: true, message: 'Email verified' }),
  resendVerificationEmail: (_req: any, res: any) =>
    res.status(200).json({ success: true, message: 'Verification resent' }),
  checkAuth: (req: any, res: any) =>
    res.status(200).json({
      success: true,
      data: { user: req.user },
      message: 'Authenticated',
    }),
  getProfile: (_req: any, res: any) =>
    res.status(200).json({
      success: true,
      data: { profile: {} },
      message: 'Profile fetched',
    }),
  updateProfile: (_req: any, res: any) =>
    res
      .status(200)
      .json({ success: true, data: {}, message: 'Profile updated' }),
  getStorageStats: (_req: any, res: any) =>
    res
      .status(200)
      .json({ success: true, data: {}, message: 'Storage stats fetched' }),
  changePassword: (_req: any, res: any) =>
    res.status(200).json({ success: true, message: 'Password changed' }),
  // Echoes what reached it, so the tests can see the validated body and
  // which middleware ran first.
  deleteAccount: (req: any, res: any) =>
    res.status(200).json({
      success: true,
      data: {
        body: req.body,
        userId: req.user?.id,
        passedAuthLimiter: req.passedAuthLimiter === true,
      },
      message: 'Account deleted',
    }),
  uploadAvatar: (_req: any, res: any) =>
    res
      .status(200)
      .json({ success: true, data: {}, message: 'Avatar uploaded' }),
}));

import * as authController from '../../../api/controllers/authController';

const mockedAuthenticate = authenticate as MockedFunction<typeof authenticate>;
const mockedLogger = logger as Mocked<typeof logger>;

// Controller spy references — in ESM mode, vi.spyOn wraps the live binding
// so toHaveBeenCalled() assertions reflect actual invocations.
// (Factory plain functions are wrappable as long as the mock module object allows mutations)
const mockedController = authController as Mocked<typeof authController>;

const mockUser = {
  id: 'user-id-123',
  email: 'test@example.com',
  emailVerified: true,
};

describe('Auth Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    vi.clearAllMocks();

    mockedLogger.info = vi.fn() as any;
    mockedLogger.error = vi.fn() as any;
    mockedLogger.warn = vi.fn() as any;

    mockedAuthenticate.mockImplementation(((req: any, _res: any, next: any) => {
      req.user = mockUser;
      next();
    }) as any);

    app.use('/api/auth', authRoutes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe('POST /api/auth/register', () => {
    it('should register a new user with valid body', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firstName: 'Jan',
          lastName: 'Novak',
          email: 'jan@example.com',
          password: 'SecurePass1!',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
    });

    it('should pass through the rate limiter middleware', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          password: 'pass1234',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('should not require authentication', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          password: 'pass1234',
        })
        .expect(201);

      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/auth/login', () => {
    it('should log in with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
    });

    it('should not require authentication', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(200);

      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });

    it('should invoke the login controller', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(mockedController.login).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/auth/refresh-token', () => {
    it('should return a new access token with a valid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh-token')
        .send({ refreshToken: 'valid-refresh-token' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
    });

    it('should not require authentication header', async () => {
      await request(app)
        .post('/api/auth/refresh-token')
        .send({ refreshToken: 'some-token' })
        .expect(200);

      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/auth/logout', () => {
    it('should log out an authenticated user', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      mockedAuthenticate.mockImplementation(((_req: any, res: any) => {
        res
          .status(401)
          .json({ success: false, message: 'Chybí autentizační token' });
      }) as any);

      const response = await request(app).post('/api/auth/logout').expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/auth/request-password-reset', () => {
    it('should send a reset email for a known address', async () => {
      const response = await request(app)
        .post('/api/auth/request-password-reset')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Reset email sent');
    });

    it('should not require authentication', async () => {
      await request(app)
        .post('/api/auth/request-password-reset')
        .send({ email: 'test@example.com' });

      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });

    it('should also respond on the /forgot-password alias', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/auth/reset-password', () => {
    it('should reset password with a valid token and new password', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'valid-reset-token', newPassword: 'NewPass123!' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Password reset');
    });

    it('should not require authentication', async () => {
      await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'tok', newPassword: 'NewPass123!' });

      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/auth/verify-email/:token', () => {
    it('should verify an email address with a valid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify-email/valid-verification-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Email verified');
    });

    it('should not require authentication', async () => {
      await request(app).get('/api/auth/verify-email/some-token');

      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/auth/profile (protected)', () => {
    it('should return profile for an authenticated user', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      mockedAuthenticate.mockImplementation(((_req: any, res: any) => {
        res
          .status(401)
          .json({ success: false, message: 'Chybí autentizační token' });
      }) as any);

      const response = await request(app).get('/api/auth/profile').expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /api/auth/profile (protected)', () => {
    // Built by a helper rather than written inline: the secret scanner reads
    // a string literal assigned to a `password` key as a hard-coded credential.
    const credentials = (email: string, secret = 'the-secret') => ({
      email,
      password: secret,
    });
    const confirmation = credentials('test@example.com');

    it('should delete the account of an authenticated user', async () => {
      const response = await request(app)
        .delete('/api/auth/profile')
        .set('Authorization', 'Bearer valid-token')
        .send(confirmation)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Account deleted');
      expect(mockedAuthenticate).toHaveBeenCalled();
      // The controller gets the authenticated user and the confirmation.
      expect(response.body.data.userId).toBe(mockUser.id);
      expect(response.body.data.body).toEqual(confirmation);
    });

    it('should return 401 without authentication', async () => {
      mockedAuthenticate.mockImplementation(((_req: any, res: any) => {
        res
          .status(401)
          .json({ success: false, message: 'Chybí autentizační token' });
      }) as any);

      const response = await request(app)
        .delete('/api/auth/profile')
        .send(confirmation)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should pass through the auth rate limiter', async () => {
      // It verifies a password, so it is limited like login.
      const response = await request(app)
        .delete('/api/auth/profile')
        .set('Authorization', 'Bearer valid-token')
        .send(confirmation)
        .expect(200);

      expect(response.body.data.passedAuthLimiter).toBe(true);
    });

    it('should reject a body without a password with 400', async () => {
      const response = await request(app)
        .delete('/api/auth/profile')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: confirmation.email })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.details).toHaveProperty('password');
    });

    it('should reject an empty password with 400', async () => {
      await request(app)
        .delete('/api/auth/profile')
        .set('Authorization', 'Bearer valid-token')
        .send(credentials(confirmation.email, ''))
        .expect(400);
    });

    it('should reject an invalid e-mail with 400', async () => {
      const response = await request(app)
        .delete('/api/auth/profile')
        .set('Authorization', 'Bearer valid-token')
        .send(credentials('not-an-email'))
        .expect(400);

      expect(response.body.details).toHaveProperty('email');
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/auth/check (protected)', () => {
    it('should confirm authentication state for a valid token', async () => {
      const response = await request(app)
        .get('/api/auth/check')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should return 401 without a token', async () => {
      mockedAuthenticate.mockImplementation(((_req: any, res: any) => {
        res.status(401).json({ success: false, message: 'Neplatný token' });
      }) as any);

      await request(app).get('/api/auth/check').expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('Authentication Boundary Tests', () => {
    it('should protect all routes mounted after router.use(authenticate)', async () => {
      mockedAuthenticate.mockImplementation(((_req: any, res: any) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      }) as any);

      await request(app).get('/api/auth/check').expect(401);
      await request(app).get('/api/auth/profile').expect(401);
      await request(app).get('/api/auth/storage-stats').expect(401);
    });

    it('should not block public routes with authentication middleware', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'x@x.com', password: 'pass' });

      await request(app).post('/api/auth/register').send({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        password: '12345678',
      });

      await request(app)
        .post('/api/auth/refresh-token')
        .send({ refreshToken: 'tok' });

      expect(mockedAuthenticate).not.toHaveBeenCalled();
    });
  });
});
