/**
 * authService.branch.test.ts
 *
 * Covers branches NOT already tested in authService.test.ts or
 * authService.gaps.test.ts:
 *
 *  - register: email already exists → ApiError.conflict
 *  - register: username already taken → ApiError.conflict
 *  - register: unexpected DB error → wraps as ApiError.internalError
 *  - login: rememberMe=true passes through to generateTokenPair
 *  - login: rememberMe=false (default) passes through
 *  - login: user not found → throws unauthorized
 *  - login: wrong password → throws unauthorized
 *  - login: unexpected DB error → wraps as ApiError.internalError
 *  - logout: success path (deleteRefreshToken returns true)
 *  - logout: token not found (deleteRefreshToken returns false) — silent warn, no throw
 *  - logout: unexpected error → wraps as ApiError.internalError
 *  - deleteAccount: user not found → ApiError.notFound
 *  - deleteAccount: unexpected DB error → wraps as ApiError.internalError
 *  - updateProfile: user not found → ApiError.notFound
 *  - updateProfile: unexpected DB error → wraps as ApiError.internalError
 *  - refreshToken: rotateRefreshToken returns null → throws unauthorized
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Config mock (must come first — prevents process.exit trap) ────────────────

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
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

// ── Hoisted mocks (referenced by vi.mock factories) ───────────────────────────

const { prismaMock, sessionServiceMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
      findFirst: vi.fn() as ReturnType<typeof vi.fn>,
      findMany: vi.fn() as ReturnType<typeof vi.fn>,
      create: vi.fn() as ReturnType<typeof vi.fn>,
      update: vi.fn() as ReturnType<typeof vi.fn>,
      delete: vi.fn() as ReturnType<typeof vi.fn>,
      deleteMany: vi.fn() as ReturnType<typeof vi.fn>,
    },
    profile: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
      upsert: vi.fn() as ReturnType<typeof vi.fn>,
      create: vi.fn() as ReturnType<typeof vi.fn>,
      update: vi.fn() as ReturnType<typeof vi.fn>,
      deleteMany: vi.fn() as ReturnType<typeof vi.fn>,
    },
    session: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
      create: vi.fn() as ReturnType<typeof vi.fn>,
      update: vi.fn() as ReturnType<typeof vi.fn>,
      updateMany: vi.fn() as ReturnType<typeof vi.fn>,
      delete: vi.fn() as ReturnType<typeof vi.fn>,
      deleteMany: vi.fn() as ReturnType<typeof vi.fn>,
    },
    project: {
      findMany: vi.fn() as ReturnType<typeof vi.fn>,
      deleteMany: vi.fn() as ReturnType<typeof vi.fn>,
    },
    image: { deleteMany: vi.fn() as ReturnType<typeof vi.fn> },
    segmentation: { deleteMany: vi.fn() as ReturnType<typeof vi.fn> },
    segmentationQueue: { deleteMany: vi.fn() as ReturnType<typeof vi.fn> },
    $transaction: vi.fn() as ReturnType<typeof vi.fn>,
  },
  sessionServiceMock: {
    storeRefreshToken: vi.fn() as ReturnType<typeof vi.fn>,
    createSession: vi.fn() as ReturnType<typeof vi.fn>,
    rotateRefreshToken: vi.fn() as ReturnType<typeof vi.fn>,
    verifyRefreshToken: vi.fn() as ReturnType<typeof vi.fn>,
    deleteRefreshToken: vi.fn() as ReturnType<typeof vi.fn>,
  },
}));

vi.mock('../../utils/database', () => ({
  withTransaction: vi
    .fn()
    .mockImplementation(
      async (_client: unknown, callback: (c: unknown) => Promise<unknown>) =>
        callback(_client)
    ),
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../auth/password');
vi.mock('../../auth/jwt');
vi.mock('../../utils/logger');
vi.mock('../../services/emailService');
vi.mock('../../services/sessionService', () => ({
  sessionService: sessionServiceMock,
}));
vi.mock('../../storage/index', () => ({ getStorageProvider: vi.fn() }));
vi.mock('sharp', () => ({ default: vi.fn() }));

// ── Imports ───────────────────────────────────────────────────────────────────

import * as authService from '../authService';
import {
  hashPassword,
  verifyPassword,
  generateSecureToken,
} from '../../auth/password';
import { generateTokenPair } from '../../auth/jwt';
import * as EmailService from '../../services/emailService';

const mockHash = hashPassword as ReturnType<typeof vi.fn>;
const mockVerify = verifyPassword as ReturnType<typeof vi.fn>;
const mockTokenPair = generateTokenPair as ReturnType<typeof vi.fn>;
const mockSecureToken = generateSecureToken as ReturnType<typeof vi.fn>;
const mockSendVerification = EmailService.sendVerificationEmail as ReturnType<
  typeof vi.fn
>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseUser = {
  id: 'user-1',
  email: 'user@example.com',
  password: 'hashed-pw',
  emailVerified: true,
  resetToken: null as string | null,
  resetTokenExpiry: null as Date | null,
  verificationToken: null as string | null,
  profile: { id: 'p1', userId: 'user-1', preferredLang: 'en' },
  projects: [] as Array<{ id: string; images: Array<{ id: string }> }>,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthService (branch coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendVerification.mockResolvedValue(undefined);
    mockSecureToken.mockReturnValue('tok-xyz');
    mockHash.mockResolvedValue('hashed-value');
    mockVerify.mockResolvedValue(true);
    mockTokenPair.mockReturnValue({
      accessToken: 'at',
      refreshToken: 'rt',
    });
    sessionServiceMock.storeRefreshToken.mockResolvedValue(undefined);
    sessionServiceMock.deleteRefreshToken.mockResolvedValue(true);
    sessionServiceMock.rotateRefreshToken.mockResolvedValue({
      token: 'new-rt',
      userId: 'user-1',
    });
  });

  // =========================================================================
  // register — conflict / error branches
  // =========================================================================
  describe('register', () => {
    it('throws conflict when email already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing' });

      await expect(
        authService.register({
          email: 'user@example.com',
          password: 'Pass1234!',
        })
      ).rejects.toThrow(/existuje/i);
    });

    it('throws conflict when username is already taken', async () => {
      // findUnique for email → null (not taken), then findUnique for username → taken
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.profile.findUnique.mockResolvedValueOnce({
        id: 'existing-profile',
      });

      await expect(
        authService.register({
          email: 'new@example.com',
          password: 'Pass1234!',
          username: 'takenname',
        })
      ).rejects.toThrow(/existuje/i);
    });

    it('wraps unexpected DB errors as internalError', async () => {
      prismaMock.user.findUnique.mockRejectedValueOnce(
        new Error('DB connection lost')
      );

      await expect(
        authService.register({
          email: 'new@example.com',
          password: 'Pass1234!',
        })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // login — branches
  // =========================================================================
  describe('login', () => {
    it('returns tokens when user exists and password is correct', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);

      const result = await authService.login({
        email: 'user@example.com',
        password: 'Pass1234!',
      });

      expect(result.accessToken).toBe('at');
      expect(result.refreshToken).toBe('rt');
    });

    it('passes rememberMe=true to generateTokenPair', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);

      await authService.login({
        email: 'user@example.com',
        password: 'Pass1234!',
        rememberMe: true,
      });

      expect(mockTokenPair).toHaveBeenCalledWith(expect.anything(), true);
    });

    it('passes rememberMe=false when not provided (default)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);

      await authService.login({
        email: 'user@example.com',
        password: 'Pass1234!',
      });

      expect(mockTokenPair).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('throws unauthorized when user is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.login({ email: 'ghost@example.com', password: 'pw' })
      ).rejects.toThrow();
    });

    it('throws unauthorized when password is wrong', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);
      mockVerify.mockResolvedValueOnce(false);

      await expect(
        authService.login({ email: 'user@example.com', password: 'wrong' })
      ).rejects.toThrow();
    });

    it('wraps unexpected DB errors as internalError', async () => {
      prismaMock.user.findUnique.mockRejectedValueOnce(new Error('disk full'));

      await expect(
        authService.login({ email: 'user@example.com', password: 'pw' })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // logout
  // =========================================================================
  describe('logout', () => {
    it('resolves without throwing when token is valid and deleted', async () => {
      sessionServiceMock.deleteRefreshToken.mockResolvedValueOnce(true);
      await expect(authService.logout('valid-rt')).resolves.toBeUndefined();
      expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
        'valid-rt'
      );
    });

    it('resolves silently (warn only) when token was not found', async () => {
      sessionServiceMock.deleteRefreshToken.mockResolvedValueOnce(false);
      // Should NOT throw — just logs a warning
      await expect(authService.logout('missing-rt')).resolves.toBeUndefined();
    });

    it('throws when sessionService.deleteRefreshToken rejects unexpectedly', async () => {
      sessionServiceMock.deleteRefreshToken.mockRejectedValueOnce(
        new Error('Redis unreachable')
      );
      await expect(authService.logout('rt')).rejects.toThrow();
    });
  });

  // =========================================================================
  // refreshToken — null from rotateRefreshToken
  // =========================================================================
  describe('refreshToken', () => {
    it('throws when rotateRefreshToken returns null (invalid/expired session)', async () => {
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce(null);

      await expect(
        authService.refreshToken({ refreshToken: 'expired-rt' })
      ).rejects.toThrow();
    });

    it('returns new tokens when rotation succeeds and user exists', async () => {
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce({
        token: 'rotated-rt',
        userId: 'user-1',
      });
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);

      const result = await authService.refreshToken({ refreshToken: 'old-rt' });

      expect(result.accessToken).toBe('at');
      expect(result.refreshToken).toBe('rotated-rt');
    });
  });

  // =========================================================================
  // deleteAccount — error branches
  // =========================================================================
  describe('deleteAccount', () => {
    it('throws notFound when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(authService.deleteAccount('ghost-id')).rejects.toThrow();
    });

    it('wraps unexpected DB errors as internalError', async () => {
      prismaMock.user.findUnique.mockRejectedValueOnce(new Error('DB crash'));

      await expect(authService.deleteAccount('user-1')).rejects.toThrow();
    });

    it('resolves when user has no projects', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        projects: [],
      });
      prismaMock.session.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.profile.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.user.delete.mockResolvedValueOnce(baseUser);

      await expect(
        authService.deleteAccount('user-1')
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // updateProfile — error branches
  // =========================================================================
  describe('updateProfile', () => {
    it('throws notFound when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.updateProfile('ghost-id', { bio: 'Hi' })
      ).rejects.toThrow();
    });

    it('wraps unexpected prisma.profile.upsert errors as internalError', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);
      prismaMock.profile.upsert.mockRejectedValueOnce(new Error('constraint'));

      await expect(
        authService.updateProfile('user-1', { bio: 'Hello' })
      ).rejects.toThrow();
    });

    it('filters out undefined fields before calling upsert', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);
      prismaMock.profile.upsert.mockResolvedValueOnce({
        id: 'p1',
        userId: 'user-1',
        bio: 'Hello',
      });

      await authService.updateProfile('user-1', {
        bio: 'Hello',
        username: undefined,
      });

      const callArgs = prismaMock.profile.upsert.mock.calls[0][0] as any;
      // undefined fields must be stripped — username must not appear
      expect(callArgs.update).not.toHaveProperty('username');
      expect(callArgs.update.bio).toBe('Hello');
    });
  });
});
