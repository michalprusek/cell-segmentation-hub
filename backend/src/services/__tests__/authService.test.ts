/**
 * authService.test.ts — consolidated unit suite for src/services/authService.ts
 *
 * Merged from the former authService.{test,branch,gaps,gaps5,avatar}.test.ts
 * incremental split files. Organised by `describe` per concern:
 *
 *   register · login · refreshToken (rotation) · logout (session mgmt) ·
 *   requestPasswordReset / resetPasswordWithToken / changePassword
 *   (password hashing + reset) · verifyEmail / resendVerificationEmail
 *   (email-token issue/verify) · updateProfile · deleteAccount · uploadAvatar
 *
 * Every distinct behaviour / branch / regression from the split files is kept;
 * exact duplicates and shallow re-assertions were dropped. Mock + fixture
 * boilerplate (config, prisma, sessionService, bcrypt/jwt, storage, sharp) is
 * declared once and reset in the root beforeEach.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Config mock (must come first — real config process.exit(1)s on load) ──────
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

// ── Hoisted mocks (referenced by vi.mock factories, which vitest hoists) ──────
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

// withTransaction just invokes the callback with the prisma client passed in.
vi.mock('../../utils/database', () => ({
  withTransaction: vi
    .fn()
    .mockImplementation(
      async (client: unknown, callback: (c: unknown) => Promise<unknown>) =>
        callback(client)
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

const mockStorageUpload = vi.fn();
const mockStorageGetUrl = vi.fn();
const mockStorageDelete = vi.fn();
vi.mock('../../storage/index', () => ({
  getStorageProvider: vi.fn(() => ({
    upload: mockStorageUpload,
    getUrl: mockStorageGetUrl,
    delete: mockStorageDelete,
  })),
}));

const mockSharpMetadata = vi.fn();
const mockSharpResize = vi.fn().mockReturnThis();
const mockSharpJpeg = vi.fn().mockReturnThis();
const mockSharpToBuffer = vi.fn();
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: mockSharpMetadata,
    resize: mockSharpResize,
    jpeg: mockSharpJpeg,
    toBuffer: mockSharpToBuffer,
  })),
}));

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import * as authService from '../authService';
import {
  hashPassword,
  verifyPassword,
  generateSecureToken,
} from '../../auth/password';
import { generateTokenPair } from '../../auth/jwt';
import * as EmailService from '../../services/emailService';
import { ApiError, UserNotFoundError } from '../../middleware/error';
import sharp from 'sharp';

const mockHashPassword = hashPassword as ReturnType<typeof vi.fn>;
const mockVerifyPassword = verifyPassword as ReturnType<typeof vi.fn>;
const mockGenerateTokenPair = generateTokenPair as ReturnType<typeof vi.fn>;
const mockGenerateSecureToken = generateSecureToken as ReturnType<typeof vi.fn>;
const mockSendPasswordResetEmail =
  EmailService.sendPasswordResetEmail as ReturnType<typeof vi.fn>;
const mockSendVerificationEmail =
  EmailService.sendVerificationEmail as ReturnType<typeof vi.fn>;

// ── Shared fixtures ───────────────────────────────────────────────────────────
const baseUser = {
  id: 'user-1',
  email: 'user@example.com',
  password: 'hashed-pw',
  emailVerified: true,
  resetToken: null as string | null,
  resetTokenExpiry: null as Date | null,
  verificationToken: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: {
    id: 'p1',
    userId: 'user-1',
    username: 'testuser',
    preferredLang: 'en',
    avatarPath: null as string | null,
  },
  projects: [] as Array<{ id: string; images: Array<{ id: string }> }>,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe defaults — individual tests override with *Once where needed.
    mockSendVerificationEmail.mockResolvedValue(undefined);
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    mockGenerateSecureToken.mockReturnValue('secure-token-abc123');
    mockHashPassword.mockResolvedValue('hashed-value');
    mockVerifyPassword.mockResolvedValue(true);
    mockGenerateTokenPair.mockReturnValue({
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
  // register
  // =========================================================================
  describe('register', () => {
    it('registers a new user successfully and hashes the password', async () => {
      const registerData = {
        email: 'test@example.com',
        password: 'password123',
        username: 'testuser',
      };
      const mockUser = {
        id: 'user-id',
        email: registerData.email,
        password: 'hashedPassword123',
        emailVerified: false,
        profile: {
          id: 'profile-id',
          username: 'testuser',
          userId: 'user-id',
          preferredLang: 'cs',
        },
      };
      const mockTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      prismaMock.user.findUnique.mockResolvedValue(null); // email available
      prismaMock.profile.findUnique.mockResolvedValue(null); // username available
      mockHashPassword.mockResolvedValue('hashedPassword123');
      prismaMock.user.create.mockResolvedValue(mockUser);
      mockGenerateTokenPair.mockReturnValue(mockTokens);
      prismaMock.session.create.mockResolvedValue({});

      const result = await authService.register(registerData);

      expect(result).toMatchObject({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          emailVerified: mockUser.emailVerified,
        },
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
      });
      expect(mockHashPassword).toHaveBeenCalledWith(registerData.password);
    });

    it('throws conflict when the email already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing' });

      await expect(
        authService.register({
          email: 'user@example.com',
          password: 'Pass1234!',
        })
      ).rejects.toThrow(/existuje/i);
    });

    it('throws conflict when the username is already taken', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null); // email free
      prismaMock.profile.findUnique.mockResolvedValueOnce({
        id: 'existing-profile',
      }); // username taken

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

    it('swallows verification-email send failure (fire-and-forget)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.profile.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValueOnce({
        ...baseUser,
        emailVerified: false,
        profile: { preferredLang: 'cs' },
      });
      prismaMock.session.create.mockResolvedValueOnce({ id: 'sess-1' });
      mockGenerateTokenPair.mockReturnValueOnce({
        accessToken: 'at',
        refreshToken: 'rt',
      });
      // The .then().catch() chain attaches the rejection handler synchronously.
      mockSendVerificationEmail.mockRejectedValueOnce(new Error('SMTP down'));

      const result = await authService.register({
        email: 'new@example.com',
        password: 'password123',
      });

      expect(result.user).toBeDefined();
      // Let the fire-and-forget .catch() settle.
      await new Promise(r => setTimeout(r, 20));
    });
  });

  // =========================================================================
  // login
  // =========================================================================
  describe('login', () => {
    it('logs in successfully and looks the user up with its profile', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
        rememberMe: true,
      };
      const mockUser = {
        id: 'user-id',
        email: loginData.email,
        password: 'hashedPassword',
        emailVerified: true,
        profile: { id: 'profile-id', username: 'testuser' },
      };
      const mockTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser);
      mockVerifyPassword.mockResolvedValueOnce(true);
      mockGenerateTokenPair.mockReturnValueOnce(mockTokens);

      const result = await authService.login(loginData);

      expect(result).toMatchObject({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          emailVerified: mockUser.emailVerified,
        },
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
      });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { email: loginData.email },
        include: { profile: true },
      });
      expect(mockVerifyPassword).toHaveBeenCalledWith(
        loginData.password,
        mockUser.password
      );
    });

    it('passes rememberMe=true through to generateTokenPair', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);

      await authService.login({
        email: 'user@example.com',
        password: 'Pass1234!',
        rememberMe: true,
      });

      expect(mockGenerateTokenPair).toHaveBeenCalledWith(
        expect.anything(),
        true
      );
    });

    it('defaults rememberMe to false when not provided', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);

      await authService.login({
        email: 'user@example.com',
        password: 'Pass1234!',
      });

      expect(mockGenerateTokenPair).toHaveBeenCalledWith(
        expect.anything(),
        false
      );
    });

    it('throws unauthorized when the user is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.login({ email: 'ghost@example.com', password: 'pw' })
      ).rejects.toThrow();
    });

    it('throws unauthorized when the password is wrong', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);
      mockVerifyPassword.mockResolvedValueOnce(false);

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

    it('throws when REQUIRE_EMAIL_VERIFICATION=true and email is unverified', async () => {
      vi.stubEnv('REQUIRE_EMAIL_VERIFICATION', 'true');
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        emailVerified: false,
        profile: null,
      });
      mockVerifyPassword.mockResolvedValueOnce(true);

      await expect(
        authService.login({ email: 'user@example.com', password: 'pw' })
      ).rejects.toThrow();

      vi.unstubAllEnvs();
    });

    it('allows login when REQUIRE_EMAIL_VERIFICATION=true and email IS verified', async () => {
      vi.stubEnv('REQUIRE_EMAIL_VERIFICATION', 'true');
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        emailVerified: true,
        profile: null,
      });
      mockVerifyPassword.mockResolvedValueOnce(true);
      mockGenerateTokenPair.mockReturnValueOnce({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      const result = await authService.login({
        email: 'user@example.com',
        password: 'pw',
      });

      expect(result.accessToken).toBe('at');
      vi.unstubAllEnvs();
    });
  });

  // =========================================================================
  // refreshToken — token rotation
  // =========================================================================
  describe('refreshToken (token rotation)', () => {
    it('returns new tokens when rotation succeeds and the user exists', async () => {
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce({
        token: 'rotated-rt',
        userId: 'user-1',
      });
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);

      const result = await authService.refreshToken({ refreshToken: 'old-rt' });

      expect(result.accessToken).toBe('at');
      expect(result.refreshToken).toBe('rotated-rt');
    });

    it('throws when rotateRefreshToken returns null (invalid/expired session)', async () => {
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce(null);

      await expect(
        authService.refreshToken({ refreshToken: 'expired-rt' })
      ).rejects.toThrow();
    });

    it('throws when the user row is missing even though the session was valid', async () => {
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce({
        token: 'new-refresh',
        userId: 'deleted-user-id',
      });
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.refreshToken({ refreshToken: 'old-refresh' })
      ).rejects.toThrow();
    });

    it('wraps an unexpected rotation error as internalError', async () => {
      sessionServiceMock.rotateRefreshToken.mockRejectedValueOnce(
        new Error('DB timeout')
      );

      await expect(
        authService.refreshToken({ refreshToken: 'refresh-token' })
      ).rejects.toThrow('Obnovení tokenu');
    });
  });

  // =========================================================================
  // logout — session management
  // =========================================================================
  describe('logout (session management)', () => {
    it('resolves and deletes the refresh token when it is valid', async () => {
      sessionServiceMock.deleteRefreshToken.mockResolvedValueOnce(true);

      await expect(authService.logout('valid-rt')).resolves.toBeUndefined();
      expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
        'valid-rt'
      );
    });

    it('resolves silently (warn only) when the token was not found', async () => {
      sessionServiceMock.deleteRefreshToken.mockResolvedValueOnce(false);

      await expect(authService.logout('missing-rt')).resolves.toBeUndefined();
    });

    it('throws when deleteRefreshToken rejects unexpectedly', async () => {
      sessionServiceMock.deleteRefreshToken.mockRejectedValueOnce(
        new Error('Redis unreachable')
      );

      await expect(authService.logout('rt')).rejects.toThrow();
    });
  });

  // =========================================================================
  // requestPasswordReset — password reset
  // =========================================================================
  describe('requestPasswordReset (password reset)', () => {
    it('throws UserNotFoundError when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.requestPasswordReset({ email: 'ghost@example.com' })
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it('returns the reset token in a non-production env', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: { preferredLang: 'en' },
      });
      mockHashPassword.mockResolvedValueOnce('hashed-reset-token');
      prismaMock.user.update.mockResolvedValueOnce({ ...baseUser });

      const result = await authService.requestPasswordReset({
        email: 'user@example.com',
      });

      expect(result.message).toBeDefined();
      expect(typeof result.resetToken).toBe('string');
    });

    it('stores the HASHED reset token (never the plaintext) in the database', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: { preferredLang: 'cs' },
      });
      mockHashPassword.mockResolvedValueOnce('hashed-token-value');
      prismaMock.user.update.mockResolvedValueOnce({ ...baseUser });

      await authService.requestPasswordReset({ email: 'user@example.com' });

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resetToken: 'hashed-token-value',
            resetTokenExpiry: expect.any(Date),
          }),
        })
      );
    });

    it('does not send email when SKIP_EMAIL_SEND=true', async () => {
      vi.stubEnv('SKIP_EMAIL_SEND', 'true');
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: null,
      });
      mockHashPassword.mockResolvedValueOnce('token-hash');
      prismaMock.user.update.mockResolvedValueOnce({ ...baseUser });

      const result = await authService.requestPasswordReset({
        email: 'user@example.com',
      });

      expect(result.message).toBeTruthy();
      expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('sets the token expiry to approximately 1 hour in the future', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: null,
      });
      mockHashPassword.mockResolvedValueOnce('hash');

      let capturedExpiry: Date | null = null;
      prismaMock.user.update.mockImplementationOnce(async (args: any) => {
        capturedExpiry = args.data.resetTokenExpiry;
        return baseUser;
      });

      const before = Date.now();
      await authService.requestPasswordReset({ email: 'user@example.com' });
      const after = Date.now();

      const expiryMs = capturedExpiry!.getTime();
      const oneHour = 60 * 60 * 1000;
      expect(expiryMs).toBeGreaterThanOrEqual(before + oneHour - 1000);
      expect(expiryMs).toBeLessThanOrEqual(after + oneHour + 1000);
    });

    it('swallows a reset-email send failure but still returns a response', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: { preferredLang: 'cs' },
      });
      prismaMock.user.update.mockResolvedValueOnce({});
      mockSendPasswordResetEmail.mockRejectedValueOnce(new Error('SMTP error'));

      const result = await authService.requestPasswordReset({
        email: 'user@example.com',
      });

      expect(result.message).toBeTruthy();
      await new Promise(r => setTimeout(r, 20));
    });

    it('uses the default locale when the user has no profile', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: null,
      });
      prismaMock.user.update.mockResolvedValueOnce({});

      const result = await authService.requestPasswordReset({
        email: 'user@example.com',
      });

      expect(result.message).toBeTruthy();
      expect(mockSendPasswordResetEmail).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // resetPasswordWithToken — password reset
  // =========================================================================
  describe('resetPasswordWithToken (password reset)', () => {
    it('resets the password and invalidates sessions when the token matches', async () => {
      const user = {
        ...baseUser,
        id: 'u1',
        resetToken: 'stored-hash',
        resetTokenExpiry: new Date(Date.now() + 3600 * 1000),
      };
      prismaMock.user.findMany.mockResolvedValueOnce([user]);
      mockVerifyPassword.mockResolvedValueOnce(true); // token matches
      mockHashPassword.mockResolvedValueOnce('new-hashed-pw');
      prismaMock.user.update.mockResolvedValueOnce({ ...user });
      prismaMock.session.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await authService.resetPasswordWithToken({
        token: 'plain-reset-token',
        newPassword: 'newSecure123!',
      });

      expect(result.message).toBeDefined();
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            password: 'new-hashed-pw',
            resetToken: null,
            resetTokenExpiry: null,
          }),
        })
      );
      expect(prismaMock.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isValid: false } })
      );
    });

    it('throws when no users have non-expired reset tokens', async () => {
      prismaMock.user.findMany.mockResolvedValueOnce([]);

      await expect(
        authService.resetPasswordWithToken({
          token: 'bad-token',
          newPassword: 'newpass',
        })
      ).rejects.toThrow();
    });

    it('throws when the token does not match any stored hash', async () => {
      prismaMock.user.findMany.mockResolvedValueOnce([
        {
          ...baseUser,
          resetToken: 'stored-hash',
          resetTokenExpiry: new Date(Date.now() + 3600 * 1000),
        },
      ]);
      mockVerifyPassword.mockResolvedValueOnce(false); // no match

      await expect(
        authService.resetPasswordWithToken({
          token: 'wrong-token',
          newPassword: 'newpass',
        })
      ).rejects.toThrow();
    });

    it('wraps an unexpected DB error as internalError', async () => {
      prismaMock.user.findMany.mockRejectedValueOnce(
        new Error('PG connection lost')
      );

      await expect(
        authService.resetPasswordWithToken({
          token: 'tok',
          newPassword: 'new-pw',
        })
      ).rejects.toThrow('Reset hesla');
    });
  });

  // =========================================================================
  // changePassword — password hashing
  // =========================================================================
  describe('changePassword (password hashing)', () => {
    it('changes the password and invalidates sessions when current password is correct', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);
      mockVerifyPassword.mockResolvedValueOnce(true);
      mockHashPassword.mockResolvedValueOnce('new-hashed-pw');
      prismaMock.user.update.mockResolvedValueOnce(baseUser);
      prismaMock.session.updateMany.mockResolvedValueOnce({ count: 2 });

      const result = await authService.changePassword('user-1', {
        currentPassword: 'old-pass',
        newPassword: 'new-pass',
      });

      expect(result.message).toBeDefined();
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { password: 'new-hashed-pw' } })
      );
      expect(prismaMock.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isValid: false } })
      );
    });

    it('throws when the user is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.changePassword('ghost-id', {
          currentPassword: 'x',
          newPassword: 'y',
        })
      ).rejects.toThrow();
    });

    it('throws when the current password is wrong', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);
      mockVerifyPassword.mockResolvedValueOnce(false);

      await expect(
        authService.changePassword('user-1', {
          currentPassword: 'wrong-pass',
          newPassword: 'new-pass',
        })
      ).rejects.toThrow();
    });

    it('wraps an unexpected error as internalError', async () => {
      prismaMock.user.findUnique.mockRejectedValueOnce(
        new Error('network error')
      );

      await expect(
        authService.changePassword('user-1', {
          currentPassword: 'old',
          newPassword: 'new-pw-123',
        })
      ).rejects.toThrow('Změna hesla');
    });
  });

  // =========================================================================
  // verifyEmail — email-token verify
  // =========================================================================
  describe('verifyEmail (token verify)', () => {
    it('marks emailVerified=true and clears the verification token', async () => {
      prismaMock.user.findFirst.mockResolvedValueOnce({
        ...baseUser,
        id: 'u2',
        emailVerified: false,
        verificationToken: 'tok-123',
      });
      prismaMock.user.update.mockResolvedValueOnce({
        ...baseUser,
        emailVerified: true,
      });

      const result = await authService.verifyEmail('tok-123');

      expect(result.message).toBeDefined();
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { emailVerified: true, verificationToken: null },
        })
      );
    });

    it('throws when the verification token is not found', async () => {
      prismaMock.user.findFirst.mockResolvedValueOnce(null);

      await expect(authService.verifyEmail('invalid-tok')).rejects.toThrow();
    });
  });

  // =========================================================================
  // resendVerificationEmail — email-token issue
  // =========================================================================
  describe('resendVerificationEmail (token issue)', () => {
    it('returns a generic success message without revealing an unknown email', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const result =
        await authService.resendVerificationEmail('ghost@example.com');

      expect(result.message).toBeDefined();
      expect(result.verificationToken).toBeUndefined();
    });

    it('returns an "already verified" message when the email is verified', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        emailVerified: true,
        profile: null,
      });

      const result =
        await authService.resendVerificationEmail('user@example.com');

      expect(result.message).toContain('ověřen');
    });

    it('updates the verificationToken and exposes it in a non-production env', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        emailVerified: false,
        profile: { preferredLang: 'en' },
      });
      prismaMock.user.update.mockResolvedValueOnce({ ...baseUser });

      const result =
        await authService.resendVerificationEmail('user@example.com');

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationToken: expect.any(String),
          }),
        })
      );
      expect(result.verificationToken).toBeDefined();
    });

    it('wraps an unexpected error as internalError', async () => {
      prismaMock.user.findUnique.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        authService.resendVerificationEmail('user@example.com')
      ).rejects.toThrow('Odeslání ověřovacího emailu');
    });
  });

  // =========================================================================
  // updateProfile
  // =========================================================================
  describe('updateProfile', () => {
    it('updates the profile and returns the merged user', async () => {
      const userId = 'user-id';
      const profileData = {
        username: 'newusername',
        bio: 'New bio',
        preferredModel: 'hrnet',
        consentToMLTraining: true,
      };
      const mockUser = {
        id: userId,
        email: 'test@example.com',
        emailVerified: true,
        profile: {
          id: 'profile-id',
          userId,
          username: 'oldusername',
          bio: 'Old bio',
        },
      };
      const updatedProfile = {
        id: 'profile-id',
        userId,
        username: 'newusername',
        bio: 'New bio',
        preferredModel: 'hrnet',
        consentToMLTraining: true,
        consentUpdatedAt: new Date(),
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser);
      prismaMock.profile.upsert.mockResolvedValueOnce(updatedProfile);

      const result = await authService.updateProfile(userId, profileData);

      expect(result).toEqual({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          emailVerified: mockUser.emailVerified,
          profile: updatedProfile,
        },
      });
    });

    it('throws notFound when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.updateProfile('ghost-id', { bio: 'Hi' })
      ).rejects.toThrow();
    });

    it('wraps an unexpected profile.upsert error as internalError', async () => {
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
      expect(callArgs.update).not.toHaveProperty('username');
      expect(callArgs.update.bio).toBe('Hello');
    });

    it('maps the "language" wire alias to preferredLang', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: { id: 'p1', userId: 'user-1' },
      });
      prismaMock.profile.upsert.mockResolvedValueOnce({
        id: 'p1',
        userId: 'user-1',
        preferredLang: 'fr',
      });

      await authService.updateProfile('user-1', { language: 'fr' });

      expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ preferredLang: 'fr' }),
        })
      );
    });

    it('maps the "theme" wire alias to preferredTheme', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: null,
      });
      prismaMock.profile.upsert.mockResolvedValueOnce({
        id: 'p2',
        userId: 'user-1',
        preferredTheme: 'dark',
      });

      await authService.updateProfile('user-1', { theme: 'dark' });

      expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ preferredTheme: 'dark' }),
        })
      );
    });

    it('sets consentUpdatedAt when any consent field is provided', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: null,
      });
      prismaMock.profile.upsert.mockResolvedValueOnce({
        id: 'p3',
        userId: 'user-1',
        consentToMLTraining: false,
      });

      await authService.updateProfile('user-1', {
        consentToMLTraining: false,
      });

      expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            consentUpdatedAt: expect.any(Date),
          }),
        })
      );
    });

    it('does NOT set consentUpdatedAt when no consent field is provided', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        profile: null,
      });
      prismaMock.profile.upsert.mockResolvedValueOnce({
        id: 'p4',
        userId: 'user-1',
      });

      await authService.updateProfile('user-1', { bio: 'just a bio update' });

      const callArgs = prismaMock.profile.upsert.mock.calls[0][0] as any;
      expect(callArgs.update.consentUpdatedAt).toBeUndefined();
    });
  });

  // =========================================================================
  // deleteAccount
  // =========================================================================
  describe('deleteAccount', () => {
    it('resolves when the user has no projects', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        projects: [],
      });
      prismaMock.session.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.profile.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.user.delete.mockResolvedValueOnce(baseUser);

      await expect(authService.deleteAccount('user-1')).resolves.toBeUndefined();
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: expect.any(Object),
      });
    });

    it('cascades deletes across sessions, images, projects, profile and user', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        projects: [{ id: 'proj-1', images: [{ id: 'img-1' }, { id: 'img-2' }] }],
      });
      prismaMock.session.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.segmentation.deleteMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({
        count: 0,
      });
      prismaMock.image.deleteMany.mockResolvedValueOnce({ count: 2 });
      prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.profile.deleteMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.user.delete.mockResolvedValueOnce({});

      await authService.deleteAccount('user-1');

      expect(prismaMock.session.deleteMany).toHaveBeenCalled();
      expect(prismaMock.image.deleteMany).toHaveBeenCalled();
      expect(prismaMock.user.delete).toHaveBeenCalled();
    });

    it('throws notFound when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(authService.deleteAccount('ghost-id')).rejects.toThrow();
    });

    it('wraps an unexpected DB error as internalError', async () => {
      prismaMock.user.findUnique.mockRejectedValueOnce(new Error('DB crash'));

      await expect(authService.deleteAccount('user-1')).rejects.toThrow();
    });
  });

  // =========================================================================
  // uploadAvatar
  //
  // metadata() is rejected by default so validation falls back to the claimed
  // mimetype check (matches the original avatar suite, which supplied no
  // metadata mock). The resize→jpeg→toBuffer path is exercised independently.
  // =========================================================================
  describe('uploadAvatar', () => {
    const mockUserId = 'test-user-id';
    const processedBuffer = Buffer.from('processed-image');
    const mockFile: Express.Multer.File = {
      fieldname: 'avatar',
      originalname: 'test-avatar.png',
      encoding: '7bit',
      mimetype: 'image/png',
      buffer: Buffer.from('fake-image-data'),
      size: 1024 * 100,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };
    const mockUser = {
      ...baseUser,
      id: mockUserId,
      email: 'test@example.com',
      profile: {
        id: 'profile-id',
        userId: mockUserId,
        username: 'testuser',
        avatarUrl: null,
        avatarPath: null,
      },
    };

    beforeEach(() => {
      mockSharpResize.mockReturnThis();
      mockSharpJpeg.mockReturnThis();
      mockSharpToBuffer.mockResolvedValue(processedBuffer);
      // Force the mimetype-fallback validation branch.
      mockSharpMetadata.mockRejectedValue(new Error('metadata unavailable'));
      mockStorageUpload.mockResolvedValue({
        originalPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        thumbnailPath: null,
        url: 'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
      });
      mockStorageGetUrl.mockResolvedValue(
        'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg'
      );
      mockStorageDelete.mockResolvedValue(undefined);
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      prismaMock.profile.upsert.mockResolvedValue({});
    });

    it('uploads and processes an avatar (resize→jpeg→storage→db)', async () => {
      const result = await authService.uploadAvatar(mockUserId, mockFile);

      expect(result).toEqual({
        avatarUrl:
          'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        message: 'Avatar uploaded successfully',
      });

      expect(sharp).toHaveBeenCalledWith(mockFile.buffer);
      expect(mockSharpResize).toHaveBeenCalledWith(300, 300, {
        fit: 'cover',
        position: 'center',
      });
      expect(mockSharpJpeg).toHaveBeenCalledWith({
        quality: 85,
        progressive: true,
      });
      expect(mockStorageUpload).toHaveBeenCalledWith(
        processedBuffer,
        'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        {
          mimeType: 'image/jpeg',
          originalName: 'test-avatar.png',
          maxSize: 5 * 1024 * 1024,
        }
      );
      expect(prismaMock.profile.upsert).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        update: {
          avatarUrl:
            'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
          avatarPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
          avatarMimeType: 'image/jpeg',
          avatarSize: processedBuffer.length,
        },
        create: {
          userId: mockUserId,
          avatarUrl:
            'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
          avatarPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
          avatarMimeType: 'image/jpeg',
          avatarSize: processedBuffer.length,
        },
      });
    });

    it('deletes the old avatar when uploading a new one', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...mockUser,
        profile: {
          ...mockUser.profile,
          avatarPath: 'avatars/test-user-id/old-avatar.jpg',
        },
      });

      await authService.uploadAvatar(mockUserId, mockFile);

      expect(mockStorageDelete).toHaveBeenCalledWith(
        'avatars/test-user-id/old-avatar.jpg'
      );
    });

    it('rejects invalid file types', async () => {
      await expect(
        authService.uploadAvatar(mockUserId, {
          ...mockFile,
          mimetype: 'text/plain',
        })
      ).rejects.toThrow(ApiError);
    });

    it('rejects files that are too large', async () => {
      await expect(
        authService.uploadAvatar(mockUserId, {
          ...mockFile,
          size: 6 * 1024 * 1024, // over the 5MB limit
        })
      ).rejects.toThrow(ApiError);
    });

    it('rejects when the user is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.uploadAvatar(mockUserId, mockFile)
      ).rejects.toThrow(ApiError);
    });

    it('throws when image processing (sharp) fails', async () => {
      mockSharpToBuffer.mockRejectedValueOnce(
        new Error('Image processing failed')
      );

      await expect(
        authService.uploadAvatar(mockUserId, mockFile)
      ).rejects.toThrow(ApiError);
    });

    it('accepts all supported image formats', async () => {
      const supportedFormats = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp',
        'image/bmp',
        'image/tiff',
        'image/tif',
      ];

      for (const format of supportedFormats) {
        const result = await authService.uploadAvatar(mockUserId, {
          ...mockFile,
          mimetype: format,
        });
        expect(result).toHaveProperty('avatarUrl');
        expect(result).toHaveProperty('message');
      }
    });

    it('always converts uploads to JPEG', async () => {
      await authService.uploadAvatar(mockUserId, {
        ...mockFile,
        mimetype: 'image/png',
      });

      expect(mockStorageUpload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/\.jpg$/),
        expect.objectContaining({ mimeType: 'image/jpeg' })
      );
      expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ avatarMimeType: 'image/jpeg' }),
        })
      );
    });

    it('throws internalError when storage.upload fails', async () => {
      mockStorageUpload.mockRejectedValueOnce(new Error('S3 error'));

      await expect(
        authService.uploadAvatar(mockUserId, mockFile)
      ).rejects.toThrow('Failed to upload avatar');
    });

    it('warns but does not throw when old-avatar deletion fails', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...mockUser,
        profile: { avatarPath: 'avatars/old-avatar.jpg' },
      });
      mockStorageDelete.mockRejectedValueOnce(new Error('S3 delete failed'));

      const result = await authService.uploadAvatar(mockUserId, mockFile);
      expect(result.avatarUrl).toBeTruthy();
    });
  });
});
