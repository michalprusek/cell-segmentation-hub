/**
 * AuthController behavioral tests — cover handlers that are NOT tested in
 * auth.controller.test.ts: requestPasswordReset, resetPasswordWithToken,
 * changePassword, verifyEmail, resendVerificationEmail, getProfile,
 * updateProfile, deleteAccount, checkAuth, getStorageStats,
 * getUserStorageStats, uploadAvatar.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── CRITICAL: mock config before any import that transitively loads it ─────
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
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

vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../services/authService');
vi.mock('../../../services/userService');

vi.mock('../../../db', () => ({
  prisma: {
    image: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../../db';
import * as AuthService from '../../../services/authService';
import * as UserService from '../../../services/userService';
import {
  requestPasswordReset,
  resetPasswordWithToken,
  changePassword,
  verifyEmail,
  resendVerificationEmail,
  getProfile,
  updateProfile,
  deleteAccount,
  checkAuth,
  getStorageStats,
  getUserStorageStats,
  uploadAvatar,
} from '../authController';

const MockedAuthService = vi.mocked(AuthService, true);
const MockedUserService = vi.mocked(UserService, true);

// ── Helpers ────────────────────────────────────────────────────────────────

const USER = { id: 'user-id-1', email: 'user@test.com', emailVerified: true };

function buildApp(
  handler: express.RequestHandler,
  authenticated = true,
  paramName?: string
) {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    app.use((req: express.Request & { user?: unknown }, _res, next) => {
      req.user = USER;
      next();
    });
  }
  const path = paramName ? `/:${paramName}` : '/';
  app.post(path, handler);
  app.get(path, handler);
  app.put(path, handler);
  app.delete(path, handler);
  // Minimal error handler so asyncHandler-propagated errors produce JSON
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode ?? 500).json({ success: false, error: err.message });
  });
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AuthController — extended behavioral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── requestPasswordReset ─────────────────────────────────────────────────

  describe('requestPasswordReset', () => {
    it('returns 400 when email is invalid', async () => {
      const app = buildApp(requestPasswordReset, false);
      const res = await request(app)
        .post('/')
        .send({ email: 'not-an-email' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with success message when email is valid', async () => {
      MockedAuthService.requestPasswordReset = vi.fn().mockResolvedValue({
        message: 'Pokud email existuje, byl odeslán email s instrukcemi.',
      });

      const app = buildApp(requestPasswordReset, false);
      const res = await request(app)
        .post('/')
        .send({ email: 'user@test.com' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('email');
    });

    it('returns 404 when UserNotFoundError is thrown', async () => {
      const { UserNotFoundError } = await import('../../../middleware/error');
      MockedAuthService.requestPasswordReset = vi
        .fn()
        .mockRejectedValue(new UserNotFoundError('User not found'));

      const app = buildApp(requestPasswordReset, false);
      const res = await request(app)
        .post('/')
        .send({ email: 'missing@test.com' })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('returns 500 on unexpected service error', async () => {
      MockedAuthService.requestPasswordReset = vi
        .fn()
        .mockRejectedValue(new Error('SMTP failure'));

      const app = buildApp(requestPasswordReset, false);
      const res = await request(app)
        .post('/')
        .send({ email: 'user@test.com' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ── resetPasswordWithToken ───────────────────────────────────────────────

  describe('resetPasswordWithToken', () => {
    it('returns 400 when body is missing required fields', async () => {
      const app = buildApp(resetPasswordWithToken, false);
      const res = await request(app).post('/').send({}).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when newPassword is too short', async () => {
      const app = buildApp(resetPasswordWithToken, false);
      const res = await request(app)
        .post('/')
        .send({ token: 'abc123', newPassword: 'short' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 and success message when token and password are valid', async () => {
      MockedAuthService.resetPasswordWithToken = vi.fn().mockResolvedValue({
        message: 'Heslo bylo úspěšně změněno.',
      });

      const app = buildApp(resetPasswordWithToken, false);
      const res = await request(app)
        .post('/')
        .send({ token: 'validtoken123', newPassword: 'NewSecure123!' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('Heslo bylo');
    });

    it('propagates service errors (e.g. expired token) as non-2xx', async () => {
      MockedAuthService.resetPasswordWithToken = vi
        .fn()
        .mockRejectedValue(new Error('Token expired'));

      const app = buildApp(resetPasswordWithToken, false);
      const res = await request(app)
        .post('/')
        .send({ token: 'expiredtoken', newPassword: 'NewSecure123!' });

      // asyncHandler forwards the error; our middleware returns success=false
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── changePassword ───────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('returns 401 when user is not authenticated', async () => {
      const app = buildApp(changePassword, false);
      const res = await request(app)
        .post('/')
        .send({ currentPassword: 'old', newPassword: 'NewSecure123!' })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 on successful password change', async () => {
      MockedAuthService.changePassword = vi.fn().mockResolvedValue({
        message: 'Heslo bylo úspěšně změněno.',
      });

      const app = buildApp(changePassword, true);
      const res = await request(app)
        .post('/')
        .send({ currentPassword: 'OldPass123!', newPassword: 'NewPass456!' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(MockedAuthService.changePassword).toHaveBeenCalledWith(
        USER.id,
        expect.objectContaining({ currentPassword: 'OldPass123!' })
      );
    });
  });

  // ── verifyEmail ──────────────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('returns 200 on valid token', async () => {
      MockedAuthService.verifyEmail = vi.fn().mockResolvedValue({
        message: 'Email byl úspěšně ověřen.',
      });

      const app = buildApp(verifyEmail, false, 'token');
      const res = await request(app).get('/sometoken123').expect(200);

      expect(res.body.success).toBe(true);
      expect(MockedAuthService.verifyEmail).toHaveBeenCalledWith('sometoken123');
    });

    it('propagates service error when token is invalid', async () => {
      MockedAuthService.verifyEmail = vi
        .fn()
        .mockRejectedValue(new Error('Invalid token'));

      const app = buildApp(verifyEmail, false, 'token');
      const res = await request(app).get('/badtoken');
      // asyncHandler forwards; our error middleware returns success=false
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── resendVerificationEmail ──────────────────────────────────────────────

  describe('resendVerificationEmail', () => {
    it('returns 200 when service succeeds', async () => {
      MockedAuthService.resendVerificationEmail = vi.fn().mockResolvedValue({
        message: 'Pokud email existuje a není ověřen, byl odeslán ověřovací email.',
      });

      const app = buildApp(resendVerificationEmail, false);
      const res = await request(app)
        .post('/')
        .send({ email: 'user@test.com' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ── getProfile ───────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(getProfile, false);
      const res = await request(app).get('/').expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when profile is null', async () => {
      MockedUserService.getUserProfile = vi.fn().mockResolvedValue(null);

      const app = buildApp(getProfile, true);
      const res = await request(app).get('/').expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with profile data', async () => {
      const profile = { id: USER.id, email: USER.email, totalProjects: 3 };
      MockedUserService.getUserProfile = vi.fn().mockResolvedValue(profile);

      const app = buildApp(getProfile, true);
      const res = await request(app).get('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(profile);
      expect(MockedUserService.getUserProfile).toHaveBeenCalledWith(USER.id);
    });

    it('returns 500 when service throws', async () => {
      MockedUserService.getUserProfile = vi
        .fn()
        .mockRejectedValue(new Error('DB error'));

      const app = buildApp(getProfile, true);
      const res = await request(app).get('/').expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── updateProfile ────────────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(updateProfile, false);
      const res = await request(app).put('/').send({ firstName: 'Jan' }).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with updated profile', async () => {
      const updated = { id: USER.id, firstName: 'Jan' };
      MockedAuthService.updateProfile = vi.fn().mockResolvedValue(updated);

      const app = buildApp(updateProfile, true);
      const res = await request(app).put('/').send({ firstName: 'Jan' }).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(updated);
      expect(MockedAuthService.updateProfile).toHaveBeenCalledWith(
        USER.id,
        expect.objectContaining({ firstName: 'Jan' })
      );
    });
  });

  // ── deleteAccount ────────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(deleteAccount, false);
      const res = await request(app).delete('/').expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 on successful deletion', async () => {
      MockedAuthService.deleteAccount = vi.fn().mockResolvedValue(undefined);

      const app = buildApp(deleteAccount, true);
      const res = await request(app).delete('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(MockedAuthService.deleteAccount).toHaveBeenCalledWith(USER.id);
    });
  });

  // ── checkAuth ────────────────────────────────────────────────────────────

  describe('checkAuth', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(checkAuth, false);
      const res = await request(app).get('/').expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with authenticated=true and user data', async () => {
      const app = buildApp(checkAuth, true);
      const res = await request(app).get('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.authenticated).toBe(true);
      expect(res.body.data.user.id).toBe(USER.id);
      expect(res.body.data.user.email).toBe(USER.email);
    });
  });

  // ── getStorageStats ──────────────────────────────────────────────────────

  describe('getStorageStats', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(getStorageStats, false);
      await request(app).get('/').expect(401);
    });

    it('returns 200 with aggregated storage values', async () => {
      // Two images: 1 MB + 2 MB (as BigInt to match Prisma schema)
      vi.mocked(prisma.image.findMany).mockResolvedValue([
        { fileSize: BigInt(1024 * 1024) },
        { fileSize: BigInt(2 * 1024 * 1024) },
      ]);

      const app = buildApp(getStorageStats, true);
      const res = await request(app).get('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totalImages).toBe(2);
      expect(res.body.data.totalMB).toBeCloseTo(3, 0);
      expect(res.body.data.totalStorageMB).toBeCloseTo(3, 0);
    });

    it('returns 0 values when there are no images', async () => {
      vi.mocked(prisma.image.findMany).mockResolvedValue([]);

      const app = buildApp(getStorageStats, true);
      const res = await request(app).get('/').expect(200);

      expect(res.body.data.totalImages).toBe(0);
      expect(res.body.data.totalMB).toBe(0);
    });
  });

  // ── getUserStorageStats ──────────────────────────────────────────────────

  describe('getUserStorageStats', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(getUserStorageStats, false);
      await request(app).get('/').expect(401);
    });

    it('returns 200 with per-project aggregated stats', async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: 'proj-1',
          images: [
            { fileSize: BigInt(512 * 1024) },
            { fileSize: BigInt(512 * 1024) },
          ],
        },
        {
          id: 'proj-2',
          images: [{ fileSize: null }],
        },
      ]);

      const app = buildApp(getUserStorageStats, true);
      const res = await request(app).get('/').expect(200);

      expect(res.body.success).toBe(true);
      // 3 images total (including the null-fileSize one counted)
      expect(res.body.data.totalImages).toBe(3);
      // 1 MB total (2 × 512 KB)
      expect(res.body.data.totalStorageMB).toBeCloseTo(1, 0);
    });
  });

  // ── uploadAvatar ─────────────────────────────────────────────────────────

  describe('uploadAvatar', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(uploadAvatar, false);
      const res = await request(app).post('/').expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when no file is attached', async () => {
      // No req.file — multer middleware absent, so req.file is undefined
      const app = buildApp(uploadAvatar, true);
      const res = await request(app).post('/').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when cropData JSON is invalid', async () => {
      // Inject req.file via middleware shim
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = USER;
        (req as any).file = {
          fieldname: 'avatar',
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 100,
          buffer: Buffer.alloc(100),
          path: './test-uploads/temp/photo.jpg',
        };
        next();
      });
      app.post('/', uploadAvatar);

      const res = await request(app)
        .post('/')
        .send({ cropData: 'NOT_VALID_JSON{{' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when cropData has invalid dimensions', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = USER;
        (req as any).file = {
          fieldname: 'avatar',
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 100,
          buffer: Buffer.alloc(100),
          path: './test-uploads/temp/photo.jpg',
        };
        next();
      });
      app.post('/', uploadAvatar);

      // width and height must be > 0
      const res = await request(app)
        .post('/')
        .send({ cropData: JSON.stringify({ x: 0, y: 0, width: -5, height: 100 }) })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 after successful avatar upload', async () => {
      MockedAuthService.uploadAvatar = vi.fn().mockResolvedValue({
        avatarUrl: 'http://example.com/avatar.jpg',
      });

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = USER;
        (req as any).file = {
          fieldname: 'avatar',
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 512,
          buffer: Buffer.alloc(512),
          path: './test-uploads/temp/photo.jpg',
        };
        next();
      });
      app.post('/', uploadAvatar);

      const res = await request(app).post('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.avatarUrl).toBe('http://example.com/avatar.jpg');
      expect(MockedAuthService.uploadAvatar).toHaveBeenCalledWith(
        USER.id,
        expect.objectContaining({ originalname: 'photo.jpg' }),
        undefined
      );
    });

    it('returns 400 when file exceeds max avatar size', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = USER;
        // 3 MB — default MAX_AVATAR_SIZE is 2 MB
        (req as any).file = {
          fieldname: 'avatar',
          originalname: 'huge.jpg',
          mimetype: 'image/jpeg',
          size: 3 * 1024 * 1024,
          buffer: Buffer.alloc(10),
          path: './test-uploads/temp/huge.jpg',
        };
        next();
      });
      app.post('/', uploadAvatar);

      const res = await request(app).post('/').expect(400);
      expect(res.body.success).toBe(false);
    });
  });
});
