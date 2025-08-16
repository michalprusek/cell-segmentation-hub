import { Request, Response } from 'express';
import { AuthService } from '../../services/authService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import { logger } from '../../utils/logger';
import {
  loginSchema,
  registerSchema,
  resetPasswordRequestSchema,
  resetPasswordConfirmSchema,
  changePasswordSchema,
  refreshTokenSchema
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
    return ResponseHelper.error(res, 'Validation failed', 400, { errors });
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
    return ResponseHelper.error(res, 'Validation failed', 400, { errors });
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
 * Request password reset
 */
export const requestPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  // Validate email using Zod schema
  const validationResult = resetPasswordRequestSchema.safeParse(req.body);
  if (!validationResult.success) {
    const errors = validationResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
    return ResponseHelper.error(res, 'Validation failed', 400, { errors });
  }
  
  const data: ResetPasswordRequestData = validationResult.data;
  
  const result = await AuthService.requestPasswordReset(data);
  
  return ResponseHelper.success(res, result, result.message);
});

/**
 * Confirm password reset
 */
export const confirmPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  const data: ResetPasswordConfirmData = req.body;
  
  const result = await AuthService.confirmPasswordReset(data);
  
  return ResponseHelper.success(res, result, result.message);
});

/**
 * Change password (authenticated user)
 */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const data: ChangePasswordData = req.body;
  const userId = req.user!.id; // User is guaranteed to exist due to auth middleware
  
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
  const user = req.user!; // User is guaranteed to exist due to auth middleware
  
  return ResponseHelper.success(res, { user }, 'Profil uživatele');
});

/**
 * Update user profile
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!; // User is guaranteed to exist due to auth middleware
  const profileData = req.body;
  
  const updatedProfile = await AuthService.updateProfile(user.id, profileData);
  
  return ResponseHelper.success(res, updatedProfile, 'Profil byl úspěšně aktualizován');
});

/**
 * Delete user account
 */
export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!; // User is guaranteed to exist due to auth middleware
  
  await AuthService.deleteAccount(user.id);
  
  return ResponseHelper.success(res, null, 'Účet byl úspěšně smazán');
});

/**
 * Check authentication status
 */
export const checkAuth = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!; // User is guaranteed to exist due to auth middleware
  
  return ResponseHelper.success(res, { 
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified
    }
  }, 'Uživatel je přihlášen');
});