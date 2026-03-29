import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock config early to prevent process.exit(1) during module load chain
jest.mock('../../utils/config', () => ({
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

// Create a comprehensive prisma mock first
const prismaMock = {
  user: {
    findUnique: jest.fn() as any,
    findFirst: jest.fn() as any,
    create: jest.fn() as any,
    update: jest.fn() as any,
    delete: jest.fn() as any,
    deleteMany: jest.fn() as any,
  },
  profile: {
    findUnique: jest.fn() as any,
    upsert: jest.fn() as any,
    create: jest.fn() as any,
    update: jest.fn() as any,
    deleteMany: jest.fn() as any,
  },
  session: {
    findUnique: jest.fn() as any,
    create: jest.fn() as any,
    update: jest.fn() as any,
    updateMany: jest.fn() as any,
    delete: jest.fn() as any,
    deleteMany: jest.fn() as any,
  },
  project: {
    findMany: jest.fn() as any,
    deleteMany: jest.fn() as any,
  },
  image: {
    deleteMany: jest.fn() as any,
  },
  segmentation: {
    deleteMany: jest.fn() as any,
  },
  segmentationQueue: {
    deleteMany: jest.fn() as any,
  },
  $transaction: jest.fn() as any,
};

// Mock sessionService to avoid Redis dependency
const sessionServiceMock = {
  storeRefreshToken: jest.fn() as any,
  createSession: jest.fn() as any,
  rotateRefreshToken: jest.fn() as any,
  verifyRefreshToken: jest.fn() as any,
  deleteRefreshToken: jest.fn() as any,
};

// Mock withTransaction to just call the callback with the prisma client passed in
jest.mock('../../utils/database', () => ({
  withTransaction: jest.fn().mockImplementation(
    async (prismaClient: any, callback: any) => callback(prismaClient)
  ),
}));

// Mock dependencies
jest.mock('../../db', () => ({
  prisma: prismaMock,
}));
jest.mock('../../auth/password');
jest.mock('../../auth/jwt');
jest.mock('../../utils/logger');
jest.mock('../../services/emailService');
jest.mock('../../services/sessionService', () => ({
  sessionService: sessionServiceMock,
}));
jest.mock('../../storage/index', () => ({
  getStorageProvider: jest.fn(),
}));
jest.mock('sharp', () => jest.fn());

import * as authService from '../authService';
import { hashPassword, verifyPassword } from '../../auth/password';
import { generateTokenPair } from '../../auth/jwt';
import { withTransaction } from '../../utils/database';
import * as EmailService from '../../services/emailService';

const mockHashPassword = hashPassword as ReturnType<typeof jest.fn>;
const mockVerifyPassword = verifyPassword as ReturnType<typeof jest.fn>;
const mockGenerateTokenPair = generateTokenPair as ReturnType<typeof jest.fn>;
const mockWithTransaction = withTransaction as ReturnType<typeof jest.fn>;
const mockSendVerificationEmail =
  EmailService.sendVerificationEmail as ReturnType<typeof jest.fn>;

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore withTransaction implementation after jest.clearAllMocks()
    mockWithTransaction.mockImplementation(
      async (prismaClient: any, callback: any) => callback(prismaClient)
    );
    // Set up emailService mock to return promises (avoids .then() on undefined)
    mockSendVerificationEmail.mockResolvedValue(undefined);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const registerData = {
        email: 'test@example.com',
        password: 'password123',
        username: 'testuser',
      };

      const hashedPassword = 'hashedPassword123';
      const mockUser = {
        id: 'user-id',
        email: registerData.email,
        password: hashedPassword,
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

      // Mock implementations
      prismaMock.user.findUnique.mockResolvedValue(null); // User doesn't exist (use mockResolvedValue not Once)
      prismaMock.profile.findUnique.mockResolvedValue(null); // Username available
      mockHashPassword.mockResolvedValue(hashedPassword);
      prismaMock.user.create.mockResolvedValue(mockUser as any);
      mockGenerateTokenPair.mockReturnValue(mockTokens);
      prismaMock.session.create.mockResolvedValue({} as any);

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

    it('should throw error if user already exists', async () => {
      const registerData = {
        email: 'existing@example.com',
        password: 'password123',
      };

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        email: registerData.email,
      } as any);

      await expect(authService.register(registerData)).rejects.toThrow();
    });

    it('should throw error if username is taken', async () => {
      const registerData = {
        email: 'test@example.com',
        password: 'password123',
        username: 'takenusername',
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(null); // User doesn't exist
      prismaMock.profile.findUnique.mockResolvedValueOnce({
        id: 'profile-id',
        username: 'takenusername',
      } as any); // Username taken

      await expect(authService.register(registerData)).rejects.toThrow();
    });
  });

  describe('login', () => {
    it('should login user successfully', async () => {
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
        profile: {
          id: 'profile-id',
          username: 'testuser',
        },
      };

      const mockTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      mockVerifyPassword.mockResolvedValueOnce(true);
      mockGenerateTokenPair.mockReturnValueOnce(mockTokens);
      sessionServiceMock.storeRefreshToken.mockResolvedValueOnce(undefined);
      sessionServiceMock.createSession.mockResolvedValueOnce('session-id');

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

    it('should throw error if user not found', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(authService.login(loginData)).rejects.toThrow();
    });

    it('should throw error if password is invalid', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      const mockUser = {
        id: 'user-id',
        email: loginData.email,
        password: 'hashedPassword',
        profile: null,
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      mockVerifyPassword.mockResolvedValueOnce(false);

      await expect(authService.login(loginData)).rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      const refreshTokenData = {
        refreshToken: 'valid-refresh-token',
      };

      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        emailVerified: true,
      };

      const newTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce(
        'new-refresh-token'
      );
      sessionServiceMock.verifyRefreshToken.mockResolvedValueOnce({
        userId: 'user-id',
      });
      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      mockGenerateTokenPair.mockReturnValueOnce(newTokens);

      const result = await authService.refreshToken(refreshTokenData);

      expect(result).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: 'new-refresh-token',
      });
    });

    it('should throw error if session not found', async () => {
      const refreshTokenData = {
        refreshToken: 'invalid-refresh-token',
      };

      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce(null);

      await expect(
        authService.refreshToken(refreshTokenData)
      ).rejects.toThrow();
    });

    it('should throw error if session is expired', async () => {
      const refreshTokenData = {
        refreshToken: 'expired-refresh-token',
      };

      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce(null);

      await expect(
        authService.refreshToken(refreshTokenData)
      ).rejects.toThrow();
    });

    it('should throw error if session is invalid', async () => {
      const refreshTokenData = {
        refreshToken: 'invalid-session-token',
      };

      sessionServiceMock.rotateRefreshToken.mockResolvedValueOnce(null);

      await expect(
        authService.refreshToken(refreshTokenData)
      ).rejects.toThrow();
    });
  });

  describe('logout', () => {
    it('should logout successfully', async () => {
      const refreshToken = 'valid-refresh-token';

      sessionServiceMock.deleteRefreshToken.mockResolvedValueOnce(true);

      await expect(authService.logout(refreshToken)).resolves.toBeUndefined();

      expect(sessionServiceMock.deleteRefreshToken).toHaveBeenCalledWith(
        refreshToken
      );
    });

    it('should handle logout error gracefully', async () => {
      const refreshToken = 'valid-refresh-token';
      const specificError = new Error('Redis connection failed');

      sessionServiceMock.deleteRefreshToken.mockRejectedValueOnce(specificError);

      await expect(authService.logout(refreshToken)).rejects.toThrow();
    });
  });

  describe('updateProfile', () => {
    it('should update profile successfully', async () => {
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

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      prismaMock.profile.upsert.mockResolvedValueOnce(updatedProfile as any);

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

    it('should throw error if user not found', async () => {
      const userId = 'nonexistent-user';
      const profileData = { bio: 'New bio' };

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.updateProfile(userId, profileData)
      ).rejects.toThrow();
    });
  });

  describe('deleteAccount', () => {
    it('should delete account successfully', async () => {
      const userId = 'user-id';

      const mockUser = {
        id: userId,
        email: 'test@example.com',
        projects: [],
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      prismaMock.session.deleteMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.project.deleteMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.profile.deleteMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.user.delete.mockResolvedValueOnce(mockUser as any);

      await expect(authService.deleteAccount(userId)).resolves.toBeUndefined();

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        include: expect.any(Object),
      });
    });

    it('should throw error if user not found', async () => {
      const userId = 'nonexistent-user';

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(authService.deleteAccount(userId)).rejects.toThrow();
    });
  });
});
