import { Router, Request, Response } from 'express';
import { sendEmail, testConnection } from '../../services/emailService';
import {
  getQueueStatus,
  forceProcessQueue,
  getQueuedEmails,
} from '../../services/emailRetryService';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';

const router = Router();

// Test email connection
router.get(
  '/test-connection',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const result = await testConnection();
      if (result) {
        return ResponseHelper.success(res, {
          service: process.env.EMAIL_SERVICE,
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          from: process.env.FROM_EMAIL,
        }, 'Email service is configured correctly');
      } else {
        return ResponseHelper.internalError(res, undefined, 'Email service connection failed');
      }
    } catch (error) {
      logger.error('Email test connection failed:', error as Error);
      return ResponseHelper.error(res, { code: 'INTERNAL_ERROR', message: 'Email service connection failed', details: { error: (error as Error).message } }, 500, error as Error, 'TestEmailRoutes');
    }
  }
);

// Send test email (respects queuing for production systems)
router.post('/send-test', authenticate, async (req: Request, res: Response) => {
  try {
    const { to } = req.body;

    // Validate email parameter
    if (!to || typeof to !== 'string') {
      return ResponseHelper.badRequest(res, 'Valid recipient email is required');
    }

    // Trim and validate email format
    const email = to.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return ResponseHelper.badRequest(res, 'Invalid email format');
    }

    await sendEmail({
      to: email,
      subject: 'SpheroSeg Test Email',
      html: `
        <h2>Test Email from SpheroSeg Platform</h2>
        <p>This is a test email to verify that the email service is working correctly.</p>
        <p>Configuration:</p>
        <ul>
          <li>SMTP Host: ${process.env.SMTP_HOST}</li>
          <li>SMTP Port: ${process.env.SMTP_PORT}</li>
          <li>From: ${process.env.FROM_EMAIL}</li>
        </ul>
        <p>If you received this email, the configuration is working!</p>
      `,
      text: `Test Email from SpheroSeg Platform

This is a test email to verify that the email service is working correctly.

Configuration:
- SMTP Host: ${process.env.SMTP_HOST}
- SMTP Port: ${process.env.SMTP_PORT}
- From: ${process.env.FROM_EMAIL}

If you received this email, the configuration is working!`,
    });

    return ResponseHelper.success(res, undefined, `Test email sent successfully to ${to}`);
  } catch (error) {
    logger.error('Failed to send test email:', error as Error);
    return ResponseHelper.error(res, { code: 'INTERNAL_ERROR', message: 'Failed to send test email', details: { error: (error as Error).message } }, 500, error as Error, 'TestEmailRoutes');
  }
});

// Send test email directly (bypasses queuing for immediate testing)
router.post(
  '/send-direct',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { to } = req.body;

      // Validate email parameter
      if (!to || typeof to !== 'string') {
        return ResponseHelper.badRequest(res, 'Valid recipient email is required');
      }

      // Trim and validate email format
      const email = to.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        return ResponseHelper.badRequest(res, 'Invalid email format');
      }

      const startTime = Date.now();

      // Send email directly without queuing (allowQueue = false)
      await sendEmail(
        {
          to: email,
          subject: 'SpheroSeg Direct Test Email',
          html: `
        <h2>Direct Test Email from SpheroSeg Platform</h2>
        <p>This is a direct test email (bypassing queue) to verify immediate email sending.</p>
        <p>Configuration:</p>
        <ul>
          <li>SMTP Host: ${process.env.SMTP_HOST}</li>
          <li>SMTP Port: ${process.env.SMTP_PORT}</li>
          <li>SMTP Auth: ${process.env.SMTP_AUTH}</li>
          <li>From: ${process.env.FROM_EMAIL}</li>
          <li>Test Mode: Direct Send</li>
        </ul>
        <p><strong>Sent at:</strong> ${new Date().toISOString()}</p>
        <p>If you received this email, the direct send configuration is working!</p>
      `,
          text: `Direct Test Email from SpheroSeg Platform
      
This is a direct test email (bypassing queue) to verify immediate email sending.

Configuration:
- SMTP Host: ${process.env.SMTP_HOST}
- SMTP Port: ${process.env.SMTP_PORT}
- SMTP Auth: ${process.env.SMTP_AUTH}
- From: ${process.env.FROM_EMAIL}
- Test Mode: Direct Send

Sent at: ${new Date().toISOString()}

If you received this email, the direct send configuration is working!`,
        },
        false
      ); // allowQueue = false to force direct send

      const totalTime = Date.now() - startTime;

      return ResponseHelper.success(res, {
        recipient: email,
        sendTime: totalTime,
        timestamp: new Date().toISOString(),
        method: 'direct_send',
        queueBypassed: true,
      }, `Direct test email sent successfully to ${email}`);
    } catch (error) {
      logger.error('Failed to send direct test email:', error as Error);
      return ResponseHelper.error(res, { code: 'INTERNAL_ERROR', message: 'Failed to send direct test email', details: { error: (error as Error).message } }, 500, error as Error, 'TestEmailRoutes');
    }
  }
);

// Get email queue status
router.get(
  '/queue-status',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const status = getQueueStatus();

      return ResponseHelper.success(res, status, `Queue has ${status.length} emails, processing: ${status.processing}`);
    } catch (error) {
      logger.error('Failed to get queue status:', error as Error);
      return ResponseHelper.error(res, { code: 'INTERNAL_ERROR', message: 'Failed to get queue status', details: { error: (error as Error).message } }, 500, error as Error, 'TestEmailRoutes');
    }
  }
);

// Force process email queue
router.post(
  '/force-queue-process',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      logger.info(
        'Manual queue processing requested via API',
        'TestEmailRoutes'
      );

      await forceProcessQueue();

      const newStatus = getQueueStatus();

      return ResponseHelper.success(res, newStatus, 'Queue processing completed');
    } catch (error) {
      logger.error('Failed to force process queue:', error as Error);
      return ResponseHelper.error(res, { code: 'INTERNAL_ERROR', message: 'Failed to force process queue', details: { error: (error as Error).message } }, 500, error as Error, 'TestEmailRoutes');
    }
  }
);

// Get detailed queue contents
router.get(
  '/queue-emails',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const emails = getQueuedEmails();

      return ResponseHelper.success(res, {
        emails: emails.map(email => ({
          id: email.id,
          to: email.options.to,
          subject: email.options.subject,
          createdAt: email.createdAt,
          attempts: email.attempts,
          lastError: email.lastError,
        })),
        count: emails.length,
      });
    } catch (error) {
      logger.error('Failed to get queue emails:', error as Error);
      return ResponseHelper.error(res, { code: 'INTERNAL_ERROR', message: 'Failed to get queue emails', details: { error: (error as Error).message } }, 500, error as Error, 'TestEmailRoutes');
    }
  }
);

export default router;
