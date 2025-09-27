// Set up test environment before any imports
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET =
  'test-access-secret-for-testing-only-32-characters-long';
process.env.JWT_REFRESH_SECRET =
  'test-refresh-secret-for-testing-only-32-characters-long';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';

// Mock config before it's imported by other modules
jest.mock('../../utils/config', () => ({
  config: {
    jwt: {
      accessSecret: 'test-access-secret-for-testing-only-32-characters-long',
      refreshSecret: 'test-refresh-secret-for-testing-only-32-characters-long',
      accessExpiry: '15m',
      refreshExpiry: '7d',
    },
    storage: {
      type: 'local',
      uploadDir: './test-uploads',
      maxFileSize: 10485760,
    },
  },
}));

// Mock dependencies before imports
jest.mock('../../db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    profile: {
      upsert: jest.fn(),
    },
  },
}));
jest.mock('../../storage/index');
jest.mock('sharp', () => {
  return jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed-image')),
  }));
});
jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Now import modules after environment is set up
import { prisma } from '../../db';
import * as authService from '../authService';
import { ApiError } from '../../middleware/error';
import * as storageProvider from '../../storage/index';
import sharp from 'sharp';

describe('AuthService - Avatar Upload', () => {
  const mockUserId = 'test-user-id';
  const mockFile: Express.Multer.File = {
    fieldname: 'avatar',
    originalname: 'test-avatar.png',
    encoding: '7bit',
    mimetype: 'image/png',
    buffer: Buffer.from('fake-image-data'),
    size: 1024 * 100, // 100KB
    destination: '',
    filename: '',
    path: '',
    stream: null as any,
  };

  const mockUser = {
    id: mockUserId,
    email: 'test@example.com',
    password: 'hashed-password',
    emailVerified: true,
    verificationToken: null,
    resetToken: null,
    resetTokenExpiry: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    profile: {
      id: 'profile-id',
      userId: mockUserId,
      username: 'testuser',
      avatarUrl: null,
      avatarPath: null,
      avatarMimeType: null,
      avatarSize: null,
      bio: null,
      organization: null,
      location: null,
      title: null,
      publicProfile: false,
      preferredModel: 'model1',
      modelThreshold: 0.5,
      preferredLang: 'en',
      preferredTheme: 'light',
      emailNotifications: true,
      consentToMLTraining: true,
      consentToAlgorithmImprovement: true,
      consentToFeatureDevelopment: true,
      consentUpdatedAt: new Date(),
    },
  };

  const mockStorage = {
    upload: jest.fn(),
    getUrl: jest.fn(),
    delete: jest.fn(),
  };

  const mockSharpInstance = {
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (storageProvider.getStorageProvider as any).mockReturnValue(mockStorage);
    (sharp as any).mockImplementation(() => mockSharpInstance);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadAvatar', () => {
    it('should successfully upload and process an avatar', async () => {
      // Setup mocks
      const processedBuffer = Buffer.from('processed-image');

      // Override the global sharp mock for this test
      const mockSharpInstance = {
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(processedBuffer),
      };
      (sharp as any).mockImplementation(() => mockSharpInstance);

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);

      mockStorage.upload.mockResolvedValue({
        originalPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        thumbnailPath: null,
        url: 'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
      });

      mockStorage.getUrl.mockResolvedValue(
        'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg'
      );

      (prisma.profile.upsert as any).mockResolvedValue({
        ...mockUser.profile,
        avatarUrl:
          'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        avatarPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        avatarMimeType: 'image/jpeg',
        avatarSize: processedBuffer.length,
      });

      // Execute
      const result = await authService.uploadAvatar(mockUserId, mockFile);

      // Verify
      expect(result).toEqual({
        avatarUrl:
          'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        message: 'Avatar uploaded successfully',
      });

      // Verify Sharp was called correctly
      expect(sharp).toHaveBeenCalledWith(mockFile.buffer);
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(300, 300, {
        fit: 'cover',
        position: 'center',
      });
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({
        quality: 85,
        progressive: true,
      });

      // Verify storage upload was called with processed buffer
      expect(mockStorage.upload).toHaveBeenCalledWith(
        processedBuffer,
        'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        {
          mimeType: 'image/jpeg',
          originalName: 'test-avatar.png',
          maxSize: 5 * 1024 * 1024,
        }
      );

      // Verify database update
      expect(prisma.profile.upsert).toHaveBeenCalledWith({
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

    it('should delete old avatar when uploading new one', async () => {
      // Setup user with existing avatar
      const userWithAvatar = {
        ...mockUser,
        profile: {
          ...mockUser.profile,
          avatarPath: 'avatars/test-user-id/old-avatar.jpg',
        },
      };

      const processedBuffer = Buffer.from('processed-image');

      // Override the global sharp mock for this test
      const mockSharpInstance = {
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(processedBuffer),
      };
      (sharp as any).mockImplementation(() => mockSharpInstance);

      (prisma.user.findUnique as any).mockResolvedValue(userWithAvatar);

      mockStorage.upload.mockResolvedValue({
        originalPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        thumbnailPath: null,
        url: 'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
      });

      mockStorage.getUrl.mockResolvedValue(
        'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg'
      );
      mockStorage.delete.mockResolvedValue(undefined);

      (prisma.profile.upsert as any).mockResolvedValue({
        ...userWithAvatar.profile,
        avatarUrl:
          'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        avatarPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        avatarMimeType: 'image/jpeg',
        avatarSize: processedBuffer.length,
      });

      // Execute
      await authService.uploadAvatar(mockUserId, mockFile);

      // Verify old avatar was deleted
      expect(mockStorage.delete).toHaveBeenCalledWith(
        'avatars/test-user-id/old-avatar.jpg'
      );
    });

    it('should reject invalid file types', async () => {
      const invalidFile = {
        ...mockFile,
        mimetype: 'text/plain',
      };

      await expect(
        authService.uploadAvatar(mockUserId, invalidFile)
      ).rejects.toThrow(ApiError);
    });

    it('should reject files that are too large', async () => {
      const largeFile = {
        ...mockFile,
        size: 6 * 1024 * 1024, // 6MB (over 5MB limit)
      };

      await expect(
        authService.uploadAvatar(mockUserId, largeFile)
      ).rejects.toThrow(ApiError);
    });

    it('should handle user not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);

      await expect(
        authService.uploadAvatar(mockUserId, mockFile)
      ).rejects.toThrow(ApiError);
    });

    it('should handle image processing failure gracefully', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(mockUser);

      // Override the global sharp mock for this test to fail
      const failingSharpInstance = {
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest
          .fn()
          .mockRejectedValue(new Error('Image processing failed')),
      };
      (sharp as any).mockImplementation(() => failingSharpInstance);

      await expect(
        authService.uploadAvatar(mockUserId, mockFile)
      ).rejects.toThrow(ApiError);
    });

    it('should accept all supported image formats', async () => {
      const supportedFormats = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp',
        'image/bmp',
        'image/tiff',
        'image/tif',
      ];

      const processedBuffer = Buffer.from('processed-image');

      // Override the global sharp mock for this test
      const mockSharpInstance = {
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(processedBuffer),
      };
      (sharp as any).mockImplementation(() => mockSharpInstance);

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);

      mockStorage.upload.mockResolvedValue({
        originalPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        thumbnailPath: null,
        url: 'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
      });

      mockStorage.getUrl.mockResolvedValue(
        'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg'
      );

      (prisma.profile.upsert as any).mockResolvedValue({
        ...mockUser.profile,
        avatarUrl:
          'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        avatarPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        avatarMimeType: 'image/jpeg',
        avatarSize: processedBuffer.length,
      });

      for (const format of supportedFormats) {
        // Reset mocks before each iteration
        jest.clearAllMocks();

        const file = { ...mockFile, mimetype: format };

        const result = await authService.uploadAvatar(mockUserId, file);

        expect(result).toHaveProperty('avatarUrl');
        expect(result).toHaveProperty('message');
      }
    });

    it('should always convert images to JPEG format', async () => {
      const processedBuffer = Buffer.from('processed-image');

      // Override the global sharp mock for this test
      const mockSharpInstance = {
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(processedBuffer),
      };
      (sharp as any).mockImplementation(() => mockSharpInstance);

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);

      mockStorage.upload.mockResolvedValue({
        originalPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        thumbnailPath: null,
        url: 'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
      });

      mockStorage.getUrl.mockResolvedValue(
        'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg'
      );

      (prisma.profile.upsert as any).mockResolvedValue({
        ...mockUser.profile,
        avatarUrl:
          'http://localhost:3001/uploads/avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        avatarPath: 'avatars/test-user-id/avatar-test-user-id-mock-uuid.jpg',
        avatarMimeType: 'image/jpeg',
        avatarSize: processedBuffer.length,
      });

      const pngFile = { ...mockFile, mimetype: 'image/png' };
      await authService.uploadAvatar(mockUserId, pngFile);

      // Verify that the file is saved with .jpg extension
      expect(mockStorage.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/\.jpg$/),
        expect.objectContaining({
          mimeType: 'image/jpeg',
        })
      );

      // Verify database stores JPEG mime type
      expect(prisma.profile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            avatarMimeType: 'image/jpeg',
          }),
        })
      );
    });
  });
});
