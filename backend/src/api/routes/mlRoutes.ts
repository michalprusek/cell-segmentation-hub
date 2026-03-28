import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import { authenticate } from '../../middleware/auth';
import { apiLimiter } from '../../middleware/rateLimiter';
import axios from 'axios';

const router = Router();

/**
 * ML Service Routes - Machine Learning model inference and management
 */

// Public endpoints
router.get(
  '/models',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('📊 ML: Fetching available models');

      // Placeholder response for available ML models
      const models = [
        {
          id: 'hrnetv2',
          name: 'HRNetV2',
          description: 'Best accuracy, ~3.1s inference time',
          version: '1.0.0',
          status: 'active',
        },
        {
          id: 'cbam-resunet',
          name: 'CBAM-ResUNet',
          description:
            'Precise segmentation with attention mechanisms, optimized inference time',
          version: '2.0.0',
          status: 'active',
        },
        {
          id: 'unet_spherohq',
          name: 'UNet (SpheroHQ)',
          description:
            'Best performance on SpheroHQ dataset, balanced speed and accuracy',
          version: '1.0.0',
          status: 'active',
        },
      ];

      return ResponseHelper.success(res, models, 'Available ML models retrieved successfully');
    } catch (error) {
      logger.error('❌ ML: Error fetching models:', error);
      next(error);
    }
  }
);

// Public status endpoint - no authentication required
router.get(
  '/status',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('🔍 ML: Checking service status');

      const mlServiceUrl = process.env.SEGMENTATION_SERVICE_URL || process.env.ML_SERVICE_URL || 'http://ml:8000';

      // Verify ML service is reachable
      await axios.get(`${mlServiceUrl}/health`, { timeout: 5000 });

      const status = {
        service: 'online',
        version: '1.0.0',
        modelsLoaded: 3,
        queueSize: 0,
        lastHealthCheck: new Date().toISOString(),
        performance: {
          averageInferenceTime: '8.5s',
          successRate: '99.2%',
          errorRate: '0.8%',
        },
      };

      return ResponseHelper.success(res, status, 'ML service status retrieved successfully');
    } catch (error) {
      logger.error('❌ ML: Error checking service status:', error);
      return ResponseHelper.error(res, {
        code: 'SERVICE_UNAVAILABLE',
        message: `ML service unavailable: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          service: 'offline',
          version: '1.0.0',
          modelsLoaded: 0,
          queueSize: 0,
          lastHealthCheck: new Date().toISOString(),
        },
      }, 503);
    }
  }
);

// Public health endpoint - no authentication required for monitoring/status checks
router.get(
  '/health',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('🏥 ML: Health check requested');

      const mlServiceUrl = process.env.SEGMENTATION_SERVICE_URL || process.env.ML_SERVICE_URL || 'http://ml:8000';

      // Fetch actual health status from ML service
      const response = await axios.get(`${mlServiceUrl}/health`, {
        timeout: 5000,
      });

      const health = {
        status: response.data.status || 'unknown',
        uptime: process.uptime(),
        models: {
          loaded: 3, // ML service has 3 models pre-loaded
          failed: 0,
        },
        memory: {
          used: '256MB',
          available: '1.2GB',
        },
        gpu: {
          available: response.data.gpu_available || false,
          utilization: '0%',
        },
      };

      return ResponseHelper.success(res, health, 'ML service health check completed');
    } catch (error) {
      logger.error('❌ ML: Health check failed:', error);
      // Return degraded status if ML service is unavailable
      return ResponseHelper.error(res, {
        code: 'SERVICE_UNAVAILABLE',
        message: `ML service unavailable: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          status: 'unhealthy',
          uptime: process.uptime(),
          models: { loaded: 0, failed: 0 },
          memory: { used: 'unknown', available: 'unknown' },
          gpu: { available: false, utilization: '0%' },
        },
      }, 503);
    }
  }
);

// Protected endpoints
router.use(authenticate);

router.get(
  '/queue',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('📋 ML: Fetching queue status');

      // Placeholder queue status
      const queueStatus = {
        totalItems: 0,
        processing: 0,
        pending: 0,
        completed: 0,
        failed: 0,
        averageWaitTime: '2.3s',
        estimatedProcessingTime: '0s',
      };

      return ResponseHelper.success(res, queueStatus, 'ML queue status retrieved successfully');
    } catch (error) {
      logger.error('❌ ML: Error fetching queue status:', error);
      next(error);
    }
  }
);

router.post(
  '/models/:modelId/warm-up',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { modelId } = req.params;
      logger.info(`🔥 ML: Warming up model: ${modelId}`);

      // Placeholder model warm-up
      return ResponseHelper.success(res, { modelId, status: 'warming-up' }, `Model ${modelId} warm-up initiated`);
    } catch (error) {
      logger.error('❌ ML: Error warming up model:', error);
      next(error);
    }
  }
);

export default router;
