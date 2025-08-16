import { prisma } from '../db';
import { hashPassword, verifyPassword, generateSecureToken } from '../auth/password';
import { generateTokenPair, JwtPayload } from '../auth/jwt';
import { logger } from '../utils/logger';
import { ApiError } from '../middleware/error';
import type { 
  LoginData, 
  RegisterData, 
  ResetPasswordRequestData, 
  ResetPasswordConfirmData,
  ChangePasswordData,
  RefreshTokenData
} from '../auth/validation';

export interface ProfileUpdateData {
  username?: string;
  bio?: string;
  organization?: string;
  location?: string;
  title?: string;
  publicProfile?: boolean;
  avatarUrl?: string;
  preferredModel?: string;
  modelThreshold?: number;
  preferredLang?: string;
  preferredTheme?: string;
  emailNotifications?: boolean;
  consentToMLTraining?: boolean;
  consentToAlgorithmImprovement?: boolean;
  consentToFeatureDevelopment?: boolean;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    profile?: any;
  };
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  /**
   * Register a new user
   */
  static async register(data: RegisterData): Promise<{ message: string; user: any; accessToken: string; refreshToken: string }> {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email }
      });

      if (existingUser) {
        throw ApiError.conflict('Uživatel s tímto emailem již existuje');
      }

      // Check if username is taken (if provided)
      if (data.username) {
        const existingUsername = await prisma.profile.findUnique({
          where: { username: data.username }
        });

        if (existingUsername) {
          throw ApiError.conflict('Uživatelské jméno již existuje');
        }
      }

      // Hash password
      const hashedPassword = await hashPassword(data.password);
      
      // Generate verification token
      const verificationToken = generateSecureToken();

      // Create user with profile including consent fields
      await prisma.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          verificationToken,
          profile: {
            create: {
              username: data.username,
              preferredModel: 'model1',
              modelThreshold: 0.5,
              preferredLang: 'cs',
              preferredTheme: 'light',
              emailNotifications: true,
              consentToMLTraining: true,
              consentToAlgorithmImprovement: true,
              consentToFeatureDevelopment: true,
              consentUpdatedAt: new Date()
            }
          }
        }
      });

      logger.info('User registered successfully', 'AuthService', { email: data.email });

      // TODO: Send verification email
      // await EmailService.sendVerificationEmail(data.email, verificationToken);

      // Auto-login user after registration
      const newUser = await prisma.user.findUnique({
        where: { email: data.email },
        include: { profile: true }
      });

      if (!newUser) {
        throw ApiError.internalError('Chyba při vytváření uživatele');
      }

      // Generate tokens for immediate login
      const tokenPayload: JwtPayload = {
        userId: newUser.id,
        email: newUser.email,
        emailVerified: newUser.emailVerified
      };

      const { accessToken, refreshToken } = generateTokenPair(tokenPayload);

      // Create session
      await prisma.session.create({
        data: {
          userId: newUser.id,
          refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          isValid: true
        }
      });

      return {
        message: 'Uživatel byl úspěšně zaregistrován a přihlášen.',
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.profile?.username || undefined,
          emailVerified: newUser.emailVerified
        },
        accessToken,
        refreshToken
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Registration failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Registrace se nezdařila');
    }
  }

  /**
   * Login user
   */
  static async login(data: LoginData): Promise<AuthResult> {
    try {
      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email: data.email },
        include: { profile: true }
      });

      if (!user) {
        throw ApiError.unauthorized('Neplatné přihlašovací údaje');
      }

      // Verify password
      const isPasswordValid = await verifyPassword(data.password, user.password);
      if (!isPasswordValid) {
        throw ApiError.unauthorized('Neplatné přihlašovací údaje');
      }

      // Generate tokens
      const tokenPayload: JwtPayload = {
        userId: user.id,
        email: user.email,
        emailVerified: user.emailVerified
      };

      const { accessToken, refreshToken } = generateTokenPair(tokenPayload);

      // Store refresh token in database
      await prisma.session.create({
        data: {
          userId: user.id,
          refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          isValid: true
        }
      });

      logger.info('User logged in successfully', 'AuthService', { 
        email: user.email, 
        emailVerified: user.emailVerified 
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
          profile: user.profile
        },
        accessToken,
        refreshToken
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Login failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Přihlášení se nezdařilo');
    }
  }

  /**
   * Refresh access token
   */
  static async refreshToken(data: RefreshTokenData): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      // Find session with refresh token
      const session = await prisma.session.findUnique({
        where: { refreshToken: data.refreshToken }
      });

      if (!session || !session.isValid || session.expiresAt < new Date()) {
        throw ApiError.unauthorized('Neplatný nebo vypršený refresh token');
      }

      // Get user data
      const user = await prisma.user.findUnique({
        where: { id: session.userId }
      });

      if (!user) {
        throw ApiError.unauthorized('Uživatel nenalezen');
      }

      // Generate new tokens
      const tokenPayload: JwtPayload = {
        userId: session.userId,
        email: user.email,
        emailVerified: user.emailVerified
      };

      const { accessToken, refreshToken: newRefreshToken } = generateTokenPair(tokenPayload);

      // Update session with new refresh token
      await prisma.session.update({
        where: { id: session.id },
        data: {
          refreshToken: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        }
      });

      logger.info('Token refreshed successfully', 'AuthService', { userId: session.userId });

      return {
        accessToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Token refresh failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Obnovení tokenu se nezdařilo');
    }
  }

  /**
   * Logout user (invalidate refresh token)
   */
  static async logout(refreshToken: string): Promise<void> {
    try {
      await prisma.session.updateMany({
        where: { refreshToken },
        data: { isValid: false }
      });

      logger.info('User logged out successfully', 'AuthService');
    } catch (error) {
      logger.error('Logout failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Odhlášení se nezdařilo');
    }
  }

  /**
   * Request password reset
   */
  static async requestPasswordReset(data: ResetPasswordRequestData): Promise<{ message: string; resetToken?: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { email: data.email }
      });

      if (!user) {
        // Don't reveal if user exists - always return success
        return { message: 'Pokud email existuje, byl odeslán odkaz pro reset hesla.' };
      }

      // Generate reset token
      const resetToken = generateSecureToken();
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetTokenExpiry
        }
      });

      logger.info('Password reset requested', 'AuthService', { email: data.email });

      // TODO: Send reset email
      // await EmailService.sendPasswordResetEmail(data.email, resetToken);

      const response: { message: string; resetToken?: string } = {
        message: 'Pokud email existuje, byl odeslán odkaz pro reset hesla.'
      };
      
      // Only include token in non-production environments
      if (process.env.NODE_ENV !== 'production') {
        response.resetToken = resetToken;
      }
      
      return response;
    } catch (error) {
      logger.error('Password reset request failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Žádost o reset hesla se nezdařila');
    }
  }

  /**
   * Confirm password reset
   */
  static async confirmPasswordReset(data: ResetPasswordConfirmData): Promise<{ message: string }> {
    try {
      const user = await prisma.user.findFirst({
        where: {
          resetToken: data.token,
          resetTokenExpiry: {
            gt: new Date()
          }
        }
      });

      if (!user) {
        throw ApiError.badRequest('Neplatný nebo vypršený token');
      }

      // Hash new password
      const hashedPassword = await hashPassword(data.password);

      // Update password and clear reset token
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null
        }
      });

      // Invalidate all sessions for this user
      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { isValid: false }
      });

      logger.info('Password reset completed', 'AuthService', { userId: user.id });

      return { message: 'Heslo bylo úspěšně změněno.' };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Password reset confirmation failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Reset hesla se nezdařil');
    }
  }

  /**
   * Change password (authenticated user)
   */
  static async changePassword(userId: string, data: ChangePasswordData): Promise<{ message: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw ApiError.notFound('Uživatel nenalezen');
      }

      // Verify current password
      const isCurrentPasswordValid = await verifyPassword(data.currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        throw ApiError.badRequest('Současné heslo není správné');
      }

      // Hash new password
      const hashedPassword = await hashPassword(data.newPassword);

      // Update password
      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      });

      // Invalidate all sessions except current one (optional - could be implemented)
      // For now, invalidate all sessions to force re-login
      await prisma.session.updateMany({
        where: { userId },
        data: { isValid: false }
      });

      logger.info('Password changed successfully', 'AuthService', { userId });

      return { message: 'Heslo bylo úspěšně změněno.' };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Password change failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Změna hesla se nezdařila');
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(userId: string, profileData: ProfileUpdateData): Promise<any> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true }
      });

      if (!user) {
        throw ApiError.notFound('Uživatel nenalezen');
      }

      // Update consent timestamp if any consent field is being updated
      const consentUpdatedAt = (
        profileData.consentToMLTraining !== undefined || 
        profileData.consentToAlgorithmImprovement !== undefined ||
        profileData.consentToFeatureDevelopment !== undefined
      ) ? new Date() : undefined;

      // Prepare update/create data
      const profileFields = {
        username: profileData.username,
        bio: profileData.bio,
        organization: profileData.organization,
        location: profileData.location,
        title: profileData.title,
        publicProfile: profileData.publicProfile,
        avatarUrl: profileData.avatarUrl,
        preferredModel: profileData.preferredModel,
        modelThreshold: profileData.modelThreshold,
        preferredLang: profileData.preferredLang,
        preferredTheme: profileData.preferredTheme,
        emailNotifications: profileData.emailNotifications,
        consentToMLTraining: profileData.consentToMLTraining,
        consentToAlgorithmImprovement: profileData.consentToAlgorithmImprovement,
        consentToFeatureDevelopment: profileData.consentToFeatureDevelopment,
        ...(consentUpdatedAt && { consentUpdatedAt }),
      };

      // Filter out undefined values
      const cleanedFields = Object.fromEntries(
        Object.entries(profileFields).filter(([_, value]) => value !== undefined)
      );

      // Update or create profile
      const updatedProfile = await prisma.profile.upsert({
        where: { userId },
        update: cleanedFields,
        create: {
          userId,
          ...cleanedFields,
        }
      });

      logger.info('Profile updated successfully', 'AuthService', { userId });

      return {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
          profile: updatedProfile
        }
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Profile update failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Aktualizace profilu se nezdařila');
    }
  }

  /**
   * Delete user account
   */
  static async deleteAccount(userId: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw ApiError.notFound('Uživatel nenalezen');
      }

      // Delete user (this will cascade delete profile, projects, etc. due to Prisma relations)
      await prisma.user.delete({
        where: { id: userId }
      });

      logger.info('Account deleted successfully', 'AuthService', { userId });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Account deletion failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Smazání účtu se nezdařilo');
    }
  }

  /**
   * Verify email
   */
  static async verifyEmail(token: string): Promise<{ message: string }> {
    try {
      const user = await prisma.user.findFirst({
        where: { verificationToken: token }
      });

      if (!user) {
        throw ApiError.badRequest('Neplatný ověřovací token');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          verificationToken: null
        }
      });

      logger.info('Email verified successfully', 'AuthService', { userId: user.id });

      return { message: 'Email byl úspěšně ověřen.' };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Email verification failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Ověření emailu se nezdařilo');
    }
  }

  /**
   * Resend verification email
   */
  static async resendVerificationEmail(email: string): Promise<{ message: string; verificationToken?: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        // Don't reveal if user exists
        return { message: 'Pokud email existuje a není ověřen, byl odeslán ověřovací email.' };
      }

      if (user.emailVerified) {
        return { message: 'Email je již ověřen.' };
      }

      // Generate new verification token
      const verificationToken = generateSecureToken();

      await prisma.user.update({
        where: { id: user.id },
        data: { verificationToken }
      });

      logger.info('Verification email resent', 'AuthService', { email });

      // TODO: Send verification email
      // await EmailService.sendVerificationEmail(email, verificationToken);

      const response: { message: string; verificationToken?: string } = {
        message: 'Pokud email existuje a není ověřen, byl odeslán ověřovací email.'
      };
      
      // Only include token in non-production environments
      if (process.env.NODE_ENV !== 'production') {
        response.verificationToken = verificationToken;
      }
      
      return response;
    } catch (error) {
      logger.error('Resend verification email failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Odeslání ověřovacího emailu se nezdařilo');
    }
  }
}