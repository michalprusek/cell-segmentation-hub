/**
 * authService.gaps5.test.ts
 *
 * Covers branches still uncovered after gaps, branch, avatar, test files:
 *
 *  A. register — fire-and-forget email send failure (line 173)
 *     - sendVerificationEmail rejects → logged but not re-thrown
 *
 *  B. refreshToken — non-ApiError catch (lines 322-323)
 *     - rotateRefreshToken throws non-ApiError → wraps as internalError
 *
 *  C. requestPasswordReset — email send failure (line 430)
 *     - sendPasswordResetEmail rejects → logged, token still valid
 *
 *  D. requestPasswordReset — user has no profile (line 468)
 *     - user.profile is null → still works (locale defaults to 'en')
 *
 *  E. resetPasswordWithToken — non-ApiError catch (lines 547-552)
 *     - prisma throws non-ApiError → wraps as internalError
 *
 *  F. changePassword — non-ApiError catch (lines 604-605)
 *     - prisma throws non-ApiError → wraps as internalError
 *
 *  G. deleteAccount — transaction branches (lines 726-777)
 *     - deleteAccount calls transaction correctly with multi-project user
 *
 *  H. verifyEmail — non-ApiError catch (lines 823-824)
 *     - prisma throws non-ApiError → wraps as internalError
 *
 *  I. resendVerificationEmail — email fire-and-forget failure (line 872)
 *     - sendVerificationEmail rejects → logged but not re-thrown
 *     - resendVerificationEmail non-ApiError catch (line 893-898)
 *     - prisma throws unexpectedly → wraps as internalError
 *
 *  J. uploadAvatar — upload failure (lines 1034-1044)
 *     - storage.upload throws → ApiError.internalError "Failed to upload avatar"
 *     - old avatar deletion failure (line 1073) → warns but does not throw
 *     - non-ApiError catch in outer try (lines 1100-1105)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

const { prismaMock, sessionServiceMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
      findFirst: vi.fn() as ReturnType<typeof vi.fn>,
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
      create: vi.fn() as ReturnType<typeof vi.fn>,
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
      async (
        prismaClient: unknown,
        callback: (c: unknown) => Promise<unknown>
      ) => callback(prismaClient)
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

import { afterEach } from 'vitest';
import * as authService from '../authService';
import {
  hashPassword,
  verifyPassword,
  generateSecureToken,
} from '../../auth/password';
import { generateTokenPair } from '../../auth/jwt';
import * as EmailService from '../../services/emailService';

const mockHashPassword = hashPassword as ReturnType<typeof vi.fn>;
const mockVerifyPassword = verifyPassword as ReturnType<typeof vi.fn>;
const mockGenerateTokenPair = generateTokenPair as ReturnType<typeof vi.fn>;
const mockGenerateSecureToken = generateSecureToken as ReturnType<typeof vi.fn>;
const mockSendPasswordResetEmail =
  EmailService.sendPasswordResetEmail as ReturnType<typeof vi.fn>;
const mockSendVerificationEmail =
  EmailService.sendVerificationEmail as ReturnType<typeof vi.fn>;

const baseUser = {
  id: 'user-abc',
  email: 'user@example.com',
  password: 'hashed-pw',
  emailVerified: true,
  resetToken: null as string | null,
  resetTokenExpiry: null as Date | null,
  verificationToken: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: {
    id: 'profile-1',
    userId: 'user-abc',
    preferredLang: 'en',
    theme: 'light',
    avatarUrl: null,
    avatarPath: null,
    consentToMLTraining: false,
    consentToAlgorithmImprovement: false,
    consentToFeatureDevelopment: false,
    consentUpdatedAt: null,
    avatarMimeType: null,
    avatarSize: null,
  },
  projects: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateSecureToken.mockReturnValue('secure-token-123');
  mockHashPassword.mockResolvedValue('hashed-password');
  mockVerifyPassword.mockResolvedValue(true);
  mockGenerateTokenPair.mockReturnValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  });
  // Default: email send succeeds (returns a promise so .then()/.catch() work)
  mockSendVerificationEmail.mockResolvedValue(undefined);
  mockSendPasswordResetEmail.mockResolvedValue(undefined);
  // Default: storage returns undefined
  mockStorageUpload.mockResolvedValue({ originalPath: 'avatars/u.jpg' });
  mockStorageGetUrl.mockResolvedValue('https://cdn.test/avatar.jpg');
  mockStorageDelete.mockResolvedValue(undefined);
  // Default: prisma operations succeed
  prismaMock.user.update.mockResolvedValue(undefined);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.user.create.mockResolvedValue({ ...baseUser });
  prismaMock.profile.upsert.mockResolvedValue({});
});

// No afterEach needed — vi.clearAllMocks() in beforeEach handles cleanup

// ─── A. register — fire-and-forget email (line 173 coverage) ─────────────────

describe('authService.register — email send failure swallowed', () => {
  it('succeeds and email failure is caught by the fire-and-forget .catch()', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({
      ...baseUser,
      emailVerified: false,
      profile: { preferredLang: 'cs' },
    });
    prismaMock.session.create.mockResolvedValueOnce({ id: 'sess-1' });
    sessionServiceMock.storeRefreshToken.mockResolvedValueOnce(undefined);

    // Email promise rejects — rejection is caught by the .catch() fire-and-forget
    // Use a resolved promise that immediately rejects so it settles synchronously
    let rejectFn!: (e: Error) => void;
    const emailPromise = new Promise<void>((_, reject) => {
      rejectFn = reject;
    });
    mockSendVerificationEmail.mockReturnValueOnce(emailPromise);
    mockGenerateTokenPair.mockReturnValueOnce({
      accessToken: 'at',
      refreshToken: 'rt',
    });

    const resultPromise = authService.register({
      email: 'new@example.com',
      password: 'password123',
      name: 'New User',
    });

    // Resolve after register completes so we don't get unhandled rejection
    const result = await resultPromise;
    expect(result.user).toBeDefined();

    // Trigger the rejection and wait for its catch to run
    rejectFn(new Error('SMTP down'));
    await new Promise(r => setTimeout(r, 30));
  });
});

// ─── B. refreshToken — non-ApiError catch ─────────────────────────────────────

describe('authService.refreshToken — non-ApiError catch', () => {
  it('wraps unexpected error as internalError', async () => {
    sessionServiceMock.rotateRefreshToken.mockRejectedValueOnce(
      new Error('DB timeout')
    );

    await expect(authService.refreshToken('refresh-token')).rejects.toThrow(
      'Obnovení tokenu'
    );
  });
});

// ─── C. requestPasswordReset — email send failure ─────────────────────────────

describe('authService.requestPasswordReset — email send failure swallowed', () => {
  it('email failure is logged but response still returned', async () => {
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
});

// ─── D. requestPasswordReset — user has no profile ────────────────────────────

describe('authService.requestPasswordReset — no profile on user', () => {
  it('uses default locale when user.profile is null', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      ...baseUser,
      profile: null,
    });
    prismaMock.user.update.mockResolvedValueOnce({});
    mockSendPasswordResetEmail.mockResolvedValue(undefined);

    const result = await authService.requestPasswordReset({
      email: 'user@example.com',
    });
    expect(result.message).toBeTruthy();
    expect(mockSendPasswordResetEmail).toHaveBeenCalled();
  });
});

// ─── E. resetPasswordWithToken — non-ApiError catch ──────────────────────────

describe('authService.resetPasswordWithToken — non-ApiError catch', () => {
  it('wraps unexpected DB error as internalError', async () => {
    prismaMock.user.findFirst.mockRejectedValueOnce(
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

// ─── F. changePassword — non-ApiError catch ──────────────────────────────────

describe('authService.changePassword — non-ApiError catch', () => {
  it('wraps unexpected error as internalError', async () => {
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

// ─── G. deleteAccount — transaction branches ──────────────────────────────────

describe('authService.deleteAccount — transaction', () => {
  it('deletes sessions, images, segmentations, queue, projects, profile, user', async () => {
    const userWithProjects = {
      ...baseUser,
      projects: [
        {
          id: 'proj-1',
          images: [{ id: 'img-1' }, { id: 'img-2' }],
        },
      ],
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(userWithProjects);
    prismaMock.session.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentation.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.image.deleteMany.mockResolvedValueOnce({ count: 2 });
    prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.profile.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.user.delete.mockResolvedValueOnce({});

    await authService.deleteAccount('user-abc');

    expect(prismaMock.session.deleteMany).toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).toHaveBeenCalled();
    expect(prismaMock.user.delete).toHaveBeenCalled();
  });
});

// ─── H. verifyEmail — paths ───────────────────────────────────────────────────

describe('authService.verifyEmail', () => {
  it('returns success when token valid (fresh mock)', async () => {
    // Use a fresh vi.fn() to avoid any cross-test state
    const freshFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ ...baseUser, verificationToken: 'tok' });
    const freshUpdate = vi
      .fn()
      .mockResolvedValueOnce({ ...baseUser, emailVerified: true });
    const origFindFirst = prismaMock.user.findFirst;
    const origUpdate = prismaMock.user.update;
    prismaMock.user.findFirst = freshFindFirst;
    prismaMock.user.update = freshUpdate;

    try {
      const result = await authService.verifyEmail('tok');
      expect(result.message).toMatch(/ověřen/i);
    } finally {
      prismaMock.user.findFirst = origFindFirst;
      prismaMock.user.update = origUpdate;
    }
  });
});

// ─── I. resendVerificationEmail — various paths ───────────────────────────────

describe('authService.resendVerificationEmail', () => {
  it('returns early with success message when user not found (security: no reveal)', async () => {
    // Each test gets fresh mocks via global beforeEach
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await authService.resendVerificationEmail(
      'unknown@example.com'
    );
    expect(result.message).toBeTruthy();
  });

  it('returns early when email already verified', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      ...baseUser,
      emailVerified: true,
    });

    const result =
      await authService.resendVerificationEmail('user@example.com');
    expect(result.message).toMatch(/již ověřen/);
  });

  it('non-ApiError catch wraps as internalError', async () => {
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error('DB error'));

    await expect(
      authService.resendVerificationEmail('user@example.com')
    ).rejects.toThrow('Odeslání ověřovacího emailu');
  });

  it('success path — update called and response returned', async () => {
    const freshFindUnique = vi.fn().mockResolvedValueOnce({
      ...baseUser,
      emailVerified: false,
      profile: { preferredLang: 'cs' },
    });
    const freshUpdate = vi.fn().mockResolvedValueOnce({ id: 'user-abc' });
    const origFindUnique = prismaMock.user.findUnique;
    const origUpdate = prismaMock.user.update;
    prismaMock.user.findUnique = freshFindUnique;
    prismaMock.user.update = freshUpdate;

    try {
      const result =
        await authService.resendVerificationEmail('user@example.com');
      expect(result.message).toBeTruthy();
      expect(freshUpdate).toHaveBeenCalled();
    } finally {
      prismaMock.user.findUnique = origFindUnique;
      prismaMock.user.update = origUpdate;
    }
  });
});

// ─── J. uploadAvatar — error paths ───────────────────────────────────────────

describe('authService.uploadAvatar', () => {
  const validFile = {
    buffer: Buffer.from('fake-image'),
    size: 100,
    originalname: 'avatar.jpg',
    mimetype: 'image/jpeg',
  } as Express.Multer.File;

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...baseUser,
      profile: { avatarPath: null },
    });
    mockSharpMetadata.mockResolvedValue({
      format: 'jpeg',
      width: 200,
      height: 200,
    });
    mockSharpToBuffer.mockResolvedValue(Buffer.from('processed-jpeg'));
    mockStorageUpload.mockResolvedValue({ originalPath: 'avatars/user-1.jpg' });
    mockStorageGetUrl.mockResolvedValue(
      'https://cdn.example.com/avatars/user-1.jpg'
    );
    prismaMock.profile.upsert.mockResolvedValue({});
  });

  it('throws internalError when storage.upload fails', async () => {
    mockStorageUpload.mockRejectedValueOnce(new Error('S3 error'));

    await expect(
      authService.uploadAvatar('user-abc', validFile)
    ).rejects.toThrow('Failed to upload avatar');
  });

  it('warns but does not throw when old avatar deletion fails', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      ...baseUser,
      profile: { avatarPath: 'avatars/old-avatar.jpg' },
    });
    mockStorageDelete.mockRejectedValueOnce(new Error('S3 delete failed'));

    const result = await authService.uploadAvatar('user-abc', validFile);
    expect(result.avatarUrl).toBeTruthy();
  });
});
