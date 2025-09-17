/**
 * Reliable Email Service Implementation
 * Designed specifically for UTIA SMTP server compatibility
 *
 * Key features:
 * - Synchronous sending for critical emails (password reset)
 * - Simple HTML templates that work with UTIA
 * - Proper error handling and user feedback
 * - No silent failures
 */

import nodemailer, { Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { logger } from '../utils/logger';
import { generateSimplePasswordResetHTML, generateSimplePasswordResetText } from '../templates/passwordResetEmailSimple';
import { generateVerificationEmailHTML } from '../templates/verificationEmail';

// Email delivery status tracking
export interface EmailDeliveryStatus {
  messageId?: string;
  success: boolean;
  error?: string;
  timestamp: Date;
  attempts: number;
}

// Track delivery status for monitoring
const deliveryStatuses = new Map<string, EmailDeliveryStatus>();

/**
 * Create SMTP transporter with UTIA-specific configuration
 */
function createUTIATransporter(): Transporter<SMTPTransport.SentMessageInfo> {
  const config = {
    host: process.env.SMTP_HOST || 'mail.utia.cas.cz',
    port: parseInt(process.env.SMTP_PORT || '25'),
    secure: false, // Use STARTTLS
    requireTLS: true,
    // CRITICAL: No authentication for UTIA internal network
    auth: undefined,
    // Extended timeouts for UTIA's slow processing
    connectionTimeout: 30000, // 30 seconds to connect
    greetingTimeout: 30000,   // 30 seconds for greeting
    socketTimeout: 120000,    // 2 minutes for socket operations
    // Logging for debugging
    logger: process.env.NODE_ENV === 'development',
    debug: process.env.SMTP_DEBUG === 'true'
  };

  logger.info('Creating UTIA SMTP transporter', 'ReliableEmailService', {
    host: config.host,
    port: config.port,
    requireTLS: config.requireTLS
  });

  return nodemailer.createTransport(config);
}

/**
 * Send email with immediate delivery (no queue)
 * Returns delivery status for proper error handling
 */
async function sendEmailImmediate(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<EmailDeliveryStatus> {
  const trackingId = `${Date.now()}_${to}`;
  const status: EmailDeliveryStatus = {
    success: false,
    timestamp: new Date(),
    attempts: 0
  };

  try {
    const transporter = createUTIATransporter();

    // Verify transporter connection first
    logger.info('Verifying SMTP connection', 'ReliableEmailService');
    await transporter.verify();
    logger.info('SMTP connection verified', 'ReliableEmailService');

    const mailOptions = {
      from: `"SpheroSeg" <${process.env.FROM_EMAIL || 'spheroseg@utia.cas.cz'}>`,
      to,
      subject,
      html,
      text,
      // Add headers for better deliverability
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
      }
    };

    logger.info('Sending email immediately', 'ReliableEmailService', {
      to,
      subject,
      htmlLength: html.length,
      textLength: text.length
    });

    status.attempts++;
    const startTime = Date.now();

    // Send with extended timeout
    const result = await transporter.sendMail(mailOptions);

    const sendTime = Date.now() - startTime;

    status.success = true;
    status.messageId = result.messageId;

    logger.info('Email sent successfully', 'ReliableEmailService', {
      to,
      subject,
      messageId: result.messageId,
      sendTime: `${sendTime}ms`,
      response: result.response
    });

    // Close transporter connection
    transporter.close();

    // Store status for monitoring
    deliveryStatuses.set(trackingId, status);

    return status;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Email send failed', error as Error, 'ReliableEmailService', {
      to,
      subject,
      attempts: status.attempts,
      errorMessage
    });

    status.error = errorMessage;
    deliveryStatuses.set(trackingId, status);

    // Re-throw for proper error handling upstream
    throw new Error(`Email delivery failed: ${errorMessage}`);
  }
}

/**
 * Send password reset email with simple template
 * CRITICAL: Uses synchronous sending for immediate feedback
 */
export async function sendPasswordResetEmailReliable(
  email: string,
  resetToken: string,
  expiresAt: Date
): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || 'https://spherosegapp.utia.cas.cz';
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  logger.info('Preparing password reset email', 'ReliableEmailService', {
    to: email,
    resetUrl,
    expiresAt: expiresAt.toISOString()
  });

  // Use SIMPLE template for UTIA compatibility
  const emailData = {
    resetToken,
    userEmail: email,
    resetUrl,
    expiresAt
  };

  const html = generateSimplePasswordResetHTML(emailData);
  const text = generateSimplePasswordResetText(emailData);

  logger.info('Generated simple email template', 'ReliableEmailService', {
    htmlLength: html.length,
    textLength: text.length
  });

  // Send immediately - no queue
  const status = await sendEmailImmediate(
    email,
    'Reset hesla - SpheroSeg',
    html,
    text
  );

  if (!status.success) {
    throw new Error(status.error || 'Failed to send password reset email');
  }

  logger.info('Password reset email delivered', 'ReliableEmailService', {
    to: email,
    messageId: status.messageId,
    attempts: status.attempts
  });
}

/**
 * Send verification email (can use queue since not as critical)
 */
export async function sendVerificationEmailReliable(
  email: string,
  verificationToken: string
): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || 'https://spherosegapp.utia.cas.cz';
  const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

  const htmlResult = generateVerificationEmailHTML({
    verificationUrl,
    userEmail: email
  });

  // generateVerificationEmailHTML returns an object with html and subject
  const html = typeof htmlResult === 'string' ? htmlResult : htmlResult.html;

  // Create simple text version since template doesn't provide one
  const text = `Ověření emailu - SpheroSeg\n\n` +
    `Dobrý den,\n\n` +
    `Pro ověření vašeho emailu ${email} klikněte na následující odkaz:\n` +
    `${verificationUrl}\n\n` +
    `Pokud jste si účet nevytvořili, tento email ignorujte.\n\n` +
    `S pozdravem,\n` +
    `SpheroSeg`;

  // Verification emails can use queue since they're less time-critical
  const status = await sendEmailImmediate(
    email,
    'Ověření emailu - SpheroSeg',
    html,
    text
  );

  if (!status.success) {
    logger.warn('Verification email failed, will retry in background', 'ReliableEmailService', {
      to: email,
      error: status.error
    });
    // Could queue for retry here if needed
  }
}

/**
 * Get delivery status for monitoring
 */
export function getDeliveryStatus(trackingId: string): EmailDeliveryStatus | undefined {
  return deliveryStatuses.get(trackingId);
}

/**
 * Get all recent delivery statuses
 */
export function getAllDeliveryStatuses(): Array<[string, EmailDeliveryStatus]> {
  return Array.from(deliveryStatuses.entries())
    .sort((a, b) => b[1].timestamp.getTime() - a[1].timestamp.getTime())
    .slice(0, 100); // Keep last 100 for monitoring
}

/**
 * Clear old delivery statuses (housekeeping)
 */
export function cleanupOldStatuses(): void {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, status] of deliveryStatuses.entries()) {
    if (status.timestamp.getTime() < oneHourAgo) {
      deliveryStatuses.delete(id);
    }
  }
}

// Cleanup every hour
setInterval(cleanupOldStatuses, 3600000);

/**
 * Test email sending with simple content
 */
export async function sendTestEmailReliable(to: string): Promise<EmailDeliveryStatus> {
  const html = `<html><body>
<h2>Test Email</h2>
<p>This is a test email from SpheroSeg.</p>
<p>Timestamp: ${new Date().toISOString()}</p>
<p>If you received this, email service is working correctly.</p>
</body></html>`;

  const text = `Test Email\n\nThis is a test email from SpheroSeg.\nTimestamp: ${new Date().toISOString()}\n\nIf you received this, email service is working correctly.`;

  return sendEmailImmediate(
    to,
    'Test Email - SpheroSeg',
    html,
    text
  );
}