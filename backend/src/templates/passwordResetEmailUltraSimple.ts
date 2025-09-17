/**
 * PLAIN TEXT ONLY template for UTIA SMTP
 * - NO HTML at all
 * - Minimal text
 * - Just the link
 */

export interface PasswordResetEmailData {
  resetToken: string;
  userEmail: string;
  resetUrl: string;
  expiresAt: Date;
}

// NOT USED - kept for compatibility
export const generateUltraSimpleHTML = (data: PasswordResetEmailData): string => {
  return '';
};

// ULTRA MINIMAL plain text
export const generateUltraSimpleText = (data: PasswordResetEmailData): string => {
  return `Password reset for ${data.userEmail}

${data.resetUrl}`;
};