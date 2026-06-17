import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * Hash password using bcrypt
 */
export const hashPassword = async (password: string): Promise<string> => {
  try {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    logger.error('Password hashing failed:', error as Error, 'Auth');
    throw new Error('Password hashing failed');
  }
};

/**
 * Verify password against hash
 */
export const verifyPassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    logger.error('Password verification failed:', error as Error, 'Auth');
    throw new Error('Password verification failed');
  }
};

/**
 * Generate random token for email verification or password reset
 */
export const generateSecureToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};
