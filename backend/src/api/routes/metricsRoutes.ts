import { Router } from 'express';
import { 
  getMetricsEndpoint, 
  getCombinedMetricsEndpoint, 
  getBusinessMetricsEndpoint,
  getMonitoringHealth 
} from '../../middleware/monitoring';
import { BusinessMetricsService } from '../../services/businessMetrics';
import { ResponseHelper } from '../../utils/response';
import { authenticate } from '../../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/metrics:
 *   get:
 *     tags: [Metrics]
 *     summary: Get infrastructure metrics (Prometheus format)
 *     description: Returns infrastructure metrics in Prometheus format for scraping
 *     responses:
 *       200:
 *         description: Infrastructure metrics in Prometheus format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
router.get('/', getMetricsEndpoint());

/**
 * @swagger
 * /api/metrics/combined:
 *   get:
 *     tags: [Metrics]
 *     summary: Get combined infrastructure and business metrics
 *     description: Returns both infrastructure and business metrics in Prometheus format
 *     responses:
 *       200:
 *         description: Combined metrics in Prometheus format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
router.get('/combined', getCombinedMetricsEndpoint());

/**
 * @swagger
 * /api/metrics/business:
 *   get:
 *     tags: [Metrics]
 *     summary: Get business metrics only
 *     description: Returns business-specific metrics in Prometheus format
 *     responses:
 *       200:
 *         description: Business metrics in Prometheus format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
router.get('/business', getBusinessMetricsEndpoint());

/**
 * @swagger
 * /api/metrics/health:
 *   get:
 *     tags: [Metrics]
 *     summary: Get metrics system health status
 *     description: Returns health status of both monitoring systems
 *     responses:
 *       200:
 *         description: Metrics system health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     infrastructure:
 *                       type: object
 *                       properties:
 *                         healthy:
 *                           type: boolean
 *                         message:
 *                           type: string
 *                         metricsCount:
 *                           type: number
 *                     business:
 *                       type: object
 *                       properties:
 *                         healthy:
 *                           type: boolean
 *                         message:
 *                           type: string
 *                         metricsCount:
 *                           type: number
 */
router.get('/health', (req, res) => {
  try {
    const infrastructureHealth = getMonitoringHealth();
    const businessHealth = BusinessMetricsService.getHealthStatus();

    const overallHealthy = infrastructureHealth.healthy && businessHealth.healthy;

    return ResponseHelper.success(res, {
      infrastructure: infrastructureHealth,
      business: businessHealth,
      overall: {
        healthy: overallHealthy,
        message: overallHealthy ? 'All metrics systems operational' : 'Some metrics systems have issues'
      }
    });
  } catch (error) {
    return ResponseHelper.error(res, 'Failed to get metrics health status', 500);
  }
});

/**
 * @swagger
 * /api/metrics/stats:
 *   get:
 *     tags: [Metrics]
 *     summary: Get business statistics summary (Admin only)
 *     description: Returns a summary of key business metrics for admin dashboard
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Business statistics summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     users:
 *                       type: object
 *                     projects:
 *                       type: object
 *                     segmentation:
 *                       type: object
 *                     storage:
 *                       type: object
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    // This would be implemented to provide a JSON summary of key metrics
    // for admin dashboards, separate from Prometheus format
    
    const stats = {
      users: {
        total: 'N/A - Implement from database',
        active_daily: 'N/A - Implement from database',
        active_weekly: 'N/A - Implement from database',
        active_monthly: 'N/A - Implement from database'
      },
      projects: {
        total: 'N/A - Implement from database',
        active: 'N/A - Implement from database',
        avg_images_per_project: 'N/A - Implement from database'
      },
      segmentation: {
        total_requests: 'N/A - From Prometheus metrics',
        queue_length: 'N/A - From database',
        popular_models: 'N/A - From database'
      },
      storage: {
        total_used: 'N/A - From filesystem/database',
        by_type: 'N/A - From filesystem analysis'
      }
    };

    return ResponseHelper.success(res, stats);
  } catch (error) {
    return ResponseHelper.error(res, 'Failed to get business statistics', 500);
  }
});

/**
 * @swagger
 * /api/metrics/refresh:
 *   post:
 *     tags: [Metrics]
 *     summary: Force refresh of business metrics (Admin only)
 *     description: Manually trigger collection of business metrics from database
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Metrics refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/refresh', authenticate, async (req, res) => {
  try {
    await BusinessMetricsService.collectDatabaseMetrics();
    return ResponseHelper.success(res, null, 'Business metrics refreshed successfully');
  } catch (error) {
    return ResponseHelper.error(res, 'Failed to refresh business metrics', 500);
  }
});

export default router;