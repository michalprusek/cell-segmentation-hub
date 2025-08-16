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
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
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

/**
 * Generate random password
 */
export const generateRandomPassword = (length = 12): string => {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, charset.length);
    password += charset[randomIndex];
  }
  
  return password;
};

/**
 * Validate password strength
 */
export const validatePasswordStrength = (password: string): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];
  
  if (password.length < 6) {
    errors.push('Heslo musí mít minimálně 6 znaků');
  }
  
  if (password.length > 128) {
    errors.push('Heslo může mít maximálně 128 znaků');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Heslo musí obsahovat alespoň jedno malé písmeno');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Heslo musí obsahovat alespoň jedno velké písmeno');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Heslo musí obsahovat alespoň jednu číslici');
  }
  
  // Check for common weak passwords
  const commonPasswords = [
    'password', '123456', '123456789', 'qwerty', 'abc123',
    'password123', '111111', '1234567890', 'admin', 'letmein'
  ];
  
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Heslo je příliš obvyklé');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};