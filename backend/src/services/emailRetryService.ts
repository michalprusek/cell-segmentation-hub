/**
 * Enhanced Email Service with Retry Logic
 * Provides exponential backoff retry for transient email failures
 */

import { SendMailOptions } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { logger } from '../utils/logger';
import { getNumericEnvVar, getBooleanEnvVar } from '../utils/envValidator';
import { EmailServiceOptions } from './emailService';

// Helper function to parse email timeout values - optimized defaults
export function parseEmailTimeout(envVar: string, defaultValue: number = 15000): number {
  return getNumericEnvVar(envVar, defaultValue);
}

// Retry configuration interface
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

// Default retry configuration - optimized for 45s total timeout
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: getNumericEnvVar('EMAIL_MAX_RETRIES', 2),
  initialDelay: getNumericEnvVar('EMAIL_RETRY_INITIAL_DELAY', 1000),
  maxDelay: getNumericEnvVar('EMAIL_RETRY_MAX_DELAY', 10000),
  backoffFactor: parseFloat(process.env.EMAIL_RETRY_BACKOFF_FACTOR || '2'),
};

/**
 * Determine if an error is retriable
 */
export function isRetriableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  // Network errors
  if (message.includes('econnrefused') || 
      message.includes('enotfound') || 
      message.includes('etimedout') ||
      message.includes('econnreset') ||
      message.includes('socket') ||
      message.includes('timeout')) {
    return true;
  }
  
  // SMTP temporary errors (4xx codes)
  if (message.includes('421') || // Service not available
      message.includes('450') || // Mailbox unavailable
      message.includes('451') || // Local error
      message.includes('452')) { // Insufficient storage
    return true;
  }
  
  // Rate limiting
  if (message.includes('rate limit') || 
      message.includes('too many') ||
      message.includes('throttl')) {
    return true;
  }
  
  // Do not retry authentication or permanent errors
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
  transporter: any,
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
  transporter: any,
  config: any,
  options: EmailServiceOptions,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<SMTPTransport.SentMessageInfo> {
  // Global fail-safe timeout to prevent 504 errors
  const GLOBAL_EMAIL_TIMEOUT = getNumericEnvVar('EMAIL_GLOBAL_TIMEOUT', 30000); // 30 seconds total
  const startTime = Date.now();
  
  let lastError: Error | null = null;
  let delay = retryConfig.initialDelay;
  
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      // Check if we're approaching global timeout
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime >= GLOBAL_EMAIL_TIMEOUT - 5000) { // 5s buffer
        logger.warn('Email operation approaching global timeout, aborting retries', 'EmailRetryService', {
          to: options.to,
          subject: options.subject,
          elapsedTime,
          globalTimeout: GLOBAL_EMAIL_TIMEOUT
        });
        throw new Error('Email operation timeout - queued for background retry');
      }
      
      if (attempt > 0) {
        logger.info(`Retrying email send (attempt ${attempt}/${retryConfig.maxRetries})`, 'EmailRetryService', {
          to: options.to,
          subject: options.subject,
          delay,
          elapsedTime
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      if (!transporter || !config) {
        throw new Error('Email service not properly initialized.');
      }

      const mailOptions: SendMailOptions = {
        from: `"${config.from.name}" <${config.from.email}>`,
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
        attempt: attempt > 0 ? attempt : undefined,
        totalTime
      });
      
      return result;
      
    } catch (error) {
      lastError = error as Error;
      
      const retriable = isRetriableError(lastError);
      const elapsedTime = Date.now() - startTime;
      
      // Don't retry if we're close to global timeout or error is not retriable
      if (!retriable || attempt === retryConfig.maxRetries || elapsedTime >= GLOBAL_EMAIL_TIMEOUT - 10000) {
        logger.error('Failed to send email after retries:', lastError, 'EmailRetryService', {
          to: options.to,
          subject: options.subject,
          attempt,
          retriable,
          elapsedTime,
          globalTimeout: GLOBAL_EMAIL_TIMEOUT
        });
        throw new Error(`Failed to send email: ${lastError.message}`);
      }
      
      logger.warn(`Email send attempt ${attempt + 1} failed, will retry`, 'EmailRetryService', {
        to: options.to,
        subject: options.subject,
        error: lastError.message,
        elapsedTime
      });
      
      // Calculate next delay with exponential backoff
      delay = Math.min(delay * retryConfig.backoffFactor, retryConfig.maxDelay);
    }
  }
  
  const totalTime = Date.now() - startTime;
  throw new Error(`Failed to send email after ${retryConfig.maxRetries} retries (${totalTime}ms): ${lastError?.message}`);
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
export function updateEmailMetrics(success: boolean, retries: number = 0, error?: Error): void {
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
    processEmailQueue().catch(error => {
      logger.error('Error processing email queue:', error as Error, 'EmailRetryService');
    });
  }
  
  return queuedEmail.id;
}

/**
 * Process background email queue with extended timeouts for UTIA
 */
async function processEmailQueue(): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;
  
  logger.info('Starting email queue processing', 'EmailRetryService', { 
    queueLength: emailQueue.length 
  });
  
  while (emailQueue.length > 0) {
    const queuedEmail = emailQueue.shift();
    if (!queuedEmail) continue;
    
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
      const originalTimeout = process.env.EMAIL_TIMEOUT;
      const originalGlobalTimeout = process.env.EMAIL_GLOBAL_TIMEOUT;
      
      if (isUTIA) {
        // Temporarily increase timeouts for background processing
        process.env.EMAIL_TIMEOUT = '180000'; // 3 minutes for individual send
        process.env.EMAIL_GLOBAL_TIMEOUT = '300000'; // 5 minutes total
        
        logger.info('Using extended timeouts for UTIA SMTP background processing', 'EmailRetryService', {
          emailTimeout: '180s',
          globalTimeout: '300s'
        });
      }
      
      try {
        // Import the email service dynamically to avoid circular dependency
        const { sendEmail } = await import('./emailService');
        
        // Send email without queuing (allowQueue = false to prevent infinite loop)
        await sendEmail(queuedEmail.options, false);
        
        logger.info('Queued email processed successfully', 'EmailRetryService', {
          id: queuedEmail.id,
          to: queuedEmail.options.to,
          subject: queuedEmail.options.subject,
          attempt: queuedEmail.attempts,
          isUTIA
        });
        
      } finally {
        // Restore original timeouts
        if (isUTIA) {
          if (originalTimeout) process.env.EMAIL_TIMEOUT = originalTimeout;
          else delete process.env.EMAIL_TIMEOUT;
          
          if (originalGlobalTimeout) process.env.EMAIL_GLOBAL_TIMEOUT = originalGlobalTimeout;
          else delete process.env.EMAIL_GLOBAL_TIMEOUT;
        }
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
          error: queuedEmail.lastError
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
export function getQueueStatus(): { length: number; processing: boolean } {
  return {
    length: emailQueue.length,
    processing: queueProcessing
  };
}