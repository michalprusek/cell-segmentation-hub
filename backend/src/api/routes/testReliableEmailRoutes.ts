/**
 * Test routes for the reliable email service
 * Allows testing the new implementation without going through password reset flow
 */

import { Router, Request, Response } from 'express';
import { sendTestEmailReliable, getAllDeliveryStatuses, sendPasswordResetEmailReliable } from '../../services/reliableEmailService';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * Send a test email using the reliable service
 */
router.post('/test-reliable', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required'
      });
    }

    logger.info('Testing reliable email service', 'TestReliableEmail', { to: email });

    const status = await sendTestEmailReliable(email);

    res.json({
      success: status.success,
      messageId: status.messageId,
      timestamp: status.timestamp,
      attempts: status.attempts,
      error: status.error
    });

  } catch (error) {
    logger.error('Test email failed:', error as Error, 'TestReliableEmail');
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * Test password reset email with simple template
 */
router.post('/test-password-reset', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required'
      });
    }

    logger.info('Testing password reset with reliable service', 'TestReliableEmail', { to: email });

    // Generate test token and expiry
    const testToken = 'TEST_TOKEN_' + Date.now();
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    await sendPasswordResetEmailReliable(email, testToken, expiresAt);

    res.json({
      success: true,
      message: 'Password reset email sent successfully',
      testToken,
      expiresAt
    });

  } catch (error) {
    logger.error('Test password reset failed:', error as Error, 'TestReliableEmail');
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * Get delivery status for all recent emails
 */
router.get('/delivery-status', async (req: Request, res: Response) => {
  try {
    const statuses = getAllDeliveryStatuses();

    res.json({
      success: true,
      count: statuses.length,
      statuses: statuses.map(([id, status]) => ({
        id,
        ...status
      }))
    });

  } catch (error) {
    logger.error('Failed to get delivery status:', error as Error, 'TestReliableEmail');
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

export default router;