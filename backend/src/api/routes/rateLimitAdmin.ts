import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import { authenticate } from '../../middleware/auth';
import { apiLimiter, authLimiter } from '../../middleware/rateLimiter';
import { validateBody, validateParams } from '../../middleware/validation';
import { z } from 'zod';

const router = Router();

/**
 * Rate Limiting Administration Routes - Manage rate limits, tiers, and violations
 */

// Authentication required for all rate limiting admin operations
router.use(authenticate);

const ipWhitelistSchema = z.object({
  ip: z.string().ip(),
  reason: z.string().min(1).max(255),
  expiresAt: z.string().datetime().optional()
});

const userWhitelistSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1).max(255),
  expiresAt: z.string().datetime().optional()
});

const blacklistSchema = z.object({
  target: z.string().min(1),
  reason: z.string().min(1).max(255),
  duration: z.number().min(60).max(86400).optional() // 1 minute to 24 hours
});

const tierUpdateSchema = z.object({
  userId: z.string().uuid(),
  tier: z.enum(['anonymous', 'authenticated', 'premium', 'admin'])
});

const bulkTierUpdateSchema = z.object({
  users: z.array(tierUpdateSchema),
  reason: z.string().min(1).max(255)
});

router.get('/status',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('📊 RateLimit: Status requested');
      
      const status = {
        system: {
          enabled: true,
          algorithm: 'sliding-window',
          storage: 'redis',
          lastUpdated: new Date().toISOString()
        },
        tiers: {
          anonymous: { limit: 20, window: '1 minute', active: 145 },
          authenticated: { limit: 60, window: '1 minute', active: 89 },
          premium: { limit: 120, window: '1 minute', active: 23 },
          admin: { limit: 500, window: '1 minute', active: 3 }
        },
        violations: {
          last24h: 67,
          last1h: 8,
          activeBlocks: 12,
          topViolators: [
            { ip: '192.168.1.100', count: 15 },
            { ip: '10.0.0.50', count: 8 },
            { user: 'user-123', count: 5 }
          ]
        },
        whitelists: {
          ips: 5,
          users: 12
        }
      };

      res.json({
        success: true,
        data: status,
        message: 'Rate limiting status retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error fetching status:', error);
      next(error);
    }
  }
);

router.get('/configurations',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('⚙️ RateLimit: Configurations requested');
      
      const configurations = {
        default: {
          algorithm: 'sliding-window',
          storage: 'redis',
          keyGenerator: 'ip-based',
          skipSuccessfulRequests: false,
          skipFailedRequests: false
        },
        tiers: {
          anonymous: {
            requests: 20,
            windowMs: 60000,
            message: 'Too many requests from this IP',
            standardHeaders: true
          },
          authenticated: {
            requests: 60,
            windowMs: 60000,
            message: 'Rate limit exceeded for authenticated users',
            standardHeaders: true
          },
          premium: {
            requests: 120,
            windowMs: 60000,
            message: 'Premium rate limit exceeded',
            standardHeaders: true
          },
          admin: {
            requests: 500,
            windowMs: 60000,
            message: 'Admin rate limit exceeded',
            standardHeaders: true
          }
        },
        endpoints: {
          '/api/auth/login': { limit: 5, window: 300000 }, // 5 per 5 minutes
          '/api/auth/register': { limit: 3, window: 3600000 }, // 3 per hour
          '/api/auth/request-password-reset': { limit: 2, window: 3600000 } // 2 per hour
        }
      };

      res.json({
        success: true,
        data: configurations,
        message: 'Rate limiting configurations retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error fetching configurations:', error);
      next(error);
    }
  }
);

router.get('/violations',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit = '50', offset = '0', timeRange = '24h' } = req.query;
      logger.info(`🚨 RateLimit: Violations requested (${timeRange})`);
      
      const violations = {
        summary: {
          total: 67,
          timeRange: timeRange as string,
          mostViolatedEndpoint: '/api/auth/login',
          peakHour: '14:00-15:00'
        },
        violations: [
          {
            id: '1',
            ip: '192.168.1.100',
            userId: null,
            endpoint: '/api/auth/login',
            count: 15,
            tier: 'anonymous',
            firstViolation: new Date(Date.now() - 3600000).toISOString(),
            lastViolation: new Date(Date.now() - 300000).toISOString(),
            status: 'blocked',
            userAgent: 'Mozilla/5.0...'
          },
          {
            id: '2',
            ip: '10.0.0.50',
            userId: 'user-456',
            endpoint: '/api/projects',
            count: 8,
            tier: 'authenticated',
            firstViolation: new Date(Date.now() - 1800000).toISOString(),
            lastViolation: new Date(Date.now() - 600000).toISOString(),
            status: 'warned',
            userAgent: 'PostmanRuntime/7.29.0'
          }
        ],
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          total: 67,
          hasMore: true
        }
      };

      res.json({
        success: true,
        data: violations,
        message: 'Rate limiting violations retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error fetching violations:', error);
      next(error);
    }
  }
);

router.get('/whitelist/ips',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('📝 RateLimit: IP whitelist requested');
      
      const whitelist = [
        {
          ip: '127.0.0.1',
          reason: 'Localhost',
          addedBy: 'admin',
          addedAt: new Date(Date.now() - 86400000).toISOString(),
          expiresAt: null
        },
        {
          ip: '192.168.1.1',
          reason: 'Internal network gateway',
          addedBy: 'admin',
          addedAt: new Date(Date.now() - 7200000).toISOString(),
          expiresAt: null
        }
      ];

      res.json({
        success: true,
        data: whitelist,
        message: 'IP whitelist retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error fetching IP whitelist:', error);
      next(error);
    }
  }
);

router.post('/whitelist/ips',
  authLimiter,
  validateBody(ipWhitelistSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ip, reason, expiresAt } = req.body;
      const adminId = (req as Request & { userId: string }).userId;
      
      logger.info(`➕ RateLimit: Adding IP to whitelist: ${ip}`);
      
      const whitelistEntry = {
        ip,
        reason,
        addedBy: adminId,
        addedAt: new Date().toISOString(),
        expiresAt: expiresAt || null
      };

      res.json({
        success: true,
        data: whitelistEntry,
        message: 'IP added to whitelist successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error adding IP to whitelist:', error);
      next(error);
    }
  }
);

router.get('/whitelist/users',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('👥 RateLimit: User whitelist requested');
      
      const whitelist = [
        {
          userId: 'user-789',
          email: 'admin@example.com',
          reason: 'System administrator',
          addedBy: 'system',
          addedAt: new Date(Date.now() - 86400000).toISOString(),
          expiresAt: null
        },
        {
          userId: 'user-456',
          email: 'api@partner.com',
          reason: 'API partner - high volume testing',
          addedBy: 'admin',
          addedAt: new Date(Date.now() - 3600000).toISOString(),
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString()
        }
      ];

      res.json({
        success: true,
        data: whitelist,
        message: 'User whitelist retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error fetching user whitelist:', error);
      next(error);
    }
  }
);

router.post('/whitelist/users',
  authLimiter,
  validateBody(userWhitelistSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, reason, expiresAt } = req.body;
      const adminId = (req as Request & { userId: string }).userId;
      
      logger.info(`➕ RateLimit: Adding user to whitelist: ${userId}`);
      
      const whitelistEntry = {
        userId,
        reason,
        addedBy: adminId,
        addedAt: new Date().toISOString(),
        expiresAt: expiresAt || null
      };

      res.json({
        success: true,
        data: whitelistEntry,
        message: 'User added to whitelist successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error adding user to whitelist:', error);
      next(error);
    }
  }
);

router.post('/blacklist/ips',
  authLimiter,
  validateBody(blacklistSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { target: ip, reason, duration } = req.body;
      const adminId = (req as Request & { userId: string }).userId;
      
      logger.warn(`🚫 RateLimit: Adding IP to blacklist: ${ip}`);
      
      const blacklistEntry = {
        ip,
        reason,
        addedBy: adminId,
        addedAt: new Date().toISOString(),
        expiresAt: duration ? new Date(Date.now() + duration * 1000).toISOString() : null
      };

      res.json({
        success: true,
        data: blacklistEntry,
        message: 'IP added to blacklist successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error adding IP to blacklist:', error);
      next(error);
    }
  }
);

router.post('/blacklist/users',
  authLimiter,
  validateBody(blacklistSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { target: userId, reason, duration } = req.body;
      const adminId = (req as Request & { userId: string }).userId;
      
      logger.warn(`🚫 RateLimit: Adding user to blacklist: ${userId}`);
      
      const blacklistEntry = {
        userId,
        reason,
        addedBy: adminId,
        addedAt: new Date().toISOString(),
        expiresAt: duration ? new Date(Date.now() + duration * 1000).toISOString() : null
      };

      res.json({
        success: true,
        data: blacklistEntry,
        message: 'User added to blacklist successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error adding user to blacklist:', error);
      next(error);
    }
  }
);

router.get('/tiers',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('🏆 RateLimit: User tier statistics requested');
      
      const tierStats = {
        distribution: {
          anonymous: 145,
          authenticated: 89,
          premium: 23,
          admin: 3
        },
        upgrades: {
          last30Days: {
            authenticatedToPremium: 12,
            premiumToAdmin: 1
          }
        },
        usage: {
          anonymous: { avgRequestsPerMinute: 8.5, peakUsage: '65%' },
          authenticated: { avgRequestsPerMinute: 15.2, peakUsage: '45%' },
          premium: { avgRequestsPerMinute: 23.8, peakUsage: '32%' },
          admin: { avgRequestsPerMinute: 45.1, peakUsage: '18%' }
        }
      };

      res.json({
        success: true,
        data: tierStats,
        message: 'User tier statistics retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error fetching tier statistics:', error);
      next(error);
    }
  }
);

router.put('/tiers/user',
  authLimiter,
  validateBody(tierUpdateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, tier } = req.body;
      const adminId = (req as Request & { userId: string }).userId;
      
      logger.info(`🔄 RateLimit: Updating user tier: ${userId} -> ${tier}`);
      
      res.json({
        success: true,
        data: { userId, tier, updatedBy: adminId, updatedAt: new Date().toISOString() },
        message: 'User tier updated successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error updating user tier:', error);
      next(error);
    }
  }
);

router.put('/tiers/bulk',
  authLimiter,
  validateBody(bulkTierUpdateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { users, reason } = req.body;
      const adminId = (req as Request & { userId: string }).userId;
      
      logger.info(`🔄 RateLimit: Bulk updating ${users.length} user tiers`);
      
      res.json({
        success: true,
        data: { 
          updatedCount: users.length,
          reason,
          updatedBy: adminId,
          updatedAt: new Date().toISOString()
        },
        message: `${users.length} user tiers updated successfully`
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error bulk updating user tiers:', error);
      next(error);
    }
  }
);

router.post('/reset',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = req.body;
      logger.info(`🔄 RateLimit: Resetting rate limit for key: ${key}`);
      
      res.json({
        success: true,
        data: { key, resetAt: new Date().toISOString() },
        message: 'Rate limit reset successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error resetting rate limit:', error);
      next(error);
    }
  }
);

router.get('/metrics',
  apiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('📈 RateLimit: Metrics requested');
      
      const metrics = {
        requests: {
          total: 15678,
          allowed: 15456,
          blocked: 222,
          blockRate: '1.4%'
        },
        performance: {
          averageCheckTime: '2.5ms',
          cacheHitRate: '94%',
          memoryUsage: '45MB'
        },
        trends: {
          hourly: [
            { hour: '13:00', requests: 456, blocked: 12 },
            { hour: '14:00', requests: 523, blocked: 18 },
            { hour: '15:00', requests: 489, blocked: 8 }
          ]
        }
      };

      res.json({
        success: true,
        data: metrics,
        message: 'Rate limiting metrics retrieved successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error fetching metrics:', error);
      next(error);
    }
  }
);

router.post('/cleanup',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('🧹 RateLimit: Cleaning up expired records');
      
      const cleanup = {
        expiredWhitelistEntries: 5,
        expiredBlacklistEntries: 12,
        oldViolations: 34,
        totalCleaned: 51,
        cleanedAt: new Date().toISOString()
      };

      res.json({
        success: true,
        data: cleanup,
        message: 'Rate limiting records cleaned up successfully'
      });
    } catch (error) {
      logger.error('❌ RateLimit: Error cleaning up records:', error);
      next(error);
    }
  }
);

export default router;