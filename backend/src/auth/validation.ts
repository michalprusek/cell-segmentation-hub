import { z } from 'zod';

// Auth validation schemas
export const loginSchema = z.object({
  email: z.string().email('Neplatná emailová adresa'),
  password: z.string().min(1, 'Heslo je vyžadováno'),
  rememberMe: z.boolean().optional()
});

export const registerSchema = z.object({
  email: z.string().email('Neplatná emailová adresa'),
  password: z.string().min(6, 'Heslo musí mít minimálně 6 znaků'),
  username: z.string().min(2, 'Uživatelské jméno musí mít minimálně 2 znaky').optional(),
  consentToMLTraining: z.boolean().optional(),
  consentToAlgorithmImprovement: z.boolean().optional(),
  consentToFeatureDevelopment: z.boolean().optional()
});

export const resetPasswordRequestSchema = z.object({
  email: z.string().email('Neplatná emailová adresa')
});

export const resetPasswordConfirmSchema = z.object({
  token: z.string().min(1, 'Token je vyžadován'),
  newPassword: z.string().min(6, 'Nové heslo musí mít minimálně 6 znaků')
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Současné heslo je vyžadováno'),
  newPassword: z.string().min(6, 'Nové heslo musí mít minimálně 6 znaků')
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token je vyžadován')
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Ověřovací token je vyžadován')
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Neplatná emailová adresa')
});

export const updateProfileSchema = z.object({
  username: z.string().min(2, 'Uživatelské jméno musí mít minimálně 2 znaky').optional(),
  bio: z.string().max(500, 'Bio může mít maximálně 500 znaků').optional(),
  organization: z.string().max(100, 'Organizace může mít maximálně 100 znaků').optional(),
  location: z.string().max(100, 'Lokalita může mít maximálně 100 znaků').optional(),
  title: z.string().max(100, 'Titul může mít maximálně 100 znaků').optional(),
  publicProfile: z.boolean().optional(),
  avatarUrl: z.string().url('Neplatná URL adresa').optional(),
  preferredModel: z.string().optional(),
  modelThreshold: z.number().min(0).max(1).optional(),
  preferredLang: z.enum(['en', 'cs', 'es', 'fr', 'de', 'zh']).optional(),
  preferredTheme: z.enum(['light', 'dark']).optional(),
  emailNotifications: z.boolean().optional(),
  consentToMLTraining: z.boolean().optional(),
  consentToAlgorithmImprovement: z.boolean().optional(),
  consentToFeatureDevelopment: z.boolean().optional()
});

// Type exports for use in controllers
export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
export type ResetPasswordRequestData = z.infer<typeof resetPasswordRequestSchema>;
export type ResetPasswordConfirmData = z.infer<typeof resetPasswordConfirmSchema>;
export type ChangePasswordData = z.infer<typeof changePasswordSchema>;
export type RefreshTokenData = z.infer<typeof refreshTokenSchema>;
export type VerifyEmailData = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationData = z.infer<typeof resendVerificationSchema>;
export type UpdateProfileData = z.infer<typeof updateProfileSchema>;