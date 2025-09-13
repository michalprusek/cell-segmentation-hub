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

// Helper function to parse email timeout values - optimized defaults
export function parseEmailTimeout(envVar: string, defaultValue = 15000): number {
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

// Default retry configuration - optimized for 45s total timeout
export const DEFAULT_EMAIL_RETRY_CONFIG: EmailRetryConfig = {
  maxRetries: getNumericEnvVar('EMAIL_MAX_RETRIES', 2),
  initialDelay: getNumericEnvVar('EMAIL_RETRY_INITIAL_DELAY', 1000),
  maxDelay: getNumericEnvVar('EMAIL_RETRY_MAX_DELAY', 10000),
  backoffFactor: parseFloat(process.env.EMAIL_RETRY_BACKOFF_FACTOR || '2'),
  globalTimeout: getNumericEnvVar('EMAIL_GLOBAL_TIMEOUT', 30000)
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
  if (message.includes('auth') || 
      message.includes('550') || // User not found
      message.includes('551') || // User not local
      message.includes('553') || // Mailbox name not allowed
      message.includes('554')) { // Transaction failed
    return false;
  }
  
  // Default to retriable for unknown errors
  return true;
}

/**
 * Send email with timeout wrapper - optimized for quick failures
 */
export async function sendMailWithTimeout(
  transporter: { sendMail: (options: SendMailOptions) => Promise<SMTPTransport.SentMessageInfo> },
  mailOptions: SendMailOptions
): Promise<SMTPTransport.SentMessageInfo> {
  // Parse timeout from environment - use 60s default for slow server-side processing
  const EMAIL_TIMEOUT = parseEmailTimeout('EMAIL_TIMEOUT', 60000);
  
  // Create an AbortController for better timeout handling
  const controller = new AbortController();
  
  return new Promise<SMTPTransport.SentMessageInfo>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`Email send timeout after ${EMAIL_TIMEOUT/1000} seconds`));
    }, EMAIL_TIMEOUT);
    
    // Add signal to mail options if supported
    const mailOptionsWithSignal = {
      ...mailOptions,
      // Note: nodemailer doesn't support AbortSignal directly, but this prepares for future updates
    };
    
    transporter.sendMail(mailOptionsWithSignal)
      .then((result: SMTPTransport.SentMessageInfo) => {
        clearTimeout(timeoutId);
        if (!controller.signal.aborted) {
          resolve(result);
        }
      })
      .catch((error: Error) => {
        clearTimeout(timeoutId);
        if (!controller.signal.aborted) {
          reject(error);
        }
      });
  });
}

/**
 * Send email with retry logic using exponential backoff and fail-safe timeout
 */
export async function sendEmailWithRetry(
  transporter: { sendMail: (options: SendMailOptions) => Promise<SMTPTransport.SentMessageInfo> },
  config: Record<string, unknown>,
  options: EmailServiceOptions,
  retryConfig: EmailRetryConfig = DEFAULT_EMAIL_RETRY_CONFIG
): Promise<SMTPTransport.SentMessageInfo> {
  const globalTimeout = retryConfig.globalTimeout || getNumericEnvVar('EMAIL_GLOBAL_TIMEOUT', 30000);
  const startTime = Date.now();
  
  const emailOperation = async (): Promise<SMTPTransport.SentMessageInfo> => {
    // Check if we're approaching global timeout
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= globalTimeout - 5000) { // 5s buffer
      logger.warn('Email operation approaching global timeout, aborting', 'EmailRetryService', {
        to: options.to,
        subject: options.subject,
        elapsedTime,
        globalTimeout
      });
      throw new Error('Email operation timeout - queued for background retry');
    }
    
    if (!transporter || !config) {
      throw new Error('Email service not properly initialized.');
    }

    const fromConfig = config.from as { name: string; email: string };
    const mailOptions: SendMailOptions = {
      from: `"${fromConfig.name}" <${fromConfig.email}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments
    };
    
    const result = await sendMailWithTimeout(transporter, mailOptions);
    
    const totalTime = Date.now() - startTime;
    logger.info('Email sent successfully', 'EmailRetryService', {
      to: options.to,
      subject: options.subject,
      messageId: result.messageId,
      totalTime
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
      operationName: `Email to ${options.to}`
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
export function updateEmailMetrics(success: boolean, retries = 0, error?: Error): void {
  if (success) {
    emailMetrics.sent++;
    emailMetrics.lastSuccess = new Date();
    if (retries > 0) {
      emailMetrics.retried++;
      // Update running average of retries
      emailMetrics.avgRetries = 
        (emailMetrics.avgRetries * (emailMetrics.retried - 1) + retries) / emailMetrics.retried;
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
  lastError?: string;
}

const emailQueue: QueuedEmail[] = [];
let queueProcessing = false;

/**
 * Add email to background queue
 */
export function queueEmailForRetry(options: EmailServiceOptions): string {
  const queuedEmail: QueuedEmail = {
    id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    options,
    createdAt: new Date(),
    attempts: 0
  };
  
  emailQueue.push(queuedEmail);
  
  logger.info('Email queued for background retry', 'EmailRetryService', {
    id: queuedEmail.id,
    to: options.to,
    subject: options.subject,
    queueLength: emailQueue.length
  });
  
  // Start processing queue if not already running
  if (!queueProcessing) {
    logger.info('Starting email queue processing immediately', 'EmailRetryService', {
      queueLength: emailQueue.length
    });
    
    // Use setImmediate to ensure the queue starts processing in next tick
    setImmediate(() => {
      processEmailQueue().catch(error => {
        logger.error('Error processing email queue:', error as Error, 'EmailRetryService');
        queueProcessing = false; // Reset flag on error
      });
    });
  } else {
    logger.info('Email queue processing already running', 'EmailRetryService', {
      queueLength: emailQueue.length
    });
  }
  
  return queuedEmail.id;
}

/**
 * Process background email queue with extended timeouts for UTIA
 */
async function processEmailQueue(): Promise<void> {
  if (queueProcessing) {
    logger.info('Email queue processing already running, skipping', 'EmailRetryService');
    return;
  }
  queueProcessing = true;
  
  logger.info('Starting email queue processing', 'EmailRetryService', { 
    queueLength: emailQueue.length 
  });
  
  while (emailQueue.length > 0) {
    const queuedEmail = emailQueue.shift();
    if (!queuedEmail) {
      continue;
    }
    
    try {
      queuedEmail.attempts++;
      
      logger.info('Processing queued email', 'EmailRetryService', {
        id: queuedEmail.id,
        to: queuedEmail.options.to,
        subject: queuedEmail.options.subject,
        attempt: queuedEmail.attempts
      });
      
      // For UTIA SMTP, use extended timeout configuration
      const isUTIA = process.env.SMTP_HOST === 'mail.utia.cas.cz';
      
      // Don't modify environment variables - pass timeout config directly
      const timeoutConfig = isUTIA ? {
        timeout: 300000, // 5 minutes for UTIA
        socketTimeout: 300000
      } : {
        timeout: parseInt(process.env.EMAIL_TIMEOUT || '60000'),
        socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS || '60000')
      };
      
      if (isUTIA) {
        logger.info('Using extended timeouts for UTIA SMTP background processing', 'EmailRetryService', {
          emailTimeout: '300s',
          socketTimeout: '300s'
        });
      }
      
      try {
        // Import the email service dynamically to avoid circular dependency
        const { sendEmail } = await import('./emailService');
        
        logger.info('Sending email from queue', 'EmailRetryService', {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          attempt: queuedEmail.attempts,
          timeoutConfig
        });
        
        // Send email without queuing (allowQueue = false to prevent infinite loop)
        await sendEmail(queuedEmail.options, false);
        
        logger.info('Queued email processed successfully', 'EmailRetryService', {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          subject: queuedEmail.options.subject,
          attempt: queuedEmail.attempts,
          isUTIA
        });
        
      } catch (sendError) {
        // Log detailed error for debugging
        logger.error('Failed to send email from queue:', sendError as Error, 'EmailRetryService', {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          attempt: queuedEmail.attempts,
          errorMessage: (sendError as Error).message,
          errorStack: (sendError as Error).stack
        });
        throw sendError;
      }
      
    } catch (error) {
      queuedEmail.lastError = (error as Error).message;
      
      // For UTIA SMTP, be more persistent with retries
      const maxRetries = process.env.SMTP_HOST === 'mail.utia.cas.cz' ? 5 : 3;
      
      if (queuedEmail.attempts < maxRetries) {
        logger.warn('Queued email failed, will retry', 'EmailRetryService', {
          id: queuedEmail.id,
          attempt: queuedEmail.attempts,
          maxRetries,
          error: queuedEmail.lastError,
          willRetryIn: `${Math.min(queuedEmail.attempts * 60, 600)} seconds`
        });
        
        // Re-queue with exponential backoff delay
        const delay = Math.min(queuedEmail.attempts * 60000, 600000); // 1-10 minute delay
        setTimeout(() => {
          emailQueue.push(queuedEmail);
          
          // Restart queue processing if it stopped
          if (!queueProcessing) {
            processEmailQueue().catch(err => {
              logger.error('Error restarting email queue processing:', err as Error, 'EmailRetryService');
            });
          }
        }, delay);
        
      } else {
        logger.error('Queued email permanently failed after all retries:', new Error(queuedEmail.lastError || 'Unknown error'), 'EmailRetryService', {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          subject: queuedEmail.options.subject,
          attempts: queuedEmail.attempts,
          maxRetries
        });
      }
    }
    
    // Longer delay between processing UTIA queue items to avoid overwhelming server
    const delay = process.env.SMTP_HOST === 'mail.utia.cas.cz' ? 5000 : 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  queueProcessing = false;
  logger.info('Email queue processing completed', 'EmailRetryService');
}

/**
 * Get queue status for monitoring
 */
export function getQueueStatus(): { length: number; processing: boolean; emails: Array<{id: string; to: string; subject: string; attempts: number}> } {
  return {
    length: emailQueue.length,
    processing: queueProcessing,
    emails: emailQueue.map(email => ({
      id: email.id,
      to: email.options.to,
      subject: email.options.subject,
      attempts: email.attempts
    }))
  };
}

/**
 * Force process the email queue immediately (for debugging/manual trigger)
 */
export async function forceProcessQueue(): Promise<void> {
  logger.info('Force processing email queue requested', 'EmailRetryService', {
    queueLength: emailQueue.length,
    currentlyProcessing: queueProcessing
  });
  
  if (queueProcessing) {
    logger.warn('Email queue already processing, cannot force', 'EmailRetryService');
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