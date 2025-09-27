import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Create a comprehensive prisma mock first
const prismaMock = {
  user: {
    findUnique: jest.fn() as any,
    findFirst: jest.fn() as any,
    create: jest.fn() as any,
    update: jest.fn() as any,
    delete: jest.fn() as any,
  },
  profile: {
    findUnique: jest.fn() as any,
    upsert: jest.fn() as any,
    create: jest.fn() as any,
    update: jest.fn() as any,
  },
  session: {
    findUnique: jest.fn() as any,
    create: jest.fn() as any,
    update: jest.fn() as any,
    updateMany: jest.fn() as any,
    delete: jest.fn() as any,
  },
};

// Mock dependencies
jest.mock('../../db', () => ({
  prisma: prismaMock,
}));
jest.mock('../../auth/password');
jest.mock('../../auth/jwt');
jest.mock('../../utils/logger');
jest.mock('../../services/emailService');

import * as authService from '../authService';
import { hashPassword, verifyPassword } from '../../auth/password';
import { generateTokenPair } from '../../auth/jwt';

const mockHashPassword = hashPassword as ReturnType<typeof jest.fn>;
const mockVerifyPassword = verifyPassword as ReturnType<typeof jest.fn>;
const mockGenerateTokenPair = generateTokenPair as ReturnType<typeof jest.fn>;

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
        },
      };

      const mockTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      // Mock implementations
      prismaMock.user.findUnique.mockResolvedValueOnce(null); // User doesn't exist
      prismaMock.profile.findUnique.mockResolvedValueOnce(null); // Username available
      mockHashPassword.mockResolvedValueOnce(hashedPassword);
      prismaMock.user.create.mockResolvedValueOnce(mockUser as any);
      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      mockGenerateTokenPair.mockReturnValueOnce(mockTokens);
      prismaMock.session.create.mockResolvedValueOnce({} as any);

      const result = await authService.register(registerData);

      expect(result).toEqual({
        message: 'User successfully registered and logged in.',
        user: {
          id: mockUser.id,
          email: mockUser.email,
          username: mockUser.profile.username,
          emailVerified: mockUser.emailVerified,
        },
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
      });

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { email: registerData.email },
      });
      expect(mockHashPassword).toHaveBeenCalledWith(registerData.password);
      expect(prismaMock.user.create).toHaveBeenCalled();
      expect(prismaMock.session.create).toHaveBeenCalled();
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

      await expect(authService.register(registerData)).rejects.toThrow(
        'A user with this email already exists'
      );
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

      await expect(authService.register(registerData)).rejects.toThrow(
        'Username already exists'
      );
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
      prismaMock.session.create.mockResolvedValueOnce({} as any);

      const result = await authService.login(loginData);

      expect(result).toEqual({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          emailVerified: mockUser.emailVerified,
          profile: mockUser.profile,
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
      expect(mockGenerateTokenPair).toHaveBeenCalledWith(
        {
          userId: mockUser.id,
          email: mockUser.email,
          emailVerified: mockUser.emailVerified,
        },
        true // rememberMe
      );
      expect(prismaMock.session.create).toHaveBeenCalled();
    });

    it('should throw error if user not found', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(authService.login(loginData)).rejects.toThrow(
        'Invalid login credentials'
      );
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

      await expect(authService.login(loginData)).rejects.toThrow(
        'Invalid login credentials'
      );
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      const refreshTokenData = {
        refreshToken: 'valid-refresh-token',
      };

      const mockSession = {
        id: 'session-id',
        userId: 'user-id',
        refreshToken: refreshTokenData.refreshToken,
        isValid: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        rememberMe: true,
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

      prismaMock.session.findUnique.mockResolvedValueOnce(mockSession as any);
      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      mockGenerateTokenPair.mockReturnValueOnce(newTokens);
      prismaMock.session.update.mockResolvedValueOnce({} as any);

      const result = await authService.refreshToken(refreshTokenData);

      expect(result).toEqual(newTokens);
      expect(prismaMock.session.findUnique).toHaveBeenCalledWith({
        where: { refreshToken: refreshTokenData.refreshToken },
      });
      expect(prismaMock.session.update).toHaveBeenCalledWith({
        where: { id: mockSession.id },
        data: {
          refreshToken: newTokens.refreshToken,
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should throw error if session not found', async () => {
      const refreshTokenData = {
        refreshToken: 'invalid-refresh-token',
      };

      prismaMock.session.findUnique.mockResolvedValueOnce(null);

      await expect(authService.refreshToken(refreshTokenData)).rejects.toThrow(
        'Invalid or expired refresh token'
      );
    });

    it('should throw error if session is expired', async () => {
      const refreshTokenData = {
        refreshToken: 'expired-refresh-token',
      };

      const expiredSession = {
        id: 'session-id',
        userId: 'user-id',
        refreshToken: refreshTokenData.refreshToken,
        isValid: true,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
        rememberMe: false,
      };

      prismaMock.session.findUnique.mockResolvedValueOnce(
        expiredSession as any
      );

      await expect(authService.refreshToken(refreshTokenData)).rejects.toThrow(
        'Invalid or expired refresh token'
      );
    });

    it('should throw error if session is invalid', async () => {
      const refreshTokenData = {
        refreshToken: 'invalid-session-token',
      };

      const invalidSession = {
        id: 'session-id',
        userId: 'user-id',
        refreshToken: refreshTokenData.refreshToken,
        isValid: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rememberMe: false,
      };

      prismaMock.session.findUnique.mockResolvedValueOnce(
        invalidSession as any
      );

      await expect(authService.refreshToken(refreshTokenData)).rejects.toThrow(
        'Invalid or expired refresh token'
      );
    });
  });

  describe('logout', () => {
    it('should logout successfully', async () => {
      const refreshToken = 'valid-refresh-token';

      prismaMock.session.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(authService.logout(refreshToken)).resolves.toBeUndefined();

      expect(prismaMock.session.updateMany).toHaveBeenCalledWith({
        where: { refreshToken },
        data: { isValid: false },
      });
    });

    it('should handle logout error gracefully', async () => {
      const refreshToken = 'valid-refresh-token';
      const specificError = new Error('Database connection failed');

      prismaMock.session.updateMany.mockRejectedValueOnce(specificError);

      await expect(authService.logout(refreshToken)).rejects.toThrow(
        'Logout failed'
      );
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

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        include: { profile: true },
      });
      expect(prismaMock.profile.upsert).toHaveBeenCalledWith({
        where: { userId },
        update: expect.objectContaining({
          username: profileData.username,
          bio: profileData.bio,
          preferredModel: profileData.preferredModel,
          consentToMLTraining: profileData.consentToMLTraining,
          consentUpdatedAt: expect.any(Date),
        }),
        create: expect.objectContaining({
          userId,
          username: profileData.username,
          bio: profileData.bio,
          preferredModel: profileData.preferredModel,
          consentToMLTraining: profileData.consentToMLTraining,
          consentUpdatedAt: expect.any(Date),
        }),
      });
    });

    it('should throw error if user not found', async () => {
      const userId = 'nonexistent-user';
      const profileData = { bio: 'New bio' };

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.updateProfile(userId, profileData)
      ).rejects.toThrow('User not found');
    });
  });

  describe('deleteAccount', () => {
    it('should delete account successfully', async () => {
      const userId = 'user-id';

      const mockUser = {
        id: userId,
        email: 'test@example.com',
      };

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      prismaMock.user.delete.mockResolvedValueOnce(mockUser as any);

      await expect(authService.deleteAccount(userId)).resolves.toBeUndefined();

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(prismaMock.user.delete).toHaveBeenCalledWith({
        where: { id: userId },
      });
    });

    it('should throw error if user not found', async () => {
      const userId = 'nonexistent-user';

      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(authService.deleteAccount(userId)).rejects.toThrow(
        'User not found'
      );
    });
  });
});
