/**
 * Health Check Routes
 * Comprehensive health monitoring endpoints
 */

import { Router, Request, Response } from 'express';
import { healthCheckService } from '../../services/healthCheckService';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * GET /health
 * Basic health check endpoint
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const health = await healthCheckService.checkHealth();
    const statusCode = health.status === 'healthy' ? 200 : 
                       health.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json({
      success: statusCode === 200,
      data: health,
      message: `Server is ${health.status}`,
    });
  } catch (error: unknown) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /health/live
 * Kubernetes liveness probe endpoint
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready
 * Kubernetes readiness probe endpoint
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    const { ready, issues } = await healthCheckService.isReadyForDeployment();
    
    if (ready) {
      res.status(200).json({
        ready: true,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        ready: false,
        issues,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error: unknown) {
    res.status(503).json({
      ready: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /health/detailed
 * Detailed health check with all component statuses
 */
router.get('/detailed', async (req: Request, res: Response) => {
  try {
    const health = await healthCheckService.checkHealth();
    const history = healthCheckService.getHealthHistory();
    
    res.status(200).json({
      success: true,
      current: health,
      history: history.slice(-10), // Last 10 checks
      statistics: {
        totalChecks: history.length,
        healthyChecks: history.filter(h => h.status === 'healthy').length,
        degradedChecks: history.filter(h => h.status === 'degraded').length,
        unhealthyChecks: history.filter(h => h.status === 'unhealthy').length,
      },
    });
  } catch (error: unknown) {
    logger.error('Detailed health check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Detailed health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /health/components/:component
 * Individual component health check
 */
router.get('/components/:component', async (req: Request, res: Response) => {
  try {
    const { component } = req.params;
    const health = await healthCheckService.checkHealth();
    
    if (!health.checks[component]) {
      return res.status(404).json({
        success: false,
        error: `Component '${component}' not found`,
        availableComponents: Object.keys(health.checks),
      });
    }
    
    res.status(200).json({
      success: true,
      component,
      health: health.checks[component],
      timestamp: health.timestamp,
    });
  } catch (error: unknown) {
    logger.error(`Component health check failed for ${req.params.component}:`, error);
    res.status(500).json({
      success: false,
      error: 'Component health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /health/check
 * Trigger manual health check
 */
router.post('/check', async (req: Request, res: Response) => {
  try {
    const health = await healthCheckService.checkHealth();
    
    res.status(200).json({
      success: true,
      data: health,
      message: 'Health check completed',
    });
  } catch (error: unknown) {
    logger.error('Manual health check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Manual health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;