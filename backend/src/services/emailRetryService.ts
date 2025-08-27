/**
 * Enhanced Email Service with Retry Logic
 * Provides exponential backoff retry for transient email failures
 */

import { SendMailOptions } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { logger } from '../utils/logger';
import { getNumericEnvVar, getBooleanEnvVar as _getBooleanEnvVar } from '../utils/envValidator';
import { EmailServiceOptions } from './emailService';

// Helper function to parse email timeout values
export function parseEmailTimeout(envVar: string, defaultValue = 60000): number {
  return getNumericEnvVar(envVar, defaultValue);
}

// Retry configuration interface
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

// Default retry configuration
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: getNumericEnvVar('EMAIL_MAX_RETRIES', 3),
  initialDelay: getNumericEnvVar('EMAIL_RETRY_INITIAL_DELAY', 1000),
  maxDelay: getNumericEnvVar('EMAIL_RETRY_MAX_DELAY', 30000),
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
 * Send email with timeout wrapper
 */
export async function sendMailWithTimeout(
  transporter: Record<string, unknown>,
  mailOptions: SendMailOptions
): Promise<SMTPTransport.SentMessageInfo> {
  const EMAIL_TIMEOUT = parseEmailTimeout('EMAIL_TIMEOUT', 60000);
  
  return new Promise<SMTPTransport.SentMessageInfo>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Email send timeout after ${EMAIL_TIMEOUT/1000} seconds`));
    }, EMAIL_TIMEOUT);
    
    transporter.sendMail(mailOptions)
      .then((result: SMTPTransport.SentMessageInfo) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Send email with retry logic using exponential backoff
 */
export async function sendEmailWithRetry(
  transporter: Record<string, unknown>,
  config: Record<string, unknown>,
  options: EmailServiceOptions,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<SMTPTransport.SentMessageInfo> {
  let lastError: Error | null = null;
  let delay = retryConfig.initialDelay;
  
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        logger.info(`Retrying email send (attempt ${attempt}/${retryConfig.maxRetries})`, 'EmailRetryService', {
          to: options.to,
          subject: options.subject,
          delay
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
      
      logger.info('Email sent successfully', 'EmailRetryService', { 
        to: options.to,
        subject: options.subject,
        messageId: result.messageId,
        attempt: attempt > 0 ? attempt : undefined
      });
      
      return result;
      
    } catch (error) {
      lastError = error as Error;
      
      const retriable = isRetriableError(lastError);
      
      if (!retriable || attempt === retryConfig.maxRetries) {
        logger.error('Failed to send email after retries:', lastError, 'EmailRetryService', {
          to: options.to,
          subject: options.subject,
          attempt,
          retriable
        });
        throw new Error(`Failed to send email: ${lastError.message}`);
      }
      
      logger.warn(`Email send attempt ${attempt + 1} failed, will retry`, 'EmailRetryService', {
        to: options.to,
        subject: options.subject,
        error: lastError.message
      });
      
      // Calculate next delay with exponential backoff
      delay = Math.min(delay * retryConfig.backoffFactor, retryConfig.maxDelay);
    }
  }
  
  throw new Error(`Failed to send email after ${retryConfig.maxRetries} retries: ${lastError?.message}`);
}

/**
 * Email metrics for monitoring
 */
export interface EmailMetrics {
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