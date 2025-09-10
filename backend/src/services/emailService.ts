import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { logger } from '../utils/logger';
import { getNumericEnvVar, getBooleanEnvVar } from '../utils/envValidator';
import { sendEmailWithRetry, parseEmailTimeout, updateEmailMetrics, queueEmailForRetry } from './emailRetryService';
import { generatePasswordResetEmailHTML, generatePasswordResetEmailText, PasswordResetEmailData } from '../templates/passwordResetEmail';
import { generateVerificationEmailHTML } from '../templates/verificationEmail';
import { escapeHtml, sanitizeUrl } from '../utils/escapeHtml';

export interface EmailConfig {
  service: 'smtp' | 'sendgrid';
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  sendgrid?: {
    apiKey: string;
  };
  from: {
    email: string;
    name: string;
  };
}

export interface EmailServiceOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

/* EmailService functions */
let _transporter: Transporter | null = null;
let _config: EmailConfig | null = null;

  /**
   * Initialize email service with configuration
   */
export function init(): void {
    try {
      const config: EmailConfig = {
        service: (process.env.EMAIL_SERVICE as 'smtp' | 'sendgrid') || 'smtp',
        from: {
          email: process.env.FROM_EMAIL || 'noreply@localhost',
          name: process.env.FROM_NAME || 'Cell Segmentation Platform'
        }
      };

      if (config.service === 'smtp') {
        config.smtp = {
          host: process.env.SMTP_HOST || 'mailhog',
          port: parseInt(process.env.SMTP_PORT || '1025'),
          secure: process.env.SMTP_SECURE === 'true',
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || ''
        };

        const transportConfig: SMTPTransport.Options = {
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          ignoreTLS: getBooleanEnvVar('SMTP_IGNORE_TLS', false),
          requireTLS: getBooleanEnvVar('SMTP_REQUIRE_TLS', true) && !getBooleanEnvVar('SMTP_IGNORE_TLS', false),
          // Optimized timeouts for UTIA SMTP server
          connectionTimeout: parseEmailTimeout('SMTP_CONNECTION_TIMEOUT_MS', 15000), // Connection is fast
          greetingTimeout: parseEmailTimeout('SMTP_GREETING_TIMEOUT_MS', 15000), // Greeting is fast  
          socketTimeout: parseEmailTimeout('SMTP_SOCKET_TIMEOUT_MS', 120000), // Extended for UTIA server response delays
          logger: getBooleanEnvVar('SMTP_DEBUG', false) || getBooleanEnvVar('EMAIL_DEBUG', false),
          debug: getBooleanEnvVar('SMTP_DEBUG', false) || getBooleanEnvVar('EMAIL_DEBUG', false),
          // Connection pooling options for UTIA SMTP stability
          pool: true, // Enable pooling with extended timeouts
          maxConnections: 2, // Limited connections to avoid overwhelming server
          maxMessages: 5 // Reuse connections for multiple messages
        };
        
        // Configure TLS settings for UTIA SMTP (port 25 with STARTTLS)
        if (process.env.SMTP_IGNORE_TLS !== 'true') {
          // Special handling for UTIA SMTP server
          if (config.smtp.host === 'mail.utia.cas.cz') {
            transportConfig.requireTLS = true; // Force STARTTLS for UTIA
            transportConfig.tls = {
              // UTIA server certificate validation - disable for production
              rejectUnauthorized: false,
              // Support STARTTLS with minimum TLS 1.2
              minVersion: 'TLSv1.2',
              // Additional UTIA-specific TLS options
              ciphers: 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA'
            };
          } else {
            transportConfig.tls = {
              // Certificate validation enabled by default, only disable with explicit flag
              rejectUnauthorized: process.env.EMAIL_ALLOW_INSECURE !== 'true',
              // Support STARTTLS and direct SSL connections with minimum TLS 1.2
              minVersion: 'TLSv1.2'
              // Note: Don't use secureProtocol with minVersion - they conflict
            };
          }
        }

        // Only include auth if explicitly enabled and credentials are provided
        // Check SMTP_AUTH environment variable to disable auth when not needed
        if (process.env.SMTP_AUTH !== 'false' && config.smtp.user && config.smtp.pass) {
          transportConfig.auth = {
            user: config.smtp.user,
            pass: config.smtp.pass
          };
        }

        logger.info('SMTP Transport Config', 'EmailService', {
          host: transportConfig.host,
          port: transportConfig.port,
          secure: transportConfig.secure,
          requireTLS: transportConfig.requireTLS,
          hasAuth: !!transportConfig.auth,
          authDisabled: process.env.SMTP_AUTH === 'false',
          isUTIAConfig: config.smtp.host === 'mail.utia.cas.cz'
        });
        
        _transporter = nodemailer.createTransport(transportConfig);
      } else if (config.service === 'sendgrid') {
        config.sendgrid = {
          apiKey: process.env.SENDGRID_API_KEY || ''
        };

        // Note: For SendGrid, you would typically use @sendgrid/mail
        // This is a basic SMTP configuration for SendGrid
        _transporter = nodemailer.createTransport({
          host: 'smtp.sendgrid.net',
          port: 587,
          auth: {
            user: 'apikey',
            pass: config.sendgrid.apiKey
          }
        });
      }

      _config = config;
      logger.info('Email service initialized successfully', 'EmailService', { 
        service: config.service,
        host: config.smtp?.host || 'sendgrid'
      });
    } catch (error) {
      logger.error('Failed to initialize email service:', error as Error, 'EmailService');
      throw new Error('Email service initialization failed');
    }
  }

  /**
   * Send email with fail-safe mechanism
   */
export async function sendEmail(options: EmailServiceOptions, allowQueue = true): Promise<void> {
    const retryCount = 0;
    const startTime = Date.now();
    
    try {
      // Skip email sending in test/dev environments if configured
      if (getBooleanEnvVar('SKIP_EMAIL_SEND', false)) {
        logger.warn('Email sending skipped (SKIP_EMAIL_SEND=true)', 'EmailService', {
          to: options.to,
          subject: options.subject
        });
        return;
      }
      
      ensureInitialized();
      
      if (!_transporter || !_config) {
        throw new Error('Email service not properly initialized.');
      }
      
      // Use retry logic for email sending with timeout protection
      const result = await sendEmailWithRetry(_transporter, _config, options);
      
      // Update metrics for successful send
      updateEmailMetrics(true, retryCount);
      
      const totalTime = Date.now() - startTime;
      logger.info('Email sent successfully', 'EmailService', {
        to: options.to,
        subject: options.subject,
        totalTime
      });
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = (error as Error).message;
      
      // Update metrics for failed send
      updateEmailMetrics(false, retryCount, error as Error);
      
      // Check if this is a timeout error and we should queue for background retry
      if (allowQueue && errorMessage.includes('timeout')) {
        logger.warn('Email send timeout, queuing for background retry', 'EmailService', {
          to: options.to,
          subject: options.subject,
          totalTime,
          error: errorMessage
        });
        
        // Queue for background retry
        const queueId = queueEmailForRetry(options);
        
        logger.info('Email queued for background retry due to timeout', 'EmailService', {
          to: options.to,
          subject: options.subject,
          queueId,
          totalTime
        });
        
        // Return success to user to prevent 504 error
        return;
      }
      
      logger.error('Failed to send email:', error as Error, 'EmailService', {
        to: options.to,
        subject: options.subject,
        totalTime
      });
      
      // For non-timeout errors or when queuing is disabled, throw error
      throw new Error(`Failed to send email: ${errorMessage}`);
    }
  }

  /**
   * Send password reset email with secure token link
   */
export async function sendPasswordResetEmail(userEmail: string, resetToken: string, expiresAt: Date): Promise<void> {
    if (process.env.SKIP_EMAIL_SEND === 'true') {
      logger.warn('Password reset email skipped (SKIP_EMAIL_SEND=true)', 'EmailService', {
        userEmail,
        tokenExpiry: expiresAt
      });
      return;
    }
    
    try {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

      const emailData: PasswordResetEmailData = {
        resetToken,
        userEmail,
        resetUrl,
        expiresAt
      };

      const htmlContent = generatePasswordResetEmailHTML(emailData);
      const textContent = generatePasswordResetEmailText(emailData);

      const emailOptions = {
        to: userEmail,
        subject: 'Password Reset - Cell Segmentation Platform',
        html: htmlContent,
        text: textContent
      };

      // For UTIA SMTP server with extreme delays (>2 min response), always queue password reset emails
      if (process.env.SMTP_HOST === 'mail.utia.cas.cz') {
        logger.info('Password reset email queued for background processing (UTIA SMTP)', 'EmailService', { 
          userEmail,
          reason: 'UTIA server has >120s response delays after DATA transmission'
        });
        
        const queueId = queueEmailForRetry(emailOptions);
        
        logger.info('Password reset email queued successfully', 'EmailService', {
          userEmail,
          queueId,
          tokenExpiry: expiresAt
        });
        
        // Return immediately to prevent 504 timeout errors
        return;
      }

      // For other SMTP servers, attempt immediate send
      await sendEmail(emailOptions);

      logger.info('Password reset email sent', 'EmailService', { userEmail });
    } catch (error) {
      logger.error('Failed to send password reset email:', error as Error, 'EmailService', { userEmail });
      throw error;
    }
  }

  /**
   * Send verification email (for future use)
   */
export async function sendVerificationEmail(userEmail: string, verificationToken: string, locale = 'en'): Promise<void> {
    try {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const verificationUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;

      const emailContent = generateVerificationEmailHTML({
        verificationUrl,
        userEmail,
        locale
      });

      await sendEmail({
        to: userEmail,
        subject: emailContent.subject,
        html: emailContent.html
      });

      logger.info('Verification email sent', 'EmailService', { userEmail, locale });
    } catch (error) {
      logger.error('Failed to send verification email:', error as Error, 'EmailService', { userEmail });
      throw error;
    }
  }

  /**
   * Send project share email (for future use)
   */
export async function sendProjectShareEmail(
    recipientEmail: string, 
    senderName: string, 
    projectName: string, 
    projectUrl: string,
    locale = 'en'
  ): Promise<void> {
    try {
      // Simple inline translations for project share email
      // Escape user-provided values
      const escapedSenderName = escapeHtml(senderName);
      const escapedProjectName = escapeHtml(projectName);
      
      const translations = {
        en: {
          subject: `Shared Project: ${escapedProjectName} - Cell Segmentation Platform`,
          title: 'Shared Project',
          body: `${escapedSenderName} has shared the project "${escapedProjectName}" with you.`,
          buttonText: 'View Project',
          altText: 'Or copy and paste this link into your browser:'
        },
        cs: {
          subject: `Sdílený projekt: ${escapedProjectName} - Cell Segmentation Platform`,
          title: 'Sdílený projekt',
          body: `${escapedSenderName} s vámi sdílel projekt "${escapedProjectName}".`,
          buttonText: 'Zobrazit projekt',
          altText: 'Nebo zkopírujte a vložte tento odkaz do prohlížeče:'
        },
        es: {
          subject: `Proyecto compartido: ${escapedProjectName} - Cell Segmentation Platform`,
          title: 'Proyecto compartido',
          body: `${escapedSenderName} ha compartido el proyecto "${escapedProjectName}" contigo.`,
          buttonText: 'Ver proyecto',
          altText: 'O copia y pega este enlace en tu navegador:'
        },
        de: {
          subject: `Geteiltes Projekt: ${escapedProjectName} - Cell Segmentation Platform`,
          title: 'Geteiltes Projekt',
          body: `${escapedSenderName} hat das Projekt "${escapedProjectName}" mit Ihnen geteilt.`,
          buttonText: 'Projekt anzeigen',
          altText: 'Oder kopieren Sie diesen Link und fügen Sie ihn in Ihren Browser ein:'
        },
        fr: {
          subject: `Projet partagé : ${escapedProjectName} - Cell Segmentation Platform`,
          title: 'Projet partagé',
          body: `${escapedSenderName} a partagé le projet "${escapedProjectName}" avec vous.`,
          buttonText: 'Voir le projet',
          altText: 'Ou copiez et collez ce lien dans votre navigateur :'
        },
        zh: {
          subject: `共享项目：${escapedProjectName} - 细胞分割平台`,
          title: '共享项目',
          body: `${escapedSenderName} 与您分享了项目 "${escapedProjectName}"。`,
          buttonText: '查看项目',
          altText: '或将此链接复制并粘贴到您的浏览器中：'
        }
      };

      const t = translations[locale as keyof typeof translations] || translations.en;
      
      // Validate the project URL first
      try {
        new URL(projectUrl);
      } catch (error) {
        throw new Error('Invalid project URL provided');
      }
      
      // Then sanitize the validated URL
      const sanitizedUrl = sanitizeUrl(projectUrl);
      if (!sanitizedUrl) {
        throw new Error('Invalid project URL provided');
      }
      
      const htmlContent = `
        <h2>${escapeHtml(t.title)}</h2>
        <p>${t.body}</p>
        <a href="${sanitizedUrl}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
          ${escapeHtml(t.buttonText)}
        </a>
        <p>${escapeHtml(t.altText)}</p>
        <p>${escapeHtml(sanitizedUrl)}</p>
      `;

      const textContent = `
        ${t.title}
        
        ${t.body}
        
        ${t.buttonText}: ${projectUrl}
      `;

      await sendEmail({
        to: recipientEmail,
        subject: t.subject,
        html: htmlContent,
        text: textContent
      });

      logger.info('Project share email sent', 'EmailService', { recipientEmail, projectName, locale });
    } catch (error) {
      logger.error('Failed to send project share email:', error as Error, 'EmailService', { 
        recipientEmail, 
        projectName 
      });
      throw error;
    }
  }

  /**
   * Test email configuration
   */
export async function testConnection(): Promise<boolean> {
    try {
      if (!_transporter) {
        throw new Error('Email service not initialized');
      }

      await _transporter.verify();
      logger.info('Email service connection test successful', 'EmailService');
      return true;
    } catch (error) {
      logger.error('Email service connection test failed:', error as Error, 'EmailService');
      return false;
    }
  }

/**
 * Initialize email service - should be called from server startup
 */
export async function initializeEmailService(): Promise<void> {
  if (process.env.NODE_ENV !== 'test' && (process.env.SMTP_HOST || process.env.SENDGRID_API_KEY)) {
    try {
      init(); // Changed to sync call since init() is not async
      logger.info('Email service initialized successfully', 'EmailService');
    } catch (error) {
      logger.error('Failed to initialize email service', error as Error, 'EmailService');
      // Don't throw - allow app to start even if email fails
    }
  } else {
    logger.info('Email service skipped (test mode or no configuration)', 'EmailService');
  }
}

/**
 * Ensure email service is initialized before use
 */
function ensureInitialized(): void {
  if (!_transporter) {
    throw new Error('Email service not initialized. Call init() first.');
  }
}