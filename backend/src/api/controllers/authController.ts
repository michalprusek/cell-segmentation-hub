import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as AuthService from '../../services/authService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import { prisma } from '../../db';
import { logger } from '../../utils/logger';
import {
  loginSchema,
  registerSchema,
  resetPasswordRequestSchema,
  resetPasswordConfirmSchema
} from '../../auth/validation';
import type {
  LoginData,
  RegisterData,
  ResetPasswordRequestData,
  ResetPasswordConfirmData,
  ChangePasswordData,
  RefreshTokenData
} from '../../auth/validation';

/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Registrace nového uživatele
 *     description: Vytvoří nový uživatelský účet
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *             properties:
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: "Jan"
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: "Novák"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jan.novak@example.com"
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: "securePassword123"
 *     responses:
 *       201:
 *         description: Uživatel úspěšně registrován
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                 message:
 *                   type: string
 *                   example: "Uživatel úspěšně registrován"
 *       400:
 *         description: Nevalidní vstupní data
 *       409:
 *         description: Uživatel s tímto emailem již existuje
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  // Validate email and other fields using Zod schema
  const validationResult = registerSchema.safeParse(req.body);
  if (!validationResult.success) {
    const errors = validationResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
    const apiError = {
      code: 'VALIDATION_ERROR' as const,
      message: 'Validation failed',
      details: { errors }
    };
    return ResponseHelper.error(res, apiError, 400);
  }
  
  const data: RegisterData = validationResult.data;
  
  const result = await AuthService.register(data);
  
  return ResponseHelper.success(res, result, result.message, 201);
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Přihlášení uživatele
 *     description: Autentizuje uživatele a vrací JWT tokeny
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jan.novak@example.com"
 *               password:
 *                 type: string
 *                 example: "securePassword123"
 *               rememberMe:
 *                 type: boolean
 *                 example: true
 *                 description: "Keep user logged in for extended period"
 *     responses:
 *       200:
 *         description: Úspěšné přihlášení
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                 message:
 *                   type: string
 *                   example: "Přihlášení bylo úspěšné"
 *       400:
 *         description: Nevalidní vstupní data
 *       401:
 *         description: Neplatné přihlašovací údaje
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  // Validate email and password using Zod schema
  const validationResult = loginSchema.safeParse(req.body);
  if (!validationResult.success) {
    const errors = validationResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
    const apiError = {
      code: 'VALIDATION_ERROR' as const,
      message: 'Validation failed',
      details: { errors }
    };
    return ResponseHelper.error(res, apiError, 400);
  }
  
  const data: LoginData = validationResult.data;
  
  const result = await AuthService.login(data);
  
  return ResponseHelper.success(res, result, 'Přihlášení bylo úspěšné');
});

/**
 * Refresh access token
 */
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const data: RefreshTokenData = req.body;
  
  const result = await AuthService.refreshToken(data);
  
  return ResponseHelper.success(res, result, 'Token byl úspěšně obnoven');
});

/**
 * Logout user
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  
  if (refreshToken) {
    await AuthService.logout(refreshToken);
  }
  
  return ResponseHelper.success(res, null, 'Odhlášení bylo úspěšné');
});

/**
 * @swagger
 * /auth/request-password-reset:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Žádost o reset hesla
 *     description: Odešle reset token uživateli na email (token není vrácen v odpovědi)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jan.novak@example.com"
 *     responses:
 *       200:
 *         description: Žádost o reset hesla byla úspěšně zpracována
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: "Pokud email existuje, byl odeslán email s instrukcemi pro reset hesla."
 *                 message:
 *                   type: string
 *                   example: "Pokud email existuje, byl odeslán email s instrukcemi pro reset hesla."
 *       400:
 *         description: Nevalidní vstupní data
 */
export const requestPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  // Validate email using Zod schema
  const validationResult = resetPasswordRequestSchema.safeParse(req.body);
  if (!validationResult.success) {
    const errors = validationResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
    const apiError = {
      code: 'VALIDATION_ERROR' as const,
      message: 'Validation failed',
      details: { errors }
    };
    return ResponseHelper.error(res, apiError, 400);
  }
  
  const data: ResetPasswordRequestData = validationResult.data;
  
  const result = await AuthService.requestPasswordReset(data);
  
  return ResponseHelper.success(res, result, result.message);
});

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Reset hesla pomocí tokenu
 *     description: Resetuje heslo uživatele pomocí tokenu obdrženého emailem
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 description: Reset token obdržený emailem
 *                 example: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *                 description: Nové heslo pro uživatelský účet
 *                 example: "NewSecurePassword123!"
 *           examples:
 *             resetPassword:
 *               summary: Příklad požadavku na reset hesla
 *               value:
 *                 token: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
 *                 newPassword: "NewSecurePassword123!"
 *     responses:
 *       200:
 *         description: Heslo bylo úspěšně resetováno
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: "Heslo bylo úspěšně změněno."
 *                 message:
 *                   type: string
 *                   example: "Heslo bylo úspěšně změněno."
 *       400:
 *         description: Neplatný nebo expirovaný token
 *       404:
 *         description: Token nebyl nalezen
 */
export const resetPasswordWithToken = asyncHandler(async (req: Request, res: Response) => {
  // Validate token and new password using Zod schema
  const validationResult = resetPasswordConfirmSchema.safeParse(req.body);
  if (!validationResult.success) {
    const errors = validationResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
    const apiError = {
      code: 'VALIDATION_ERROR' as const,
      message: 'Validation failed',
      details: { errors }
    };
    return ResponseHelper.error(res, apiError, 400);
  }
  
  const data: ResetPasswordConfirmData = validationResult.data;
  
  const result = await AuthService.resetPasswordWithToken(data);
  
  return ResponseHelper.success(res, result, result.message);
});


/**
 * Change password (authenticated user)
 */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const data: ChangePasswordData = req.body;
  
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'User not authenticated');
  }
  
  const userId = req.user.id;
  const result = await AuthService.changePassword(userId, data);
  
  return ResponseHelper.success(res, result, result.message);
});

/**
 * Verify email
 */
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  
  if (!token) {
    return ResponseHelper.validationError(res, 'Token je vyžadován');
  }
  
  const result = await AuthService.verifyEmail(token);
  
  return ResponseHelper.success(res, result, result.message);
});

/**
 * Resend verification email
 */
export const resendVerificationEmail = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  
  const result = await AuthService.resendVerificationEmail(email);
  
  return ResponseHelper.success(res, result, result.message);
});

/**
 * Get current user profile
 */
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'User not authenticated');
  }
  
  const user = req.user;
  
  // Transform to frontend Profile format
  const profile = {
    id: user.id,
    email: user.email,
    username: user.profile?.username || null,
    organization: user.profile?.organization || null,
    bio: user.profile?.bio || null,
    avatarUrl: user.profile?.avatarUrl || null,
    location: user.profile?.location || null,
    title: user.profile?.title || null,
    publicProfile: user.profile?.publicProfile || false,
    preferredModel: user.profile?.preferredModel || 'hrnet',
    modelThreshold: user.profile?.modelThreshold || 0.5,
    preferredLang: user.profile?.preferredLang || 'cs',
    preferredTheme: user.profile?.preferredTheme || 'light',
    emailNotifications: user.profile?.emailNotifications || true,
    consentToMLTraining: user.profile?.consentToMLTraining || false,
    consentToAlgorithmImprovement: user.profile?.consentToAlgorithmImprovement || false,
    consentToFeatureDevelopment: user.profile?.consentToFeatureDevelopment || false,
    consentUpdatedAt: user.profile?.consentUpdatedAt?.toISOString() || null,
    createdAt: user.profile?.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: user.profile?.updatedAt?.toISOString() || new Date().toISOString(),
  };
  
  return ResponseHelper.success(res, profile, 'Profil uživatele');
});

/**
 * Update user profile
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'User not authenticated');
  }
  
  const user = req.user;
  const profileData = req.body;
  
  const updatedProfile = await AuthService.updateProfile(user.id, profileData);
  
  return ResponseHelper.success(res, updatedProfile, 'Profil byl úspěšně aktualizován');
});

/**
 * Delete user account
 */
export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'User not authenticated');
  }
  
  const user = req.user;
  await AuthService.deleteAccount(user.id);
  
  return ResponseHelper.success(res, null, 'Účet byl úspěšně smazán');
});

/**
 * Check authentication status
 */
export const checkAuth = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'User not authenticated');
  }
  
  const user = req.user;
  return ResponseHelper.success(res, { 
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified
    }
  }, 'Uživatel je přihlášen');
});

/**
 * Get user storage statistics
 */
export const getUserStorageStats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'User not authenticated');
  }
  
  const user = req.user;
  
  // Get all images from user's projects
  const userProjects = await prisma.project.findMany({
    where: { userId: user.id },
    include: {
      images: {
        select: {
          fileSize: true
        }
      }
    }
  });
  
  // Calculate total storage used
  let totalStorageBytes = 0;
  let totalImages = 0;
  
  for (const project of userProjects) {
    for (const image of project.images) {
      if (image.fileSize) {
        totalStorageBytes += image.fileSize;
      }
      totalImages++;
    }
  }
  
  // Convert to MB for easier display
  const totalStorageMB = totalStorageBytes / (1024 * 1024);
  
  return ResponseHelper.success(res, {
    totalStorageBytes,
    totalStorageMB: Math.round(totalStorageMB * 100) / 100, // Round to 2 decimal places
    totalStorageGB: Math.round((totalStorageMB / 1024) * 100) / 100, // Round to 2 decimal places
    totalImages,
    averageImageSizeMB: totalImages > 0 ? Math.round((totalStorageMB / totalImages) * 100) / 100 : 0
  }, 'Storage statistics retrieved successfully');
});

/**
 * Upload user avatar
 */
export const uploadAvatar = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'User not authenticated');
  }

  if (!req.file) {
    return ResponseHelper.validationError(res, 'No image file provided');
  }

  const user = req.user;
  const imageFile = req.file;
  
  // Validate file size (2MB max for avatars)
  const MAX_AVATAR_SIZE_BYTES = parseInt(process.env.MAX_AVATAR_SIZE || '2097152', 10); // Default 2MB
  if (imageFile.size > MAX_AVATAR_SIZE_BYTES) {
    // Clean up temp file if it exists
    if ('path' in imageFile && imageFile.path) {
      try {
        await fs.unlink(imageFile.path);
      } catch (err) {
        // Log but don't fail the request
        console.debug('Failed to cleanup temporary file:', err);
      }
    }
    const maxSizeMB = Math.round(MAX_AVATAR_SIZE_BYTES / (1024 * 1024));
    return ResponseHelper.validationError(res, `Avatar file too large. Maximum size: ${maxSizeMB}MB`);
  }
  
  // Get crop data from request body
  let cropData = null;
  if (req.body.cropData) {
    try {
      cropData = JSON.parse(req.body.cropData);
      
      // Validate cropData structure
      if (cropData && typeof cropData === 'object') {
        const { x, y, width, height } = cropData;
        
        // Check all required properties exist and are valid numbers
        if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y)) || 
            !Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) {
          return ResponseHelper.validationError(res, 'Invalid cropData: expected numeric x,y,width,height');
        }
        
        // Check width and height are positive, x and y are non-negative
        if (Number(width) <= 0 || Number(height) <= 0 || Number(x) < 0 || Number(y) < 0) {
          return ResponseHelper.validationError(res, 'Invalid cropData: width and height must be positive, x and y must be non-negative');
        }
        
        // Convert to numbers for use
        cropData = {
          x: Number(x),
          y: Number(y),
          width: Number(width),
          height: Number(height)
        };
      } else {
        return ResponseHelper.validationError(res, 'Invalid cropData: expected object with x,y,width,height');
      }
    } catch (parseError) {
      return ResponseHelper.validationError(res, 'Invalid cropData JSON');
    }
  }
  
  try {
    const result = await AuthService.uploadAvatar(user.id, imageFile, cropData || undefined);
    return ResponseHelper.success(res, result, 'Avatar byl úspěšně nahrán');
  } catch (error) {
    logger.error('Avatar upload failed:', error as Error, 'AuthController', {
      userId: user.id
    });
    return ResponseHelper.internalError(res, error as Error);
  }
});