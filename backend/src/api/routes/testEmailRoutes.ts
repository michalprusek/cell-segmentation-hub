import { Router, Request, Response } from 'express';
import { sendEmail, testConnection } from '../../services/emailService';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

// Test email connection
router.get('/test-connection', authenticate, async (req: Request, res: Response) => {
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
          from: process.env.FROM_EMAIL
        }
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Email service connection failed' 
      });
    }
  } catch (error) {
    logger.error('Email test connection failed:', error as Error);
    res.status(500).json({ 
      success: false, 
      message: 'Email service connection failed',
      error: (error as Error).message 
    });
  }
});

// Send test email
router.post('/send-test', authenticate, async (req: Request, res: Response) => {
  try {
    const { to } = req.body;
    
    // Validate email parameter
    if (!to || typeof to !== 'string') {
      res.status(400).json({ 
        success: false, 
        message: 'Valid recipient email is required' 
      });
      return;
    }
    
    // Trim and validate email format
    const email = to.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(email)) {
      res.status(400).json({ 
        success: false, 
        message: 'Invalid email format' 
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

If you received this email, the configuration is working!`
    });

    res.json({ 
      success: true, 
      message: `Test email sent successfully to ${to}` 
    });
  } catch (error) {
    logger.error('Failed to send test email:', error as Error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send test email',
      error: (error as Error).message 
    });
  }
});

export default router;