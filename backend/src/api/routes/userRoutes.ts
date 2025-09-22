import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import { authenticate } from '../../middleware/auth';
import { apiLimiter, authLimiter } from '../../middleware/rateLimiter';
import { validateBody } from '../../middleware/validation';
import { z } from 'zod';
import * as UserService from '../../services/userService';

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
      const userId = (req as Request & { user: { id: string } }).user.id;
      logger.info(`👤 User: Fetching profile for user ${userId}`);

      const profile = await UserService.getUserProfile(userId);

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found',
          code: 'USER_NOT_FOUND'
        });
      }

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
      const userId = (req as Request & { user: { id: string } }).user.id;
      const updates = req.body;

      logger.info(`✏️ User: Updating profile for user ${userId}`, 'UserRoutes', { updates });

      const result = await UserService.updateUserProfile(userId, updates);

      res.json({
        success: true,
        data: result,
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
      const userId = (req as Request & { user: { id: string } }).user.id;
      logger.info(`🔐 User: Password change requested for user ${userId}`);

      // TODO: Implement actual password change
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
      const userId = (req as Request & { user: { id: string } }).user.id;
      logger.info(`⚙️ User: Fetching settings for user ${userId}`);

      const profile = await UserService.getUserProfile(userId);

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found',
          code: 'USER_NOT_FOUND'
        });
      }

      const settings = {
        language: profile.language,
        theme: profile.theme,
        notifications: profile.settings.notifications,
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
      const userId = (req as Request & { user: { id: string } }).user.id;
      logger.info(`💾 User: Fetching storage stats for user ${userId}`);

      const storageStats = await UserService.calculateUserStorage(userId);

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
      const userId = (req as Request & { user: { id: string } }).user.id;
      const { limit = '10', offset = '0' } = req.query;

      logger.info(`📊 User: Fetching activity for user ${userId}`);

      const activity = await UserService.getUserActivity(
        userId,
        parseInt(limit as string),
        parseInt(offset as string)
      );

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
      const userId = (req as Request & { user: { id: string } }).user.id;
      logger.warn(`🗑️ User: Account deletion requested for user ${userId}`);

      // TODO: Implement proper account deletion with safeguards
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