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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Config mock (must come first — real config process.exit(1)s on load) ──────
vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-secret',
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
const { prismaMock, sessionServiceMock, accountFilesMock, liveMock } =
  vi.hoisted(() => ({
  liveMock: {
    disconnectUserSockets: vi.fn() as ReturnType<typeof vi.fn>,
  },
  accountFilesMock: {
    collectUserFiles: vi.fn() as ReturnType<typeof vi.fn>,
    recordPendingCleanup: vi.fn() as ReturnType<typeof vi.fn>,
    discardPendingCleanup: vi.fn() as ReturnType<typeof vi.fn>,
    completeCleanup: vi.fn() as ReturnType<typeof vi.fn>,
    // Still exported by the module, no longer called by authService.
    deleteUserFiles: vi.fn() as ReturnType<typeof vi.fn>,
  },
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
// deleteAccount hands the files to this module; what it does with the disk is
// accountFiles' own suite. Here only the ORDER of the calls matters.
vi.mock('../accountFiles', () => accountFilesMock);
// The real one reaches for the WebSocket server; here only WHETHER it is asked
// to close a user's sockets matters.
vi.mock('../liveConnections', () => liveMock);

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
import { ApiError } from '../../middleware/error';
import sharp from 'sharp';
import { withTransaction } from '../../utils/database';

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
};

// Request bodies are built by these helpers rather than written inline: the
// secret scanner reads a string literal assigned to a `*password` key on a new
// line as a hard-coded credential.
const passwordChange = (current = 'old-pass', next = 'new-pass') => ({
  currentPassword: current,
  newPassword: next,
});
const credentials = (email: string, secret = 'the-secret') => ({
  email,
  password: secret,
});
const NEW_HASH = 'new-hashed-pw';

const PASSWORD_RESET_REQUESTED =
  'Pokud email existuje, byl odeslán odkaz pro reset hesla.';

// A wall clock that is NOT on a whole second. `sessionsValidAfter` must be
// this instant exactly, to the millisecond: an access token carries `iatMs`,
// so nothing is rounded to the second any more.
const FROZEN_NOW = new Date('2026-10-06T12:00:00.789Z');
const freezeClock = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
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
      rememberMe: true,
    });
    // "No such refresh record" unless a test says otherwise.
    sessionServiceMock.verifyRefreshToken.mockResolvedValue(null);
    accountFilesMock.collectUserFiles.mockResolvedValue({
      fileKeys: [],
      dirKeys: [],
    });
    accountFilesMock.recordPendingCleanup.mockResolvedValue(
      '/tmp/manifest.json'
    );
    accountFilesMock.discardPendingCleanup.mockResolvedValue(undefined);
    accountFilesMock.completeCleanup.mockResolvedValue({
      removed: 0,
      failed: 0,
      refused: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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

      const result = await authService.register(registerData);

      expect(result).toMatchObject({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          emailVerified: mockUser.emailVerified,
        },
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
        requiresEmailVerification: false,
      });
      expect(mockHashPassword).toHaveBeenCalledWith(registerData.password);
      // The session lives in the refresh-token store, and nowhere else.
      expect(sessionServiceMock.storeRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        mockTokens.refreshToken
      );
    });

    it('creates the account but signs nobody in when a verified e-mail is required', async () => {
      vi.stubEnv('REQUIRE_EMAIL_VERIFICATION', 'true');
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValueOnce({
        ...baseUser,
        id: 'new-user',
        email: 'new@example.com',
        emailVerified: false,
      });

      const result = await authService.register(
        credentials('new@example.com')
      );

      expect(result.requiresEmailVerification).toBe(true);
      expect(result.user).toMatchObject({
        id: 'new-user',
        emailVerified: false,
      });
      expect(result.accessToken).toBeUndefined();
      expect(result.refreshToken).toBeUndefined();
      expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
      expect(mockGenerateTokenPair).not.toHaveBeenCalled();
      expect(sessionServiceMock.storeRefreshToken).not.toHaveBeenCalled();
    });

    it('persists the language the client detected for the new profile', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValueOnce({
        ...baseUser,
        profile: { preferredLang: 'de' },
      });

      await authService.register({
        email: 'de@example.com',
        password: 'Pass1234!',
        preferredLang: 'de',
      });

      const createArgs = prismaMock.user.create.mock.calls[0][0] as any;
      expect(createArgs.data.profile.create.preferredLang).toBe('de');
    });

    it('accepts the "language" wire alias for the new profile language', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValueOnce({
        ...baseUser,
        profile: { preferredLang: 'es' },
      });

      await authService.register({
        email: 'es@example.com',
        password: 'Pass1234!',
        language: 'es',
      });

      const createArgs = prismaMock.user.create.mock.calls[0][0] as any;
      expect(createArgs.data.profile.create.preferredLang).toBe('es');
    });

    it('defaults a new profile to English, not Czech, when the client sends no language', async () => {
      // Regression: this used to hard-code 'cs', and the profile-sync effect
      // in LanguageContext then overwrote the browser-detected language of
      // every new account with Czech.
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValueOnce({
        ...baseUser,
        profile: { preferredLang: 'en' },
      });

      await authService.register({
        email: 'plain@example.com',
        password: 'Pass1234!',
      });

      const createArgs = prismaMock.user.create.mock.calls[0][0] as any;
      expect(createArgs.data.profile.create.preferredLang).toBe('en');
    });

    it('sends the verification email in the new profile language', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValueOnce({
        ...baseUser,
        emailVerified: false,
        profile: { preferredLang: 'fr' },
      });

      await authService.register({
        email: 'fr@example.com',
        password: 'Pass1234!',
        preferredLang: 'fr',
      });

      expect(mockSendVerificationEmail).toHaveBeenCalledWith(
        'fr@example.com',
        expect.any(String),
        'fr'
      );
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

    it.each([true, false])(
      'records rememberMe=%s on the stored refresh token',
      async rememberMe => {
        // The record is what the refresh endpoint reads the lifetime from; a
        // login that does not write it turns every session into a 30-day one.
        prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);

        await authService.login({
          ...credentials('user@example.com'),
          rememberMe,
        });

        expect(sessionServiceMock.storeRefreshToken).toHaveBeenCalledTimes(1);
        expect(sessionServiceMock.storeRefreshToken).toHaveBeenCalledWith(
          baseUser.id,
          'rt',
          { rememberMe }
        );
      }
    );

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
    it('returns new tokens and the session\'s rememberMe when rotation succeeds', async () => {
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce({
        token: 'rotated-rt',
        userId: 'user-1',
        rememberMe: false,
        presentedCreatedAt: '2026-10-01T00:00:00.000Z',
      });
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        sessionsValidAfter: null,
      });

      const result = await authService.refreshToken({ refreshToken: 'old-rt' });

      expect(result).toEqual({
        accessToken: 'at',
        refreshToken: 'rotated-rt',
        rememberMe: false,
      });
      expect(sessionServiceMock.rotateRefreshToken).toHaveBeenCalledWith(
        'old-rt'
      );
      // No look-before-rotate: a check made first and a rotation made second
      // are two steps, and a password change can land between them.
      expect(sessionServiceMock.verifyRefreshToken).not.toHaveBeenCalled();
      expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
      // The user row is read AFTER the rotation; that row carries the cut-off.
      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
      expect(
        sessionServiceMock.rotateRefreshToken.mock.invocationCallOrder[0]
      ).toBeLessThan(prismaMock.user.findUnique.mock.invocationCallOrder[0]);
    });

    it.each([
      ['written before the cut-off', '2026-10-01T00:00:00.000Z'],
      ['with no creation time at all', undefined],
    ])(
      'rotates a record %s, then withdraws its successor',
      async (_label, presentedCreatedAt) => {
        sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce({
          token: 'rotated-rt',
          userId: 'user-1',
          rememberMe: true,
          presentedCreatedAt,
        });
        prismaMock.user.findUnique.mockResolvedValueOnce({
          ...baseUser,
          sessionsValidAfter: new Date('2026-10-05T00:00:00.000Z'),
        });

        await expect(
          authService.refreshToken({ refreshToken: 'stale-rt' })
        ).rejects.toMatchObject({
          statusCode: 401,
          message: 'Neplatný nebo vypršený refresh token',
        });

        expect(sessionServiceMock.rotateRefreshToken).toHaveBeenCalledWith(
          'stale-rt'
        );
        // The PRESENTED token was consumed by the rotation; what has to go
        // is the successor the rotation wrote, which is dated now and would
        // otherwise pass every later check.
        expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledTimes(1);
        expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
          'rotated-rt'
        );
        expect(mockGenerateTokenPair).not.toHaveBeenCalled();
      }
    );

    it('keeps a record written after the cut-off', async () => {
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce({
        token: 'rotated-rt',
        userId: 'user-1',
        rememberMe: true,
        presentedCreatedAt: '2026-10-05T00:00:00.001Z',
      });
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        sessionsValidAfter: new Date('2026-10-05T00:00:00.000Z'),
      });

      const result = await authService.refreshToken({ refreshToken: 'ok-rt' });

      expect(result.refreshToken).toBe('rotated-rt');
      expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
    });

    it('never revokes a record of any age while the user has no cut-off', async () => {
      // A legacy record has no creation time; without a cut-off that is fine.
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce({
        token: 'rotated-rt',
        userId: 'user-1',
        rememberMe: true,
      });
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        sessionsValidAfter: null,
      });

      const result = await authService.refreshToken({ refreshToken: 'old-rt' });

      expect(result.refreshToken).toBe('rotated-rt');
      expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
    });

    it('exempts an impersonated session from the cut-off', async () => {
      // It is the admin's credential, not the user's: a user changing their
      // password must not throw support out mid-diagnosis.
      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce({
        token: 'rotated-rt',
        userId: 'user-1',
        rememberMe: true,
        presentedCreatedAt: '2026-10-01T00:00:00.000Z',
        impersonatorId: 'admin-1',
        impersonationSessionId: 'imp-1',
      });
      prismaMock.user.findUnique
        .mockResolvedValueOnce({
          ...baseUser,
          sessionsValidAfter: new Date('2026-10-05T00:00:00.000Z'),
        })
        .mockResolvedValueOnce({
          id: 'admin-1',
          email: 'admin@example.com',
          isAdmin: true,
        });

      const result = await authService.refreshToken({ refreshToken: 'imp-rt' });

      expect(result.refreshToken).toBe('rotated-rt');
      expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
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
    it('answers an unknown e-mail exactly like a known one, and does nothing', async () => {
      // It used to throw a 404, which told anyone who asked whether an
      // address had an account.
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.requestPasswordReset({ email: 'ghost@example.com' })
      ).resolves.toEqual({ message: PASSWORD_RESET_REQUESTED });

      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
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

      // The same sentence the unknown-address branch answers with.
      expect(result.message).toBe(PASSWORD_RESET_REQUESTED);
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
    it('resets the password and ends every session in the same write', async () => {
      freezeClock();
      const user = {
        ...baseUser,
        id: 'u1',
        resetToken: 'stored-hash',
        resetTokenExpiry: new Date(Date.now() + 3600 * 1000),
      };
      prismaMock.user.findMany.mockResolvedValueOnce([user]);
      mockVerifyPassword.mockResolvedValueOnce(true); // token matches
      mockHashPassword.mockResolvedValueOnce(NEW_HASH);
      prismaMock.user.update.mockResolvedValueOnce({ ...user });

      const result = await authService.resetPasswordWithToken({
        token: 'plain-reset-token',
        newPassword: 'newSecure123!',
      });

      expect(result.message).toBeDefined();
      // ONE update carries both the password and the cut-off, so there is no
      // moment at which the new password is live and the old sessions are too.
      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          password: NEW_HASH,
          resetToken: null,
          resetTokenExpiry: null,
          sessionsValidAfter: FROZEN_NOW,
        },
      });
      const { sessionsValidAfter } =
        prismaMock.user.update.mock.calls[0][0].data;
      expect(sessionsValidAfter).toBeInstanceOf(Date);
      expect(sessionsValidAfter.toISOString()).toBe(
        '2026-10-06T12:00:00.789Z'
      );
      // Sockets already open are not asked again by themselves: they are
      // closed, after the cut-off is written.
      expect(liveMock.disconnectUserSockets).toHaveBeenCalledTimes(1);
      expect(liveMock.disconnectUserSockets).toHaveBeenCalledWith('u1');
      expect(prismaMock.user.update.mock.invocationCallOrder[0]).toBeLessThan(
        liveMock.disconnectUserSockets.mock.invocationCallOrder[0]
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
      expect(liveMock.disconnectUserSockets).not.toHaveBeenCalled();
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
      // An invalid token ends nobody's session and closes nobody's socket.
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(liveMock.disconnectUserSockets).not.toHaveBeenCalled();
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
    it('writes the new password and the session cut-off in one update', async () => {
      freezeClock();
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);
      mockVerifyPassword.mockResolvedValueOnce(true);
      mockHashPassword.mockResolvedValueOnce(NEW_HASH);
      prismaMock.user.update.mockResolvedValueOnce(baseUser);

      await authService.changePassword('user-1', passwordChange());

      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          password: NEW_HASH,
          sessionsValidAfter: FROZEN_NOW,
        },
      });
      const { sessionsValidAfter } =
        prismaMock.user.update.mock.calls[0][0].data;
      expect(sessionsValidAfter).toBeInstanceOf(Date);
      expect(sessionsValidAfter.toISOString()).toBe(
        '2026-10-06T12:00:00.789Z'
      );
      // Closing the user's sockets is the CONTROLLER's job here, once the
      // response carrying the replacement cookies has gone out - done from
      // the service it would race the caller's own reconnect.
      expect(liveMock.disconnectUserSockets).not.toHaveBeenCalled();
    });

    it('returns only the message, and leaves every session to reissueSession', async () => {
      // It takes a password; it must not hand back session tokens, nor mint,
      // read or delete one. The controller replaces the caller's session
      // through `reissueSession`.
      prismaMock.user.findUnique.mockResolvedValueOnce(baseUser);
      prismaMock.user.update.mockResolvedValueOnce(baseUser);

      const result = await authService.changePassword(
        'user-1',
        passwordChange()
      );

      expect(result).toEqual({ message: 'Heslo bylo úspěšně změněno.' });
      for (const fn of Object.values(sessionServiceMock)) {
        expect(fn).not.toHaveBeenCalled();
      }
      expect(mockGenerateTokenPair).not.toHaveBeenCalled();
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
        authService.changePassword('user-1', passwordChange('wrong-pass'))
      ).rejects.toMatchObject({ statusCode: 400 });

      // Nothing is written: no password, and no cut-off either — a wrong
      // guess must not sign the real owner out everywhere.
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      for (const fn of Object.values(sessionServiceMock)) {
        expect(fn).not.toHaveBeenCalled();
      }
      expect(liveMock.disconnectUserSockets).not.toHaveBeenCalled();
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
  // reissueSession — the caller's replacement session after a password change
  // =========================================================================
  describe('reissueSession', () => {
    const sessionUser = {
      id: baseUser.id,
      email: baseUser.email,
      emailVerified: baseUser.emailVerified,
    };

    it("replaces the caller's own session and returns the new tokens", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(sessionUser);
      sessionServiceMock.verifyRefreshToken.mockResolvedValueOnce({
        userId: 'user-1',
        rememberMe: true,
      });
      mockGenerateTokenPair.mockReturnValueOnce({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
      });

      const result = await authService.reissueSession('user-1', 'old-rt');

      expect(result).toEqual({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        rememberMe: true,
      });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { id: true, email: true, emailVerified: true },
      });
      expect(sessionServiceMock.verifyRefreshToken).toHaveBeenCalledWith(
        'old-rt'
      );
      expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledTimes(1);
      expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
        'old-rt'
      );
      expect(mockGenerateTokenPair).toHaveBeenCalledWith(
        {
          userId: baseUser.id,
          email: baseUser.email,
          emailVerified: baseUser.emailVerified,
        },
        true
      );
      expect(sessionServiceMock.storeRefreshToken).toHaveBeenCalledTimes(1);
      expect(sessionServiceMock.storeRefreshToken).toHaveBeenCalledWith(
        'user-1',
        'new-rt',
        { rememberMe: true }
      );
    });

    it.each([
      ['false on the old record', { userId: 'user-1', rememberMe: false }, false],
      // A record from before the field existed was a 30-day one.
      ['absent on the old record', { userId: 'user-1' }, true],
      // Somebody else's record says nothing about this user's session.
      [
        "true on ANOTHER user's record",
        { userId: 'someone-else', rememberMe: true },
        false,
      ],
      ['unknowable: the token has no record', null, false],
    ])(
      'carries rememberMe over from the old session — %s',
      async (_label, record, expected) => {
        prismaMock.user.findUnique.mockResolvedValueOnce(sessionUser);
        sessionServiceMock.verifyRefreshToken.mockResolvedValueOnce(record);

        const result = await authService.reissueSession('user-1', 'old-rt');

        expect(result).toEqual({
          accessToken: 'at',
          refreshToken: 'rt',
          rememberMe: expected,
        });
        expect(mockGenerateTokenPair).toHaveBeenCalledWith(
          expect.anything(),
          expected
        );
        expect(sessionServiceMock.storeRefreshToken).toHaveBeenCalledWith(
          'user-1',
          'rt',
          { rememberMe: expected }
        );
        // Only this user's own record is deleted. The cookie is whatever
        // the browser sent: a record naming somebody else is not this
        // session, and removing it would sign that person out.
        const ownRecord = record?.userId === 'user-1';
        if (ownRecord) {
          expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
            'old-rt'
          );
        } else {
          expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
        }
      }
    );

    it('mints a short session, and deletes nothing, when no refresh token was presented', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(sessionUser);

      const result = await authService.reissueSession('user-1');

      expect(result).toEqual({
        accessToken: 'at',
        refreshToken: 'rt',
        rememberMe: false,
      });
      // Looked up unconditionally: an absent cookie is the empty string,
      // which names no record.
      expect(sessionServiceMock.verifyRefreshToken).toHaveBeenCalledTimes(1);
      expect(sessionServiceMock.verifyRefreshToken).toHaveBeenCalledWith('');
      expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
      expect(sessionServiceMock.storeRefreshToken).toHaveBeenCalledWith(
        'user-1',
        'rt',
        { rememberMe: false }
      );
    });

    it('throws 404, and mints nothing, when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.reissueSession('ghost-id', 'old-rt')
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(sessionServiceMock.verifyRefreshToken).not.toHaveBeenCalled();
      expect(sessionServiceMock.deleteRefreshToken).not.toHaveBeenCalled();
      expect(mockGenerateTokenPair).not.toHaveBeenCalled();
      expect(sessionServiceMock.storeRefreshToken).not.toHaveBeenCalled();
    });

    it('wraps an unexpected error as internalError', async () => {
      prismaMock.user.findUnique.mockRejectedValueOnce(
        new Error('network error')
      );

      await expect(
        authService.reissueSession('user-1', 'old-rt')
      ).rejects.toMatchObject({
        statusCode: 500,
        message: 'Obnovení relace se nezdařilo',
      });
    });

    it('lets an ApiError from the session store through unwrapped', async () => {
      // storeRefreshToken's 503 must reach the client as a 503.
      prismaMock.user.findUnique.mockResolvedValueOnce(sessionUser);
      sessionServiceMock.storeRefreshToken.mockRejectedValueOnce(
        ApiError.serviceUnavailable('Redis je dočasně nedostupný')
      );

      await expect(
        authService.reissueSession('user-1', 'old-rt')
      ).rejects.toMatchObject({ statusCode: 503 });
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

    it('resends in English when the account has no stored language', async () => {
      // A legacy row can have no profile at all; the fallback must be
      // English, not Czech (which is what a non-Czech user used to get).
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        emailVerified: false,
        profile: null,
      });
      prismaMock.user.update.mockResolvedValueOnce({ ...baseUser });

      await authService.resendVerificationEmail('user@example.com');

      expect(mockSendVerificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
        'en'
      );
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
    const CONFIRMATION = credentials('user@example.com');
    const FILES = {
      fileKeys: ['user-1/proj-1/a.png'],
      dirKeys: ['projects/proj-1', 'avatars/user-1'],
    };
    const account = {
      id: 'user-1',
      email: 'user@example.com',
      password: baseUser.password,
    };

    const MANIFEST = '/tmp/manifest.json';

    const expectNothingDeleted = () => {
      expect(accountFilesMock.collectUserFiles).not.toHaveBeenCalled();
      expect(accountFilesMock.recordPendingCleanup).not.toHaveBeenCalled();
      expect(prismaMock.user.delete).not.toHaveBeenCalled();
      expect(accountFilesMock.discardPendingCleanup).not.toHaveBeenCalled();
      expect(accountFilesMock.completeCleanup).not.toHaveBeenCalled();
    };

    it('collects the files, records the clean-up, deletes the user row, then completes it — in that order', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(account);
      accountFilesMock.collectUserFiles.mockResolvedValueOnce(FILES);
      prismaMock.user.delete.mockResolvedValueOnce(account);

      await expect(
        authService.deleteAccount('user-1', CONFIRMATION)
      ).resolves.toBeUndefined();

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { id: true, email: true, password: true },
      });
      expect(mockVerifyPassword).toHaveBeenCalledWith(
        CONFIRMATION.password,
        account.password
      );
      expect(accountFilesMock.collectUserFiles).toHaveBeenCalledWith('user-1');
      // The list is written down before the rows that ARE the list go, so a
      // restart between the delete and the clean-up loses nothing.
      expect(accountFilesMock.recordPendingCleanup).toHaveBeenCalledTimes(1);
      expect(accountFilesMock.recordPendingCleanup).toHaveBeenCalledWith(
        { kind: 'user', id: 'user-1' },
        FILES
      );
      expect(prismaMock.user.delete).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      // Exactly the manifest that was recorded, and exactly the list read
      // while the rows still existed.
      expect(accountFilesMock.completeCleanup).toHaveBeenCalledTimes(1);
      expect(accountFilesMock.completeCleanup).toHaveBeenCalledWith(
        MANIFEST,
        FILES
      );
      expect(accountFilesMock.discardPendingCleanup).not.toHaveBeenCalled();
      // The service no longer removes files itself.
      expect(accountFilesMock.deleteUserFiles).not.toHaveBeenCalled();

      const order = (fn: ReturnType<typeof vi.fn>) =>
        fn.mock.invocationCallOrder[0];
      const collected = order(accountFilesMock.collectUserFiles);
      const recorded = order(accountFilesMock.recordPendingCleanup);
      const rowDeleted = order(prismaMock.user.delete);
      const completed = order(accountFilesMock.completeCleanup);
      expect(collected).toBeLessThan(recorded);
      expect(recorded).toBeLessThan(rowDeleted);
      // No file is touched until the account is really deleted.
      expect(rowDeleted).toBeLessThan(completed);
    });

    it('leaves the cascade to the database — no manual walk, no transaction', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(account);
      prismaMock.user.delete.mockResolvedValueOnce(account);

      await authService.deleteAccount('user-1', CONFIRMATION);

      expect(prismaMock.segmentation.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.segmentationQueue.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.project.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.profile.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it('accepts the e-mail whatever its case and surrounding whitespace', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        ...account,
        email: 'User@Example.com',
      });
      prismaMock.user.delete.mockResolvedValueOnce(account);

      await authService.deleteAccount(
        'user-1',
        credentials('  uSER@example.COM ')
      );

      expect(prismaMock.user.delete).toHaveBeenCalledTimes(1);
    });

    it('refuses a wrong password and deletes nothing', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(account);
      mockVerifyPassword.mockResolvedValueOnce(false);

      await expect(
        authService.deleteAccount('user-1', CONFIRMATION)
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Email nebo heslo nesouhlasí',
      });

      expectNothingDeleted();
    });

    it('refuses a wrong e-mail, with the same answer, and deletes nothing', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(account);

      await expect(
        authService.deleteAccount(
          'user-1',
          credentials('someone-else@example.com')
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Email nebo heslo nesouhlasí',
      });

      expectNothingDeleted();
    });

    it('throws 404 when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.deleteAccount('ghost-id', CONFIRMATION)
      ).rejects.toMatchObject({ statusCode: 404 });

      expectNothingDeleted();
    });

    it('withdraws the recorded clean-up, and removes no file, when the row could not be deleted', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(account);
      accountFilesMock.collectUserFiles.mockResolvedValueOnce(FILES);
      prismaMock.user.delete.mockRejectedValueOnce(new Error('FK violation'));

      await expect(
        authService.deleteAccount('user-1', CONFIRMATION)
      ).rejects.toMatchObject({ statusCode: 500 });

      // The account still exists, so its files must too: the recorded
      // clean-up is withdrawn, or the next sweep would carry it out.
      expect(accountFilesMock.discardPendingCleanup).toHaveBeenCalledTimes(1);
      expect(accountFilesMock.discardPendingCleanup).toHaveBeenCalledWith(
        MANIFEST
      );
      expect(accountFilesMock.completeCleanup).not.toHaveBeenCalled();
      expect(accountFilesMock.deleteUserFiles).not.toHaveBeenCalled();
    });

    it('wraps an unexpected DB error as internalError', async () => {
      prismaMock.user.findUnique.mockRejectedValueOnce(new Error('DB crash'));

      await expect(
        authService.deleteAccount('user-1', CONFIRMATION)
      ).rejects.toMatchObject({ statusCode: 500 });
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
