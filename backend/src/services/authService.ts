import { prisma } from '../db';
import { hashPassword, verifyPassword, generateSecureToken } from '../auth/password';
import { generateTokenPair, JwtPayload, verifyRefreshToken } from '../auth/jwt';
import { logger } from '../utils/logger';
import { ApiError } from '../middleware/error';
import * as EmailService from './emailService';
import { generateFriendlyPassword } from '../utils/passwordGenerator';
import { getStorageProvider } from '../storage/index';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { sessionService } from './sessionService';
import type { 
  LoginData, 
  RegisterData, 
  ResetPasswordRequestData, 
  ResetPasswordConfirmData,
  ChangePasswordData,
  RefreshTokenData
} from '../auth/validation';
import type { Profile } from '@prisma/client';
import type { Express } from 'express';

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
    profile?: Profile | null;
  };
  accessToken: string;
  refreshToken: string;
}

/* AuthService functions */
  /**
   * Register a new user
   */
export async function register(data: RegisterData): Promise<{ message: string; user: { id: string; email: string; username?: string; emailVerified: boolean }; accessToken: string; refreshToken: string }> {
    try {
      // Import transaction utility at the top of the function
      const { withTransaction } = await import('../utils/database');
      
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

      // Execute registration in a transaction for data integrity
      const result = await withTransaction(prisma, async (tx) => {
        // Create user with profile including consent fields
        const newUser = await tx.user.create({
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
          },
          include: { profile: true }
        });

        // Generate tokens for immediate login (default rememberMe=true for registration)
        const tokenPayload: JwtPayload = {
          userId: newUser.id,
          email: newUser.email,
          emailVerified: newUser.emailVerified
        };

        const { accessToken, refreshToken } = generateTokenPair(tokenPayload, true);

        // Create session with rememberMe=true for new registrations
        await tx.session.create({
          data: {
            userId: newUser.id,
            refreshToken,
            rememberMe: true,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days for new registrations
            isValid: true
          }
        });

        logger.info('User registered successfully', 'AuthService', { email: data.email });

        // Send verification email using user's preferred language
        try {
          const locale = newUser.profile?.preferredLang || 'cs';
          await EmailService.sendVerificationEmail(data.email, verificationToken, locale);
          logger.info('Verification email sent successfully', 'AuthService', { 
            email: data.email, 
            locale 
          });
        } catch (emailError) {
          logger.error('Failed to send verification email:', emailError as Error, 'AuthService', { email: data.email });
          // Continue with registration - don't fail the registration process if email fails
        }

        return {
          user: newUser,
          accessToken,
          refreshToken
        };
      });

      return {
        message: 'Uživatel byl úspěšně zaregistrován a přihlášen.',
        user: {
          id: result.user.id,
          email: result.user.email,
          username: result.user.profile?.username || undefined,
          emailVerified: result.user.emailVerified
        },
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
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
export async function login(data: LoginData & { rememberMe?: boolean }): Promise<AuthResult> {
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

      // Check email verification if required by environment
      const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
      if (requireEmailVerification && !user.emailVerified) {
        throw ApiError.forbidden('Email musí být ověřen před přihlášením. Zkontrolujte svou emailovou schránku nebo požádejte o nový ověřovací email.');
      }

      // Generate tokens with rememberMe option
      const tokenPayload: JwtPayload = {
        userId: user.id,
        email: user.email,
        emailVerified: user.emailVerified
      };

      const rememberMe = data.rememberMe ?? false;
      const { accessToken, refreshToken } = generateTokenPair(tokenPayload, rememberMe);

      // Create session in Redis
      const sessionId = await sessionService.createSession(
        refreshToken, 
        tokenPayload, 
        {
          rememberMe,
          userAgent: undefined, // Will be set by middleware if available
          ipAddress: undefined  // Will be set by middleware if available
        }
      );

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
export async function refreshToken(data: RefreshTokenData): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      // Use session service to refresh the session
      const result = await sessionService.refreshSession(data.refreshToken);

      if (!result) {
        throw ApiError.unauthorized('Neplatný nebo vypršený refresh token');
      }

      logger.info('Token refreshed successfully', 'AuthService', { sessionId: result.sessionId });

      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
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
export async function logout(refreshToken: string): Promise<void> {
    try {
      const success = await sessionService.deleteRefreshToken(refreshToken);
      
      if (success) {
        logger.info('User logged out successfully', 'AuthService');
      } else {
        logger.warn('Refresh token not found for logout', 'AuthService');
      }
    } catch (error) {
      logger.error('Logout failed:', error as Error, 'AuthService');
      throw ApiError.internalError('Odhlášení se nezdařilo');
    }
  }

  /**
   * Request password reset - generates secure token and sends reset link via email
   */
export async function requestPasswordReset(data: ResetPasswordRequestData): Promise<{ message: string; resetToken?: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { email: data.email }
      });

      if (!user) {
        // Don't reveal if user exists - always return success
        return { message: 'Pokud email existuje, byl odeslán odkaz pro reset hesla.' };
      }

      // Generate secure reset token
      const resetToken = generateSecureToken();
      const tokenHash = await hashPassword(resetToken); // Hash the token before storing
      
      // Set token expiry to 1 hour from now
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Store hashed token and expiry
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: tokenHash,
          resetTokenExpiry
        }
      });

      logger.info('Password reset token generated', 'AuthService', { email: data.email });

      // Send email with reset link
      // TEMPORARY: Skip email sending due to SMTP timeout issues
      if (process.env.SKIP_EMAIL_SEND === 'true') {
        logger.warn('Password reset email skipped (SKIP_EMAIL_SEND=true)', 'AuthService', { 
          email: data.email,
          tokenExpiry: resetTokenExpiry 
        });
      } else {
        try {
          await EmailService.sendPasswordResetEmail(data.email, resetToken, resetTokenExpiry);
          logger.info('Password reset email sent successfully', 'AuthService', { email: data.email });
        } catch (emailError) {
          logger.error('Failed to send password reset email:', emailError as Error, 'AuthService', { email: data.email });
          // Continue without throwing error - token has already been generated
        }
      }

      const response: { message: string; resetToken?: string } = {
        message: 'Pokud email existuje, byl odeslán odkaz pro reset hesla.'
      };
      
      // Only include token in non-production environments for testing
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
   * Confirm password reset with token - allows user to set new password
   */
export async function resetPasswordWithToken(data: ResetPasswordConfirmData): Promise<{ message: string }> {
    try {
      // Find user with non-expired reset token
      const user = await prisma.user.findFirst({
        where: {
          resetTokenExpiry: {
            gte: new Date() // Token must not be expired
          },
          resetToken: {
            not: null // Token must exist
          }
        }
      });

      if (!user || !user.resetToken) {
        throw ApiError.badRequest('Neplatný nebo vypršený reset token');
      }

      // Verify the token matches (compare against hashed version)
      const isTokenValid = await verifyPassword(data.token, user.resetToken);
      if (!isTokenValid) {
        throw ApiError.badRequest('Neplatný nebo vypršený reset token');
      }

      // Hash the new password
      const hashedPassword = await hashPassword(data.newPassword);

      // Update password and clear reset token
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null
        }
      });

      // Invalidate all existing sessions to force re-login
      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { isValid: false }
      });

      logger.info('Password reset completed successfully', 'AuthService', { userId: user.id });

      return { message: 'Heslo bylo úspěšně změněno. Nyní se můžete přihlásit s novým heslem.' };
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
export async function changePassword(userId: string, data: ChangePasswordData): Promise<{ message: string }> {
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
export async function updateProfile(userId: string, profileData: ProfileUpdateData): Promise<{ user: { id: string; email: string; emailVerified: boolean; profile: Profile } }> {
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
export async function deleteAccount(userId: string): Promise<void> {
    try {
      // Import transaction utility
      const { withTransaction } = await import('../utils/database');
      
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          projects: {
            include: {
              images: true
            }
          }
        }
      });

      if (!user) {
        throw ApiError.notFound('Uživatel nenalezen');
      }

      // Delete user and all related data in a transaction
      await withTransaction(prisma, async (tx) => {
        // First, delete all sessions to prevent any further access
        await tx.session.deleteMany({
          where: { userId }
        });

        // Delete all project images and their files
        for (const project of user.projects) {
          for (const image of project.images) {
            // Delete segmentation results first
            await tx.segmentationResult.deleteMany({
              where: { projectImageId: image.id }
            });

            // Delete queue items
            await tx.queueItem.deleteMany({
              where: { imageId: image.id }
            });
          }

          // Delete all project images
          await tx.projectImage.deleteMany({
            where: { projectId: project.id }
          });
        }

        // Delete all projects
        await tx.project.deleteMany({
          where: { userId }
        });

        // Delete profile
        await tx.profile.deleteMany({
          where: { userId }
        });

        // Finally, delete the user
        await tx.user.delete({
          where: { id: userId }
        });

        logger.info('Account and all related data deleted successfully', 'AuthService', { userId });
      });

      // Clean up storage files after successful database deletion
      try {
        const storage = getStorageProvider();
        await storage.deleteUserFiles(userId);
      } catch (storageError) {
        logger.error('Failed to delete user files from storage', storageError as Error, 'AuthService');
        // Don't throw - database deletion was successful
      }

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
export async function verifyEmail(token: string): Promise<{ message: string }> {
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
export async function resendVerificationEmail(email: string): Promise<{ message: string; verificationToken?: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
        include: { profile: true }
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

      // Send verification email using user's preferred language
      try {
        const locale = user.profile?.preferredLang || 'cs';
        await EmailService.sendVerificationEmail(email, verificationToken, locale);
        logger.info('Verification email resent successfully', 'AuthService', { 
          email, 
          locale 
        });
      } catch (emailError) {
        logger.error('Failed to resend verification email:', emailError as Error, 'AuthService', { email });
        // Don't fail the request - user should still get success message for security
      }

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

  /**
   * Upload user avatar
   */
export async function uploadAvatar(
    userId: string, 
    imageFile: Express.Multer.File, 
    _cropData?: { x: number; y: number; width: number; height: number }
  ): Promise<{ avatarUrl: string; message: string }> {
    try {
      // Validate file size first (max 5MB for avatars)
      const maxFileSize = 5 * 1024 * 1024; // 5MB
      if (imageFile.size > maxFileSize || imageFile.buffer.length > maxFileSize) {
        throw ApiError.validationError(
          `File is too large. Maximum allowed size: ${maxFileSize / (1024 * 1024)}MB`
        );
      }

      // Validate file type by reading actual file signature
      const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/tiff', 'image/tif'];
      try {
        const metadata = await sharp(imageFile.buffer).metadata();
        const detectedFormat = metadata.format;
        
        // Map Sharp format to MIME type for validation
        const formatToMimeMap: { [key: string]: string } = {
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'webp': 'image/webp',
          'tiff': 'image/tiff',
          'bmp': 'image/bmp'
        };
        
        const detectedMimeType = detectedFormat ? formatToMimeMap[detectedFormat] : null;
        
        if (!detectedMimeType || !allowedMimeTypes.includes(detectedMimeType)) {
          throw ApiError.validationError(
            `Unsupported file format. Allowed formats: ${allowedMimeTypes.join(', ')}`
          );
        }
        
        // Additional check: ensure detected format matches claimed mimetype (prevent spoofing)
        if (!imageFile.mimetype.includes(detectedFormat || '')) {
          logger.warn(`File format mismatch: claimed ${imageFile.mimetype}, detected ${detectedFormat}`);
        }
      } catch (sharpError) {
        // Fallback to mimetype check if Sharp detection fails
        logger.warn(`Sharp image detection failed: ${(sharpError as Error).message}. Falling back to mimetype check.`);
        if (!allowedMimeTypes.includes(imageFile.mimetype)) {
          throw ApiError.validationError(
            `Unsupported file format. Allowed formats: ${allowedMimeTypes.join(', ')}`
          );
        }
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true }
      });

      if (!user) {
        throw ApiError.notFound('User not found');
      }

      // Generate unique filename for avatar - always use .jpg since we convert to JPEG
      const avatarFilename = `avatar-${userId}-${uuidv4()}.jpg`;
      const storageKey = `avatars/${userId}/${avatarFilename}`;

      // Process image with Sharp - resize and optimize
      let processedBuffer: Buffer;
      try {
        processedBuffer = await sharp(imageFile.buffer)
          .resize(300, 300, {
            fit: 'cover',
            position: 'center'
          })
          .jpeg({
            quality: 85,
            progressive: true
          })
          .toBuffer();
      } catch (sharpError) {
        logger.error('Image processing failed:', sharpError as Error, 'AuthService', {
          userId,
          originalMimeType: imageFile.mimetype
        });
        throw ApiError.validationError('Failed to process image. Please ensure you uploaded a valid image file.');
      }

      // Upload processed image to storage
      const storage = getStorageProvider();
      const processedFile = {
        ...imageFile,
        buffer: processedBuffer,
        mimetype: 'image/jpeg', // Always convert to JPEG
        size: processedBuffer.length
      };
      // Store old avatar path for cleanup after successful upload
      const oldAvatarPath = user.profile?.avatarPath;
      
      // Upload processed image to storage
      let uploadResult;
      let avatarUrl;
      try {
        uploadResult = await storage.upload(processedFile.buffer, storageKey, {
          mimeType: processedFile.mimetype,
          originalName: imageFile.originalname,
          maxSize: maxFileSize
        });
        
        // Get public URL for the avatar
        avatarUrl = await storage.getUrl(uploadResult.originalPath);
      } catch (uploadError) {
        logger.error('Avatar upload failed:', uploadError as Error, 'AuthService', {
          userId,
          storageKey
        });
        throw ApiError.internalError('Failed to upload avatar. Please try again.');
      }

      // Update profile with new avatar information
      await prisma.profile.upsert({
        where: { userId },
        update: {
          avatarUrl,
          avatarPath: uploadResult.originalPath,
          avatarMimeType: 'image/jpeg', // Always JPEG after processing
          avatarSize: processedBuffer.length
        },
        create: {
          userId,
          avatarUrl,
          avatarPath: uploadResult.originalPath,
          avatarMimeType: 'image/jpeg', // Always JPEG after processing
          avatarSize: processedBuffer.length
        }
      });

      // Delete old avatar after successful database update
      if (oldAvatarPath) {
        try {
          await storage.delete(oldAvatarPath);
        } catch (error) {
          // Log but don't fail if old avatar deletion fails
          logger.warn('Failed to delete old avatar after successful upload', 'AuthService', {
            userId,
            oldPath: oldAvatarPath,
            error: error as Error
          });
        }
      }

      logger.info('Avatar uploaded successfully', 'AuthService', { 
        userId,
        fileSize: imageFile.size,
        mimeType: imageFile.mimetype,
        storagePath: uploadResult.originalPath
      });

      return {
        avatarUrl,
        message: 'Avatar uploaded successfully'
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Avatar upload failed:', error as Error, 'AuthService', {
        userId,
        fileSize: imageFile.size,
        mimeType: imageFile.mimetype
      });
      throw ApiError.internalError('Avatar upload failed');
    }
  }