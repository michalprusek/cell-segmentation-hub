/**
 * Enhanced Email Service with Retry Logic
 * Provides exponential backoff retry for transient email failures
 */

import { SendMailOptions } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { logger } from '../utils/logger';
import { getNumericEnvVar } from '../utils/envValidator';
import { EmailServiceOptions } from './emailService';
import { retryService, RetryService } from '../utils/retryService';
import {
  EMAIL_RETRY,
  EMAIL_TIMEOUTS,
  getMaxRetryAttempts,
  getQueueProcessingDelay,
  isUTIASmtpServer,
} from '../constants/email';

// Track successfully sent emails to prevent duplicates
interface SentEmailRecord {
  to: string;
  subject: string;
  sentAt: Date;
}

// Keep records for 24 hours
const sentEmails = new Map<string, SentEmailRecord>();

/**
 * Generate unique key for email deduplication
 */
function getEmailKey(to: string, subject: string): string {
  return `${to.toLowerCase()}:${subject.toLowerCase()}`;
}

/**
 * Check if email was already sent recently
 */
function wasEmailAlreadySent(to: string, subject: string): boolean {
  const key = getEmailKey(to, subject);
  const record = sentEmails.get(key);

  if (!record) return false;

  const age = Date.now() - record.sentAt.getTime();
  if (age > EMAIL_RETRY.SENT_EMAIL_TTL) {
    sentEmails.delete(key); // Expired, remove
    return false;
  }

  return true;
}

/**
 * Record that email was sent successfully
 */
function recordEmailSent(to: string, subject: string): void {
  const key = getEmailKey(to, subject);
  sentEmails.set(key, {
    to,
    subject,
    sentAt: new Date(),
  });

  logger.info('Email recorded as sent successfully', 'EmailRetryService', {
    to,
    subject,
    key,
  });
}

/**
 * Cleanup old sent email records periodically
 */
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, record] of Array.from(sentEmails.entries())) {
    const age = now - record.sentAt.getTime();
    if (age > EMAIL_RETRY.SENT_EMAIL_TTL) {
      sentEmails.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info('Cleaned up old sent email records', 'EmailRetryService', { cleaned });
  }
}, EMAIL_RETRY.CLEANUP_INTERVAL);

// Helper function to parse email timeout values - optimized defaults
export function parseEmailTimeout(
  envVar: string,
  defaultValue = 15000
): number {
  return getNumericEnvVar(envVar, defaultValue);
}

// Email-specific retry configuration interface
export interface EmailRetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  globalTimeout?: number;
}

// Default retry configuration - optimized for UTIA SMTP
export const DEFAULT_EMAIL_RETRY_CONFIG: EmailRetryConfig = {
  maxRetries: getNumericEnvVar('EMAIL_MAX_RETRIES', 2), // 2 attempts total (1st + 1 retry)
  initialDelay: getNumericEnvVar('EMAIL_RETRY_INITIAL_DELAY', 1000),
  maxDelay: getNumericEnvVar('EMAIL_RETRY_MAX_DELAY', 10000),
  backoffFactor: parseFloat(process.env.EMAIL_RETRY_BACKOFF_FACTOR || '2'),
  // Global timeout must be longer than individual send timeout + retries
  // For UTIA: 300s per attempt * 2 attempts = 660s minimum
  globalTimeout: getNumericEnvVar('EMAIL_GLOBAL_TIMEOUT', 660000), // 11 minutes for UTIA compatibility
};

/**
 * Determine if an email error is retriable - uses shared logic plus email-specific rules
 */
export function isRetriableEmailError(error: Error): boolean {
  // Check common retriable errors first
  if (RetryService.isCommonRetriableError(error)) {
    return true;
  }

  const message = error.message.toLowerCase();

  // Do not retry authentication or permanent email errors
  if (
    message.includes('auth') ||
    message.includes('550') || // User not found
    message.includes('551') || // User not local
    message.includes('553') || // Mailbox name not allowed
    message.includes('554')
  ) {
    // Transaction failed
    return false;
  }

  // Default to retriable for unknown errors
  return true;
}

/**
 * Send email with timeout wrapper - optimized for quick failures
 */
export async function sendMailWithTimeout(
  transporter: {
    sendMail: (
      options: SendMailOptions
    ) => Promise<SMTPTransport.SentMessageInfo>;
  },
  mailOptions: SendMailOptions
): Promise<SMTPTransport.SentMessageInfo> {
  // Use appropriate timeout for current SMTP server
  // For UTIA: 300s (5 minutes), For others: 30s
  const EMAIL_TIMEOUT = isUTIASmtpServer() 
    ? EMAIL_TIMEOUTS.UTIA_SEND 
    : parseEmailTimeout('EMAIL_TIMEOUT', EMAIL_TIMEOUTS.SEND);

  // Create timeout promise that ALWAYS rejects after timeout
  const timeoutPromise = new Promise<SMTPTransport.SentMessageInfo>(
    (_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Email send timeout after ${EMAIL_TIMEOUT / 1000} seconds${isUTIASmtpServer() ? ' (UTIA SMTP)' : ''}`
          )
        );
      }, EMAIL_TIMEOUT);
    }
  );

  // Create email sending promise
  const sendPromise = transporter.sendMail(mailOptions);

  // Race between sending and timeout - whichever finishes first wins
  // This GUARANTEES timeout will fire even if nodemailer hangs
  return Promise.race([sendPromise, timeoutPromise]);
}

/**
 * Send email with retry logic using exponential backoff and fail-safe timeout
 */
export async function sendEmailWithRetry(
  transporter: {
    sendMail: (
      options: SendMailOptions
    ) => Promise<SMTPTransport.SentMessageInfo>;
  },
  config: Record<string, unknown>,
  options: EmailServiceOptions,
  retryConfig: EmailRetryConfig = DEFAULT_EMAIL_RETRY_CONFIG
): Promise<SMTPTransport.SentMessageInfo> {
  const globalTimeout =
    retryConfig.globalTimeout ||
    getNumericEnvVar('EMAIL_GLOBAL_TIMEOUT', 30000);
  const startTime = Date.now();

  const emailOperation = async (): Promise<SMTPTransport.SentMessageInfo> => {
    // Check if we're approaching global timeout
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= globalTimeout - 5000) {
      // 5s buffer
      logger.warn(
        'Email operation approaching global timeout, aborting',
        'EmailRetryService',
        {
          to: options.to,
          subject: options.subject,
          elapsedTime,
          globalTimeout,
        }
      );
      throw new Error('Email operation timeout - queued for background retry');
    }

    if (!transporter || !config) {
      throw new Error('Email service not properly initialized.');
    }

    const fromConfig = config.from as { name: string; email: string };
    const mailOptions: SendMailOptions = {
      from: `"${fromConfig.name}" <${fromConfig.email}>`,
      replyTo: `"${fromConfig.name}" <${fromConfig.email}>`, // Explicit Reply-To for Gmail
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
      headers: {
        'X-Mailer': 'SpheroSeg Email System v1.0',
        'X-Application': 'Cell Segmentation Hub',
        'Return-Path': fromConfig.email,
        'X-Priority': '3', // Normal priority
        'Importance': 'Normal',
        // Help Gmail categorize this as transactional email
        'X-Entity-Type': 'TRANSACTIONAL',
        'Precedence': 'bulk',
      },
    };

    const result = await sendMailWithTimeout(transporter, mailOptions);

    const totalTime = Date.now() - startTime;
    logger.info('Email sent successfully', 'EmailRetryService', {
      to: options.to,
      subject: options.subject,
      messageId: result.messageId,
      totalTime,
    });

    return result;
  };

  return retryService.executeWithRetry(
    emailOperation,
    {
      maxRetries: retryConfig.maxRetries,
      initialDelay: retryConfig.initialDelay,
      maxDelay: retryConfig.maxDelay,
      backoffFactor: retryConfig.backoffFactor,
      operationName: `Email to ${options.to}`,
    },
    isRetriableEmailError
  );
}

/**
 * Email metrics for monitoring
 */
export interface EmailMetrics extends Record<string, unknown> {
  sent: number;
  failed: number;
  retried: number;
  avgRetries: number;
  lastError?: string;
  lastSuccess?: Date;
}

// Global metrics tracking
const emailMetrics: EmailMetrics = {
  sent: 0,
  failed: 0,
  retried: 0,
  avgRetries: 0,
  lastSuccess: undefined,
  lastError: undefined,
};

/**
 * Update email metrics after send attempt
 */
export function updateEmailMetrics(
  success: boolean,
  retries = 0,
  error?: Error
): void {
  if (success) {
    emailMetrics.sent++;
    emailMetrics.lastSuccess = new Date();
    if (retries > 0) {
      emailMetrics.retried++;
      // Update running average of retries
      emailMetrics.avgRetries =
        (emailMetrics.avgRetries * (emailMetrics.retried - 1) + retries) /
        emailMetrics.retried;
    }
  } else {
    emailMetrics.failed++;
    if (error) {
      emailMetrics.lastError = error.message;
    }
  }

  // Log metrics periodically
  if ((emailMetrics.sent + emailMetrics.failed) % 100 === 0) {
    logger.info('Email metrics checkpoint', 'EmailRetryService', emailMetrics);
  }
}

/**
 * Get current email metrics
 */
export function getEmailMetrics(): EmailMetrics {
  return { ...emailMetrics };
}

/**
 * Background email queue for failed attempts
 */
interface QueuedEmail {
  id: string;
  options: EmailServiceOptions;
  createdAt: Date;
  attempts: number;
  globalAttempts: number; // Track attempts across all cycles
  lastError?: string;
  nextRetryAt?: Date; // Track when next retry is scheduled
}

const emailQueue: QueuedEmail[] = [];
let queueProcessing = false;

/**
 * Add email to background queue
 */
export function queueEmailForRetry(options: EmailServiceOptions): string {
  // Check if this email was already sent successfully
  const subject = options.subject || 'No subject';
  if (wasEmailAlreadySent(options.to, subject)) {
    logger.warn('Email already sent recently, skipping queue', 'EmailRetryService', {
      to: options.to,
      subject,
    });
    return 'duplicate-skipped';
  }

  // Check if already in queue
  const existingInQueue = emailQueue.find(
    email => email.options.to === options.to && email.options.subject === subject
  );

  if (existingInQueue) {
    logger.warn('Email already in queue, skipping duplicate', 'EmailRetryService', {
      to: options.to,
      subject,
      existingId: existingInQueue.id,
    });
    return existingInQueue.id;
  }

  const queuedEmail: QueuedEmail = {
    id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    options,
    createdAt: new Date(),
    attempts: 0,
    globalAttempts: 0, // Initialize global attempts
  };

  emailQueue.push(queuedEmail);

  // NOTE: Do NOT call recordEmailSent() here!
  // Email should only be marked as sent AFTER successful SMTP transmission (line 511)
  // Marking it here would cause the queue processor to skip it without sending

  logger.info('Email added to retry queue', 'EmailRetryService', {
    id: queuedEmail.id,
    to: options.to,
    subject: options.subject,
    queueLength: emailQueue.length,
  });

  // Start processing queue if not already running
  if (!queueProcessing) {
    logger.info(
      'Starting email queue processing immediately',
      'EmailRetryService',
      {
        queueLength: emailQueue.length,
      }
    );

    // Use setImmediate to ensure the queue starts processing in next tick
    setImmediate(() => {
      processEmailQueue().catch(error => {
        logger.error(
          'Error starting email queue processing:',
          error as Error,
          'EmailRetryService'
        );
        queueProcessing = false; // Reset flag on error
      });
    });
  } else {
    logger.info('Email queue processing already running', 'EmailRetryService', {
      queueLength: emailQueue.length,
    });
  }

  return queuedEmail.id;
}

/**
 * Process background email queue with extended timeouts for UTIA
 */
async function processEmailQueue(): Promise<void> {
  if (queueProcessing) {
    logger.warn('Queue processing already in progress, skipping', 'EmailRetryService');
    return;
  }

  queueProcessing = true;
  logger.info('Starting email queue processing', 'EmailRetryService', {
    queueLength: emailQueue.length,
  });

  const MAX_QUEUE_AGE_MS = EMAIL_RETRY.QUEUE_TTL; // 1 hour TTL for queued emails
  const MAX_GLOBAL_ATTEMPTS = EMAIL_RETRY.MAX_GLOBAL_ATTEMPTS; // Maximum total attempts across all cycles

  while (emailQueue.length > 0) {
    const queuedEmail = emailQueue.shift();

    if (!queuedEmail) continue;

    // Check TTL - if email is too old, discard it
    const ageMs = Date.now() - queuedEmail.createdAt.getTime();
    if (ageMs > MAX_QUEUE_AGE_MS) {
      logger.error(
        'Email expired in queue (TTL exceeded)',
        new Error(`Email TTL exceeded: ${Math.round(ageMs / 60000)} minutes old`),
        'EmailRetryService',
        {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          ageMinutes: Math.round(ageMs / 60000),
          maxAgeMinutes: Math.round(MAX_QUEUE_AGE_MS / 60000),
        }
      );
      continue; // Skip this email, it's too old
    }

    // Check global attempts - prevent infinite retries
    if (queuedEmail.globalAttempts >= MAX_GLOBAL_ATTEMPTS) {
      logger.error(
        'Email exceeded maximum global attempts',
        new Error(`Email exceeded max attempts: ${queuedEmail.globalAttempts}`),
        'EmailRetryService',
        {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          globalAttempts: queuedEmail.globalAttempts,
          maxGlobalAttempts: MAX_GLOBAL_ATTEMPTS,
        }
      );
      continue; // Skip this email, too many attempts
    }

    // Check if already sent (might have been sent in another process)
    const subject = queuedEmail.options.subject || 'No subject';
    if (wasEmailAlreadySent(queuedEmail.options.to, subject)) {
      logger.info('Email already sent, removing from queue', 'EmailRetryService', {
        id: queuedEmail.id,
        to: queuedEmail.options.to,
      });
      continue; // Skip, already sent
    }

    try {
      queuedEmail.attempts++;
      queuedEmail.globalAttempts++;

      logger.info('Attempting to send queued email', 'EmailRetryService', {
        id: queuedEmail.id,
        to: queuedEmail.options.to,
        attempt: queuedEmail.attempts,
        globalAttempt: queuedEmail.globalAttempts,
      });

      // Import the email service dynamically to avoid circular dependency
      const { sendEmail } = await import('./emailService');

      // Send email without queuing (allowQueue = false to prevent infinite loop)
      await sendEmail(queuedEmail.options, false);

      // SUCCESS! Record that email was sent
      recordEmailSent(queuedEmail.options.to, subject);

      logger.info('Queued email sent successfully', 'EmailRetryService', {
        id: queuedEmail.id,
        to: queuedEmail.options.to,
        attempts: queuedEmail.attempts,
        globalAttempts: queuedEmail.globalAttempts,
      });

      // Email successfully sent, don't re-queue
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      queuedEmail.lastError = errorMessage;

      logger.error(
        `Failed to send queued email (attempt ${queuedEmail.attempts}):`,
        error as Error,
        'EmailRetryService',
        {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          attempt: queuedEmail.attempts,
          globalAttempt: queuedEmail.globalAttempts,
        }
      );

      // Determine max retries based on SMTP host
      const maxRetries = getMaxRetryAttempts();

      if (
        queuedEmail.attempts < maxRetries &&
        queuedEmail.globalAttempts < MAX_GLOBAL_ATTEMPTS
      ) {
        // Re-queue with exponential backoff delay
        const delay = Math.min(queuedEmail.attempts * EMAIL_RETRY.INITIAL_DELAY, EMAIL_RETRY.MAX_DELAY);
        queuedEmail.nextRetryAt = new Date(Date.now() + delay);

        logger.warn('Email will be retried', 'EmailRetryService', {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          attempt: queuedEmail.attempts,
          globalAttempt: queuedEmail.globalAttempts,
          retryInSeconds: Math.round(delay / 1000),
          nextRetryAt: queuedEmail.nextRetryAt.toISOString(),
        });

        setTimeout(() => {
          // Double-check before re-queuing
          if (!wasEmailAlreadySent(queuedEmail.options.to, subject)) {
            emailQueue.push(queuedEmail);

            // Restart queue processing if it stopped
            if (!queueProcessing) {
              processEmailQueue().catch(err => {
                logger.error(
                  'Error restarting email queue processing:',
                  err as Error,
                  'EmailRetryService'
                );
              });
            }
          } else {
            logger.info('Email was sent during retry delay, not re-queuing', 'EmailRetryService', {
              id: queuedEmail.id,
              to: queuedEmail.options.to,
            });
          }
        }, delay);
      } else {
        // Permanently failed - DO NOT RE-QUEUE
        logger.error(
          'Queued email permanently failed after all retries',
          new Error(queuedEmail.lastError || 'Unknown error'),
          'EmailRetryService',
          {
            id: queuedEmail.id,
            to: queuedEmail.options.to,
            subject: queuedEmail.options.subject,
            attempts: queuedEmail.attempts,
            globalAttempts: queuedEmail.globalAttempts,
            lastError: queuedEmail.lastError,
          }
        );

        // Email is already removed from queue by shift(), so nothing more to do
      }
    }

    // Delay between processing emails
    const delayBetweenEmails = getQueueProcessingDelay();
    await new Promise(resolve => setTimeout(resolve, delayBetweenEmails));
  }

  queueProcessing = false;
  logger.info('Email queue processing completed', 'EmailRetryService', {
    remainingInQueue: emailQueue.length,
  });
}

/**
 * Get queue status for monitoring
 */
export function getQueueStatus(): {
  length: number;
  processing: boolean;
  emails: Array<{
    id: string;
    to: string;
    subject: string;
    attempts: number;
    globalAttempts: number;
    nextRetryAt?: string;
  }>;
} {
  return {
    length: emailQueue.length,
    processing: queueProcessing,
    emails: emailQueue.map(email => ({
      id: email.id,
      to: email.options.to,
      subject: email.options.subject,
      attempts: email.attempts,
      globalAttempts: email.globalAttempts,
      nextRetryAt: email.nextRetryAt?.toISOString(),
    })),
  };
}

/**
 * Force process the email queue immediately (for debugging/manual trigger)
 */
export async function forceProcessQueue(): Promise<void> {
  logger.info('Force processing email queue requested', 'EmailRetryService', {
    queueLength: emailQueue.length,
    currentlyProcessing: queueProcessing,
  });

  if (queueProcessing) {
    logger.warn(
      'Email queue already processing, cannot force',
      'EmailRetryService'
    );
    return;
  }

  await processEmailQueue();
}

/**
 * Get all queued emails for inspection
 */
export function getQueuedEmails(): QueuedEmail[] {
  return [...emailQueue];
}

/**
 * Export deduplication helpers for testing
 */
export const testHelpers = {
  wasEmailAlreadySent,
  recordEmailSent,
  getEmailKey,
  clearSentEmails: () => sentEmails.clear(),
};
