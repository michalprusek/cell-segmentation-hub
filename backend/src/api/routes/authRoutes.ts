import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate } from '../../middleware/auth';
import { validateBody, validateParams } from '../../middleware/validation';
import { uploadSingleImage, handleUploadError } from '../../middleware/upload';
import {
  authLimiter,
  passwordResetLimiter,
} from '../../middleware/rateLimiter';
// apiLimiter unused - available for future use
import {
  loginSchema,
  registerSchema,
  resetPasswordRequestSchema,
  resetPasswordConfirmSchema,
  changePasswordSchema,
  refreshTokenSchema,
  resendVerificationSchema,
  updateProfileSchema,
} from '../../auth/validation';
import { z } from 'zod';

const router = Router();

// Public routes
router.post(
  '/register',
  authLimiter, // Rate limiting for registration
  validateBody(registerSchema),
  authController.register
);

router.post(
  '/login',
  authLimiter, // Rate limiting for login attempts
  validateBody(loginSchema),
  authController.login
);

router.post(
  '/refresh-token',
  validateBody(refreshTokenSchema),
  authController.refreshToken
);

// Alias for backward compatibility. The frontend used to call /auth/refresh
// while the canonical path has always been /auth/refresh-token. The stale
// URL silently 401'd because it fell through to `router.use(authenticate)`
// below, which saw the already-expired access token on the refresh request
// and rejected it — meaning every real session-expiry forced a full logout.
// Keep this alias forever so any cached frontend bundle or third-party
// client still works after the URL was canonicalised.
router.post(
  '/refresh',
  validateBody(refreshTokenSchema),
  authController.refreshToken
);

router.post(
  '/logout',
  authenticate, // Logout requires authentication
  authController.logout
);

// Note: Validation happens inside controller instead of middleware
// This allows custom error handling to return 404 for unregistered emails
// instead of generic 400 validation error
router.post(
  '/request-password-reset',
  passwordResetLimiter, // Strict rate limiting for password reset
  authController.requestPasswordReset
);

// Alias for backward compatibility
router.post(
  '/forgot-password',
  passwordResetLimiter, // Strict rate limiting for password reset
  authController.requestPasswordReset
);

router.post(
  '/reset-password',
  passwordResetLimiter, // Strict rate limiting for password reset
  validateBody(resetPasswordConfirmSchema),
  authController.resetPasswordWithToken
);

router.get(
  '/verify-email/:token',
  validateParams(z.object({ token: z.string() })),
  authController.verifyEmail
);

router.post(
  '/resend-verification',
  validateBody(resendVerificationSchema),
  authController.resendVerificationEmail
);

// Protected routes (require authentication)
router.use(authenticate);

router.get('/check', authController.checkAuth);

router.get('/profile', authController.getProfile);

router.put(
  '/profile',
  validateBody(updateProfileSchema),
  authController.updateProfile
);

router.get('/storage-stats', authController.getStorageStats);

router.post(
  '/change-password',
  validateBody(changePasswordSchema),
  authController.changePassword
);

router.post(
  '/avatar',
  uploadSingleImage,
  handleUploadError,
  authController.uploadAvatar
);

export default router;
