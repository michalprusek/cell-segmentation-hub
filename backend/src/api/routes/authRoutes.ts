import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate } from '../../middleware/auth';
import { validateBody, validateParams } from '../../middleware/validation';
import {
  loginSchema,
  registerSchema,
  resetPasswordRequestSchema,
  resetPasswordConfirmSchema,
  changePasswordSchema,
  refreshTokenSchema,
  resendVerificationSchema,
  updateProfileSchema
} from '../../auth/validation';
import { z } from 'zod';

const router = Router();

// Public routes
router.post('/register', 
  validateBody(registerSchema),
  authController.register
);

router.post('/login',
  validateBody(loginSchema), 
  authController.login
);

router.post('/refresh-token',
  validateBody(refreshTokenSchema),
  authController.refreshToken
);

router.post('/logout',
  authController.logout
);

router.post('/request-password-reset',
  validateBody(resetPasswordRequestSchema),
  authController.requestPasswordReset
);

router.post('/confirm-password-reset',
  validateBody(resetPasswordConfirmSchema),
  authController.confirmPasswordReset
);

router.get('/verify-email/:token',
  validateParams(z.object({ token: z.string() })),
  authController.verifyEmail
);

router.post('/resend-verification',
  validateBody(resendVerificationSchema),
  authController.resendVerificationEmail
);

// Protected routes (require authentication)
router.use(authenticate);

router.get('/profile',
  authController.getProfile
);

router.put('/profile',
  validateBody(updateProfileSchema),
  authController.updateProfile
);

router.delete('/profile',
  authController.deleteAccount
);

router.get('/check',
  authController.checkAuth
);

router.get('/storage-stats',
  authController.getUserStorageStats
);

router.post('/change-password',
  validateBody(changePasswordSchema),
  authController.changePassword
);

export default router;