import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import { authenticate } from '../../middleware/auth';
import { apiLimiter, authLimiter } from '../../middleware/rateLimiter';
import { validateBody, validateParams } from '../../middleware/validation';
import { z } from 'zod';

const router = Router();

/**
 * User Management Routes - User profile, settings, and account management
 */

// All user routes require authentication
router.use(authenticate);

// User profile schema for validation
const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  email: z.string().email().optional(),
  language: z.enum(['en', 'cs', 'es', 'de', 'fr', 'zh']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  notifications: z.object({
    email: z.boolean().optional(),
    push: z.boolean().optional(),
    segmentationComplete: z.boolean().optional(),
    projectShared: z.boolean().optional()
  }).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
  confirmPassword: z.string().min(6)
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

router.get('/profile',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      logger.info(`👤 User: Fetching profile for user ${userId}`);
      
      // Placeholder user profile
      const profile = {
        id: userId,
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        isEmailVerified: true,
        language: 'en',
        theme: 'light',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        settings: {
          notifications: {
            email: true,
            push: false,
            segmentationComplete: true,
            projectShared: true
          }
        },
        stats: {
          totalProjects: 5,
          totalImages: 23,
          totalSegmentations: 18,
          storageUsed: '45.2MB'
        }
      };

      res.json({
        success: true,
        data: profile,
        message: 'User profile retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ User: Error fetching profile:', error);
      next(error);
    }
  }
);

router.put('/profile',
  apiLimiter,
  validateBody(updateProfileSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const updates = req.body;
      
      logger.info(`✏️ User: Updating profile for user ${userId}`, { updates });
      
      // Placeholder profile update
      res.json({
        success: true,
        data: { userId, updates },
        message: 'Profile updated successfully'
      });
    } catch (error) {
      logger.error('❌ User: Error updating profile:', error);
      next(error);
    }
  }
);

router.post('/change-password',
  authLimiter,
  validateBody(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      logger.info(`🔐 User: Password change requested for user ${userId}`);
      
      // Placeholder password change
      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      logger.error('❌ User: Error changing password:', error);
      next(error);
    }
  }
);

router.get('/settings',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      logger.info(`⚙️ User: Fetching settings for user ${userId}`);
      
      // Placeholder user settings
      const settings = {
        language: 'en',
        theme: 'light',
        notifications: {
          email: true,
          push: false,
          segmentationComplete: true,
          projectShared: true
        },
        privacy: {
          showProfile: false,
          allowProjectSharing: true
        },
        preferences: {
          defaultModel: 'hrnetv2',
          autoSaveInterval: 30,
          showTutorials: true
        }
      };

      res.json({
        success: true,
        data: settings,
        message: 'User settings retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ User: Error fetching settings:', error);
      next(error);
    }
  }
);

router.get('/storage-stats',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      logger.info(`💾 User: Fetching storage stats for user ${userId}`);
      
      // Placeholder storage statistics
      const storageStats = {
        totalUsed: '45.2MB',
        totalUsedBytes: 47394816,
        breakdown: {
          images: '38.1MB',
          thumbnails: '5.8MB',
          exports: '1.3MB'
        },
        quota: '1GB',
        quotaBytes: 1073741824,
        usagePercentage: 4.4
      };

      res.json({
        success: true,
        data: storageStats,
        message: 'Storage statistics retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ User: Error fetching storage stats:', error);
      next(error);
    }
  }
);

router.get('/activity',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const { limit = '10', offset = '0' } = req.query;
      
      logger.info(`📊 User: Fetching activity for user ${userId}`);
      
      // Placeholder user activity
      const activity = {
        items: [
          {
            id: 1,
            type: 'project_created',
            description: 'Created project "Cell Analysis Study"',
            timestamp: new Date().toISOString()
          },
          {
            id: 2,
            type: 'image_uploaded',
            description: 'Uploaded 3 images to project "Cell Study"',
            timestamp: new Date(Date.now() - 3600000).toISOString()
          },
          {
            id: 3,
            type: 'segmentation_completed',
            description: 'Completed segmentation with HRNetV2 model',
            timestamp: new Date(Date.now() - 7200000).toISOString()
          }
        ],
        pagination: {
          total: 25,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          hasMore: true
        }
      };

      res.json({
        success: true,
        data: activity,
        message: 'User activity retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ User: Error fetching activity:', error);
      next(error);
    }
  }
);

router.delete('/account',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      logger.warn(`🗑️ User: Account deletion requested for user ${userId}`);
      
      // Placeholder account deletion (should be implemented with proper safeguards)
      res.json({
        success: true,
        message: 'Account deletion initiated. You will receive a confirmation email.'
      });
    } catch (error) {
      logger.error('❌ User: Error deleting account:', error);
      next(error);
    }
  }
);

export default router;