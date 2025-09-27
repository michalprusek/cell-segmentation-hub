import { Router, Request, Response } from 'express';
import { sendEmail, testConnection } from '../../services/emailService';
import {
  getQueueStatus,
  forceProcessQueue,
  getQueuedEmails,
} from '../../services/emailRetryService';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

// Test email connection
router.get(
  '/test-connection',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const result = await testConnection();
      if (result) {
        res.json({
          success: true,
          message: 'Email service is configured correctly',
          config: {
            service: process.env.EMAIL_SERVICE,
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            from: process.env.FROM_EMAIL,
          },
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Email service connection failed',
        });
      }
    } catch (error) {
      logger.error('Email test connection failed:', error as Error);
      res.status(500).json({
        success: false,
        message: 'Email service connection failed',
        error: (error as Error).message,
      });
    }
  }
);

// Send test email (respects queuing for production systems)
router.post('/send-test', authenticate, async (req: Request, res: Response) => {
  try {
    const { to } = req.body;

    // Validate email parameter
    if (!to || typeof to !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Valid recipient email is required',
      });
      return;
    }

    // Trim and validate email format
    const email = to.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      res.status(400).json({
        success: false,
        message: 'Invalid email format',
      });
      return;
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

    res.json({
      success: true,
      message: `Test email sent successfully to ${to}`,
    });
  } catch (error) {
    logger.error('Failed to send test email:', error as Error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: (error as Error).message,
    });
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
        res.status(400).json({
          success: false,
          message: 'Valid recipient email is required',
        });
        return;
      }

      // Trim and validate email format
      const email = to.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        res.status(400).json({
          success: false,
          message: 'Invalid email format',
        });
        return;
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

      res.json({
        success: true,
        message: `Direct test email sent successfully to ${email}`,
        details: {
          recipient: email,
          sendTime: totalTime,
          timestamp: new Date().toISOString(),
          method: 'direct_send',
          queueBypassed: true,
        },
      });
    } catch (error) {
      logger.error('Failed to send direct test email:', error as Error);
      res.status(500).json({
        success: false,
        message: 'Failed to send direct test email',
        error: (error as Error).message,
        details: {
          method: 'direct_send',
          timestamp: new Date().toISOString(),
        },
      });
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

      res.json({
        success: true,
        queue: status,
        message: `Queue has ${status.length} emails, processing: ${status.processing}`,
      });
    } catch (error) {
      logger.error('Failed to get queue status:', error as Error);
      res.status(500).json({
        success: false,
        message: 'Failed to get queue status',
        error: (error as Error).message,
      });
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

      res.json({
        success: true,
        message: 'Queue processing completed',
        queue: newStatus,
      });
    } catch (error) {
      logger.error('Failed to force process queue:', error as Error);
      res.status(500).json({
        success: false,
        message: 'Failed to force process queue',
        error: (error as Error).message,
      });
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

      res.json({
        success: true,
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
      res.status(500).json({
        success: false,
        message: 'Failed to get queue emails',
        error: (error as Error).message,
      });
    }
  }
);

export default router;
