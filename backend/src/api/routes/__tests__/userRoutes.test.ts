import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  jest,
  afterEach,
} from '@jest/globals';
import userRoutes from '../userRoutes';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';

// Mock config and jwt early to prevent process.exit during module loading
jest.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    FROM_EMAIL: 'test@example.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));
jest.mock('../../../auth/jwt');

// Mock dependencies
jest.mock('../../../middleware/auth');
jest.mock('../../../middleware/rateLimiter', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../../middleware/validation', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  validateParams: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../../utils/logger');
jest.mock('../../../services/userService');
jest.mock('../../../db');

import * as UserService from '../../../services/userService';

const mockedAuthenticate = authenticate as jest.MockedFunction<
  typeof authenticate
>;
const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedUserService = UserService as jest.Mocked<typeof UserService>;

const mockUser = {
  id: 'user-id-123',
  email: 'test@example.com',
  emailVerified: true,
};

const mockProfile: UserService.UserProfile = {
  id: 'user-id-123',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isEmailVerified: true,
  language: 'en',
  theme: 'light',
  avatarUrl: null,
  createdAt: new Date().toISOString(),
  settings: {
    notifications: {
      email: true,
      push: false,
      segmentationComplete: true,
      projectShared: true,
    },
  },
  stats: {
    totalProjects: 3,
    totalImages: 12,
    totalSegmentations: 8,
    storageUsed: '45MB',
    storageUsedBytes: 47185920,
    imagesUploadedToday: 1,
    processedImages: 8,
  },
};

const mockStorageStats: UserService.StorageStats = {
  totalUsed: '45MB',
  totalUsedBytes: 47185920,
  breakdown: {
    images: '40MB',
    thumbnails: '3MB',
    exports: '2MB',
  },
  quota: '1GB',
  quotaBytes: 1073741824,
  usagePercentage: 4.4,
};

describe('User Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    jest.clearAllMocks();

    mockedLogger.info = jest.fn() as any;
    mockedLogger.error = jest.fn() as any;
    mockedLogger.warn = jest.fn() as any;

    mockedAuthenticate.mockImplementation(
      ((req: any, _res: any, next: any) => {
        req.user = mockUser;
        next();
      }) as any
    );

    app.use('/api/users', userRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe('GET /api/users/profile', () => {
    it('should return user profile when authenticated', async () => {
      (mockedUserService.getUserProfile as any) = jest
        .fn<any>()
        .mockResolvedValue(mockProfile);

      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe('test@example.com');
      expect(mockedAuthenticate).toHaveBeenCalled();
      expect(mockedUserService.getUserProfile).toHaveBeenCalledWith(mockUser.id);
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      const response = await request(app)
        .get('/api/users/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 when user profile is not found', async () => {
      (mockedUserService.getUserProfile as any) = jest
        .fn<any>()
        .mockResolvedValue(null);

      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', 'Bearer valid-token')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });

    it('should log profile fetch attempt', async () => {
      (mockedUserService.getUserProfile as any) = jest
        .fn<any>()
        .mockResolvedValue(mockProfile);

      await request(app)
        .get('/api/users/profile')
        .set('Authorization', 'Bearer valid-token');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Fetching profile for user')
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /api/users/profile', () => {
    it('should update profile with valid body', async () => {
      const updatedProfile = { ...mockProfile, firstName: 'Updated' };
      (mockedUserService.updateUserProfile as any) = jest
        .fn<any>()
        .mockResolvedValue(updatedProfile);

      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', 'Bearer valid-token')
        .send({ firstName: 'Updated' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockedUserService.updateUserProfile).toHaveBeenCalledWith(
        mockUser.id,
        { firstName: 'Updated' }
      );
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app)
        .put('/api/users/profile')
        .send({ firstName: 'Updated' })
        .expect(401);
    });

    it('should propagate service errors as 500', async () => {
      (mockedUserService.updateUserProfile as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('DB write error'));

      await request(app)
        .put('/api/users/profile')
        .set('Authorization', 'Bearer valid-token')
        .send({ firstName: 'Updated' })
        .expect(500);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/users/change-password', () => {
    it('should change password when authenticated with valid body', async () => {
      const response = await request(app)
        .post('/api/users/change-password')
        .set('Authorization', 'Bearer valid-token')
        .send({
          currentPassword: 'OldPass1!',
          newPassword: 'NewPass1!',
          confirmPassword: 'NewPass1!',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Password changed successfully');
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app)
        .post('/api/users/change-password')
        .send({
          currentPassword: 'old',
          newPassword: 'NewPass1!',
          confirmPassword: 'NewPass1!',
        })
        .expect(401);
    });

    it('should log password change request', async () => {
      await request(app)
        .post('/api/users/change-password')
        .set('Authorization', 'Bearer valid-token')
        .send({
          currentPassword: 'old',
          newPassword: 'NewPass1!',
          confirmPassword: 'NewPass1!',
        });

      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Password change requested for user')
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /api/users/account', () => {
    it('should initiate account deletion when authenticated', async () => {
      const response = await request(app)
        .delete('/api/users/account')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Account deletion initiated');
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).delete('/api/users/account').expect(401);
    });

    it('should log a warning for account deletion', async () => {
      await request(app)
        .delete('/api/users/account')
        .set('Authorization', 'Bearer valid-token');

      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Account deletion requested for user')
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/users/settings', () => {
    it('should return user settings when authenticated', async () => {
      (mockedUserService.getUserProfile as any) = jest
        .fn<any>()
        .mockResolvedValue(mockProfile);

      const response = await request(app)
        .get('/api/users/settings')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('language');
      expect(response.body.data).toHaveProperty('theme');
      expect(response.body.data).toHaveProperty('notifications');
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).get('/api/users/settings').expect(401);
    });

    it('should return 404 when profile not found', async () => {
      (mockedUserService.getUserProfile as any) = jest
        .fn<any>()
        .mockResolvedValue(null);

      const response = await request(app)
        .get('/api/users/settings')
        .set('Authorization', 'Bearer valid-token')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/users/storage-stats', () => {
    it('should return storage statistics when authenticated', async () => {
      (mockedUserService.calculateUserStorage as any) = jest
        .fn<any>()
        .mockResolvedValue(mockStorageStats);

      const response = await request(app)
        .get('/api/users/storage-stats')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalUsed).toBe('45MB');
      expect(mockedUserService.calculateUserStorage).toHaveBeenCalledWith(
        mockUser.id
      );
    });

    it('should return 401 when not authenticated', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res
            .status(401)
            .json({ success: false, message: 'Chybí autentizační token' });
        }) as any
      );

      await request(app).get('/api/users/storage-stats').expect(401);
    });

    it('should handle storage calculation errors', async () => {
      (mockedUserService.calculateUserStorage as any) = jest
        .fn<any>()
        .mockRejectedValue(new Error('Storage calculation failed'));

      await request(app)
        .get('/api/users/storage-stats')
        .set('Authorization', 'Bearer valid-token')
        .expect(500);

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error fetching storage stats'),
        expect.anything()
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/users/activity', () => {
    it('should return user activity when authenticated', async () => {
      (mockedUserService.getUserActivity as any) = jest
        .fn<any>()
        .mockResolvedValue({ events: [], total: 0 });

      const response = await request(app)
        .get('/api/users/activity')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should accept limit and offset query params', async () => {
      (mockedUserService.getUserActivity as any) = jest
        .fn<any>()
        .mockResolvedValue({ events: [], total: 0 });

      await request(app)
        .get('/api/users/activity?limit=5&offset=10')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(mockedUserService.getUserActivity).toHaveBeenCalledWith(
        mockUser.id,
        5,
        10
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('Authentication Boundary — all user routes require auth', () => {
    it('should block every user route when authenticate middleware fails', async () => {
      mockedAuthenticate.mockImplementation(
        ((_req: any, res: any) => {
          res.status(401).json({ success: false, message: 'Unauthorized' });
        }) as any
      );

      const routes = [
        { method: 'get', path: '/api/users/profile' },
        { method: 'put', path: '/api/users/profile' },
        { method: 'get', path: '/api/users/settings' },
        { method: 'get', path: '/api/users/storage-stats' },
        { method: 'delete', path: '/api/users/account' },
      ];

      for (const route of routes) {
        const res = await (request(app) as any)[route.method](route.path);
        expect(res.status).toBe(401);
      }
    });
  });
});
