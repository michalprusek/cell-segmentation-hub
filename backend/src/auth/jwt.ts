import jwt from 'jsonwebtoken';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export interface JwtPayload {
  userId: string;
  email: string;
  emailVerified: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Generate JWT access token
 */
export const generateAccessToken = (payload: JwtPayload): string => {
  try {
    if (!config.JWT_ACCESS_SECRET) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }
    return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
      expiresIn: config.JWT_ACCESS_EXPIRY,
      issuer: 'cell-segmentation-api',
      audience: 'cell-segmentation-app',
    } as jwt.SignOptions);
  } catch (error) {
    logger.error('Failed to generate access token:', error as Error, 'JWT');
    throw new Error('Token generation failed');
  }
};

/**
 * Generate JWT refresh token
 */
export const generateRefreshToken = (
  payload: JwtPayload,
  rememberMe = false
): string => {
  try {
    if (!config.JWT_REFRESH_SECRET) {
      throw new Error('JWT_REFRESH_SECRET is not configured');
    }

    // Determine expiry based on rememberMe flag
    let expiresIn: string | undefined;
    if (rememberMe) {
      if (config.JWT_REFRESH_EXPIRY_REMEMBER) {
        expiresIn = config.JWT_REFRESH_EXPIRY_REMEMBER;
      } else {
        logger.warn(
          'JWT_REFRESH_EXPIRY_REMEMBER not configured, falling back to JWT_REFRESH_EXPIRY',
          'JWT'
        );
        expiresIn = config.JWT_REFRESH_EXPIRY;
      }
    } else {
      expiresIn = config.JWT_REFRESH_EXPIRY;
    }

    // Ensure we always have an expiry
    if (!expiresIn) {
      throw new Error(
        'No refresh token expiry configured. Set JWT_REFRESH_EXPIRY and optionally JWT_REFRESH_EXPIRY_REMEMBER'
      );
    }

    return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
      expiresIn,
      issuer: 'cell-segmentation-api',
      audience: 'cell-segmentation-app',
    } as jwt.SignOptions);
  } catch (error) {
    logger.error('Failed to generate refresh token:', error as Error, 'JWT');
    throw new Error('Token generation failed');
  }
};

/**
 * Generate both access and refresh tokens
 */
export const generateTokenPair = (
  payload: JwtPayload,
  rememberMe = false
): TokenPair => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload, rememberMe),
  };
};

/**
 * Verify access token
 */
export const verifyAccessToken = (token: string): JwtPayload => {
  try {
    if (!config.JWT_ACCESS_SECRET) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      issuer: 'cell-segmentation-api',
      audience: 'cell-segmentation-app',
    }) as JwtPayload;

    return payload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Access token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid access token');
    } else {
      logger.error('Access token verification failed:', error as Error, 'JWT');
      throw new Error('Token verification failed');
    }
  }
};

/**
 * Verify refresh token
 */
export const verifyRefreshToken = (token: string): JwtPayload => {
  try {
    if (!config.JWT_REFRESH_SECRET) {
      throw new Error('JWT_REFRESH_SECRET is not configured');
    }
    const payload = jwt.verify(token, config.JWT_REFRESH_SECRET, {
      issuer: 'cell-segmentation-api',
      audience: 'cell-segmentation-app',
    }) as JwtPayload;

    return payload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    } else {
      logger.error('Refresh token verification failed:', error as Error, 'JWT');
      throw new Error('Token verification failed');
    }
  }
};

/**
 * Extract token from Authorization header
 */
export const extractTokenFromHeader = (
  authHeader: string | undefined
): string | null => {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1] || null;
};

/**
 * Get token expiration time
 */
export const getTokenExpiration = (token: string): Date | null => {
  try {
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    if (!decoded || !decoded.exp) {
      return null;
    }
    return new Date(decoded.exp * 1000);
  } catch {
    return null;
  }
};

/**
 * Check if token is expired
 */
export const isTokenExpired = (token: string): boolean => {
  const expiration = getTokenExpiration(token);
  if (!expiration) {
    return true;
  }
  return expiration < new Date();
};
