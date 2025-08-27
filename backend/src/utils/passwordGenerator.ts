import * as crypto from 'crypto';

export interface PasswordOptions {
  length?: number;
  includeUppercase?: boolean;
  includeLowercase?: boolean;
  includeNumbers?: boolean;
  includeSpecialChars?: boolean;
  excludeSimilar?: boolean;
}

const DEFAULT_OPTIONS: Required<PasswordOptions> = {
  length: 12,
  includeUppercase: true,
  includeLowercase: true,
  includeNumbers: true,
  includeSpecialChars: true,
  excludeSimilar: true
};

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SPECIAL_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

// Characters that might be confused when reading (0, O, l, 1, etc.)
const SIMILAR_CHARS = '0Ol1I';

/**
 * Generate a cryptographically secure random password
 */
export function generateSecurePassword(options: PasswordOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Validate length constraints
  if (opts.length < 4) {
    throw new Error('Password length must be at least 4 characters');
  }
  if (opts.length > 128) {
    throw new Error('Password length cannot exceed 128 characters');
  }
  
  let charset = '';
  let requiredChars = '';

  if (opts.includeUppercase) {
    const upperChars = opts.excludeSimilar 
      ? UPPERCASE.split('').filter(char => !SIMILAR_CHARS.includes(char)).join('')
      : UPPERCASE;
    
    // Guard against empty character set after filtering
    if (upperChars.length === 0) {
      throw new Error('No uppercase characters available after filtering similar characters');
    }
    
    charset += upperChars;
    requiredChars += upperChars[crypto.randomInt(0, upperChars.length)];
  }

  if (opts.includeLowercase) {
    const lowerChars = opts.excludeSimilar 
      ? LOWERCASE.split('').filter(char => !SIMILAR_CHARS.includes(char)).join('')
      : LOWERCASE;
    
    // Guard against empty character set after filtering
    if (lowerChars.length === 0) {
      throw new Error('No lowercase characters available after filtering similar characters');
    }
    
    charset += lowerChars;
    requiredChars += lowerChars[crypto.randomInt(0, lowerChars.length)];
  }

  if (opts.includeNumbers) {
    const numberChars = opts.excludeSimilar 
      ? NUMBERS.split('').filter(char => !SIMILAR_CHARS.includes(char)).join('')
      : NUMBERS;
    
    // Guard against empty character set after filtering
    if (numberChars.length === 0) {
      throw new Error('No number characters available after filtering similar characters');
    }
    
    charset += numberChars;
    requiredChars += numberChars[crypto.randomInt(0, numberChars.length)];
  }

  if (opts.includeSpecialChars) {
    // Special characters don't get filtered for similar chars, but add guard for consistency
    if (SPECIAL_CHARS.length === 0) {
      throw new Error('No special characters available');
    }
    
    charset += SPECIAL_CHARS;
    requiredChars += SPECIAL_CHARS[crypto.randomInt(0, SPECIAL_CHARS.length)];
  }

  if (charset.length === 0) {
    throw new Error('At least one character type must be included');
  }

  // Generate remaining characters
  const remainingLength = Math.max(0, opts.length - requiredChars.length);
  let password = requiredChars;

  for (let i = 0; i < remainingLength; i++) {
    const randomIndex = crypto.randomInt(0, charset.length);
    password += charset[randomIndex];
  }

  // Shuffle the password to avoid predictable patterns
  return shuffleString(password);
}

/**
 * Shuffle string characters using Fisher-Yates algorithm
 */
function shuffleString(str: string): string {
  const array = str.split('');
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    // Safe array access - indices are controlled by loop bounds
    const temp = array[i] as string;
    array[i] = array[j] as string;
    array[j] = temp;
  }
  return array.join('');
}

/**
 * Generate a user-friendly password (easier to read/type)
 */
export function generateFriendlyPassword(length = 12): string {
  return generateSecurePassword({
    length,
    includeUppercase: true,
    includeLowercase: true,
    includeNumbers: true,
    includeSpecialChars: false, // Exclude special chars for easier typing
    excludeSimilar: true
  });
}

/**
 * Generate a strong password with all character types
 */
export function generateStrongPassword(length = 16): string {
  return generateSecurePassword({
    length,
    includeUppercase: true,
    includeLowercase: true,
    includeNumbers: true,
    includeSpecialChars: true,
    excludeSimilar: true
  });
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): {
  score: number;
  feedback: string[];
  isStrong: boolean;
} {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length >= 12) {
    score += 2;
  } else if (password.length >= 8) {
    score += 1;
  } else {
    feedback.push('Password should be at least 8 characters');
  }

  // Character variety checks
  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Add lowercase letters');
  }

  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Add uppercase letters');
  }

  if (/[0-9]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Add numbers');
  }

  if (/[^a-zA-Z0-9]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Add special characters');
  }

  // Common patterns check
  if (!/(.)\1{2,}/.test(password)) {
    score += 1;
  } else {
    feedback.push('Avoid repeated characters');
  }

  return {
    score,
    feedback,
    isStrong: score >= 5
  };
}