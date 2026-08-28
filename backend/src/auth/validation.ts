import { z } from 'zod';

// The six locales the frontend ships translation chunks for
// (src/contexts/translationLoader.ts). Shared by the register and
// profile-update schemas so the two can never drift apart.
const supportedLanguage = z.enum(['en', 'cs', 'es', 'fr', 'de', 'zh']);

// Auth validation schemas
export const loginSchema = z.object({
  email: z.string().email('Neplatná emailová adresa'),
  password: z.string().min(1, 'Heslo je vyžadováno'),
  rememberMe: z.boolean().optional(),
});

export const registerSchema = z.object({
  email: z.string().email('Neplatná emailová adresa'),
  password: z.string().min(6, 'Heslo musí mít minimálně 6 znaků'),
  username: z
    .string()
    .min(2, 'Uživatelské jméno musí mít minimálně 2 znaky')
    .optional(),
  // UI language the client resolved for this visitor (explicit pick, else
  // browser preference). Persisted as the new profile's preferredLang so a
  // fresh account starts in the language the user is actually reading.
  // Both wire names are accepted, matching updateProfileSchema below.
  preferredLang: supportedLanguage.optional(),
  language: supportedLanguage.optional(),
  consentToMLTraining: z.boolean().optional(),
  consentToAlgorithmImprovement: z.boolean().optional(),
  consentToFeatureDevelopment: z.boolean().optional(),
});

export const resetPasswordRequestSchema = z.object({
  email: z.string().email('Neplatná emailová adresa'),
});

export const resetPasswordConfirmSchema = z.object({
  token: z.string().min(1, 'Token je vyžadován'),
  newPassword: z.string().min(6, 'Nové heslo musí mít minimálně 6 znaků'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Současné heslo je vyžadováno'),
  newPassword: z.string().min(6, 'Nové heslo musí mít minimálně 6 znaků'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token je vyžadován'),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Ověřovací token je vyžadován'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Neplatná emailová adresa'),
});

export const updateProfileSchema = z.object({
  username: z
    .string()
    .min(2, 'Uživatelské jméno musí mít minimálně 2 znaky')
    .optional(),
  bio: z.string().max(500, 'Bio může mít maximálně 500 znaků').optional(),
  organization: z
    .string()
    .max(100, 'Organizace může mít maximálně 100 znaků')
    .optional(),
  location: z
    .string()
    .max(100, 'Lokalita může mít maximálně 100 znaků')
    .optional(),
  title: z.string().max(100, 'Titul může mít maximálně 100 znaků').optional(),
  publicProfile: z.boolean().optional(),
  avatarUrl: z.string().url('Neplatná URL adresa').optional(),
  preferredModel: z.string().optional(),
  modelThreshold: z.number().min(0).max(1).optional(),
  preferredLang: supportedLanguage.optional(),
  preferredTheme: z.enum(['light', 'dark']).optional(),
  // Wire aliases the frontend actually sends: getUserProfile() serialises
  // preferredLang/preferredTheme as `language`/`theme`, so the write side
  // uses the same names. Without these, Zod silently strips them and the
  // language/theme change is dropped (app reverts to the stale profile
  // value on next load). Mapped back in AuthService.updateProfile.
  language: supportedLanguage.optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  emailNotifications: z.boolean().optional(),
  consentToMLTraining: z.boolean().optional(),
  consentToAlgorithmImprovement: z.boolean().optional(),
  consentToFeatureDevelopment: z.boolean().optional(),
});

// Type exports for use in controllers
export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
export type ResetPasswordRequestData = z.infer<
  typeof resetPasswordRequestSchema
>;
export type ResetPasswordConfirmData = z.infer<
  typeof resetPasswordConfirmSchema
>;
export type ChangePasswordData = z.infer<typeof changePasswordSchema>;
export type RefreshTokenData = z.infer<typeof refreshTokenSchema>;
export type VerifyEmailData = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationData = z.infer<typeof resendVerificationSchema>;
export type UpdateProfileData = z.infer<typeof updateProfileSchema>;
