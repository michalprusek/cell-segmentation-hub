import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { TIER_LIMITS, RATE_LIMITS } from '../config/uploadLimits';

interface RateLimitTier {
  name: string;
  windowMs: number;
  max: number;
  message: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitStats {
  tier: string;
  requests: number;
  blocked: number;
  remaining: number;
  resetTime: Date;
}

class RateLimitingSystem {
  private tiers: Map<string, RateLimitTier> = new Map();
  private limiters: Map<string, RateLimitRequestHandler> = new Map();
  private stats: Map<string, RateLimitStats> = new Map();
  
  constructor() {
    this.initializeTiers();
  }
  
  /**
   * Initialize rate limit tiers
   */
  private initializeTiers(): void {
    // Anonymous tier - most restrictive
    this.tiers.set('anonymous', {
      name: 'anonymous',
      windowMs: TIER_LIMITS.anonymous.windowMs, // 1 minute
      max: TIER_LIMITS.anonymous.max, // 100 requests per minute (increased from 20)
      message: 'Too many requests from this IP, please try again later',
    });
    
    // Authenticated tier - standard users
    this.tiers.set('authenticated', {
      name: 'authenticated',
      windowMs: TIER_LIMITS.authenticated.windowMs, // 1 minute
      max: TIER_LIMITS.authenticated.max, // 300 requests per minute (increased from 60)
      message: 'Rate limit exceeded, please slow down',
    });
    
    // Premium tier - premium users
    this.tiers.set('premium', {
      name: 'premium',
      windowMs: TIER_LIMITS.premium.windowMs, // 1 minute
      max: TIER_LIMITS.premium.max, // 500 requests per minute (increased from 120)
      message: 'Premium rate limit exceeded',
    });
    
    // Admin tier - administrative users
    this.tiers.set('admin', {
      name: 'admin',
      windowMs: TIER_LIMITS.admin.windowMs, // 1 minute
      max: TIER_LIMITS.admin.max, // 1000 requests per minute (increased from 500)
      message: 'Admin rate limit exceeded',
    });
    
    // API tier - for API endpoints
    this.tiers.set('api', {
      name: 'api',
      windowMs: RATE_LIMITS.API_WINDOW_MS, // 5 minutes
      max: RATE_LIMITS.API_MAX_REQUESTS, // 1000 requests per 5 minutes (increased from 100/15min)
      message: 'API rate limit exceeded, please try again later',
    });
    
    // Auth tier - for authentication endpoints
    this.tiers.set('auth', {
      name: 'auth',
      windowMs: RATE_LIMITS.AUTH_WINDOW_MS, // 15 minutes
      max: RATE_LIMITS.AUTH_MAX_REQUESTS, // 20 attempts per 15 minutes (increased from 5)
      message: 'Too many authentication attempts, please try again later',
      skipSuccessfulRequests: true, // Only count failed attempts
    });
    
    // Upload tier - for file uploads
    this.tiers.set('upload', {
      name: 'upload',
      windowMs: RATE_LIMITS.UPLOAD_WINDOW_MS, // 5 minutes
      max: RATE_LIMITS.UPLOAD_MAX_REQUESTS, // 100 uploads per 5 minutes (increased from 10/hour)
      message: 'Upload limit exceeded, please try again later',
    });
  }
  
  /**
   * Create a rate limiter for a specific tier
   */
  async createLimiter(tierName: string): Promise<RateLimitRequestHandler | null> {
    const tier = this.tiers.get(tierName);
    if (!tier) {
      logger.warn(`Rate limit tier '${tierName}' not found`);
      return null;
    }
    
    // Check if limiter already exists
    const existing = this.limiters.get(tierName);
    if (existing) {
      return existing;
    }
    
    const client = getRedisClient();
    
    // Configure the rate limiter options
    const options: Partial<Options> = {
      windowMs: tier.windowMs,
      max: tier.max,
      message: tier.message,
      standardHeaders: true, // Return rate limit info in headers
      legacyHeaders: false,
      skipSuccessfulRequests: tier.skipSuccessfulRequests || false,
      skipFailedRequests: tier.skipFailedRequests || false,
      
      // Key generator - use IP + user ID if authenticated
      keyGenerator: (req: Request): string => {
        const userId = (req as Request & { user?: { id?: string } }).user?.id;
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        return userId ? `${tierName}:user:${userId}` : `${tierName}:ip:${ip}`;
      },
      
      // Handler for when limit is reached
      handler: (req: Request, res: Response) => {
        logger.warn(`Rate limit exceeded for ${tierName}: ${req.ip}`);
        this.incrementBlockedCount(tierName);
        
        res.status(429).json({
          error: tier.message,
          retryAfter: res.getHeader('Retry-After'),
          limit: res.getHeader('X-RateLimit-Limit'),
          remaining: res.getHeader('X-RateLimit-Remaining'),
          reset: res.getHeader('X-RateLimit-Reset'),
        });
      },
    };
    
    // If Redis is available, use it for distributed rate limiting
    if (client) {
      try {
        // Dynamic import for optional dependency
        const { default: RedisStore } = await import('rate-limit-redis');
        options.store = new RedisStore({
          sendCommand: (...args: string[]) => client.sendCommand(args),
          prefix: `rate_limit:${tierName}:`,
        });
        logger.info(`Rate limiter '${tierName}' using Redis store`);
      } catch (error) {
        logger.warn(`Failed to create Redis store for rate limiter '${tierName}', using memory store`, error);
      }
    } else {
      logger.warn(`Rate limiter '${tierName}' using memory store (Redis not available)`);
    }
    
    const limiter = rateLimit(options as Options);
    this.limiters.set(tierName, limiter);
    
    // Initialize stats
    this.stats.set(tierName, {
      tier: tierName,
      requests: 0,
      blocked: 0,
      remaining: tier.max,
      resetTime: new Date(Date.now() + tier.windowMs),
    });
    
    logger.info(`Rate limiter '${tierName}' initialized: ${tier.max} requests per ${tier.windowMs}ms`);
    return limiter;
  }
  
  /**
   * Get rate limiter by tier name
   */
  async getLimiter(tierName: string): Promise<RateLimitRequestHandler | null> {
    const existing = this.limiters.get(tierName);
    if (existing) {
      return existing;
    }
    return this.createLimiter(tierName);
  }
  
  /**
   * Get user tier based on request
   */
  getUserTier(req: Request): string {
    const user = req.user;

    if (!user) {
      return 'anonymous';
    }

    // For now, all authenticated users are treated as authenticated tier
    // TODO: Implement role/premium system if needed in the future
    return 'authenticated';
  }
  
  /**
   * Create dynamic rate limiter based on user tier
   */
  createDynamicLimiter(): RateLimitRequestHandler {
    const dynamicHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const tier = this.getUserTier(req);
      const limiter = await this.getLimiter(tier);
      
      if (!limiter) {
        // Fallback to anonymous if tier not found
        const fallbackLimiter = await this.getLimiter('anonymous');
        if (fallbackLimiter) {
          fallbackLimiter(req, res, next);
          return;
        }
        return next();
      }
      
      limiter(req, res, next);
      return;
    };

    return dynamicHandler as RateLimitRequestHandler;
  }
  
  /**
   * Increment blocked count for a tier
   */
  private incrementBlockedCount(tierName: string): void {
    const stats = this.stats.get(tierName);
    if (stats) {
      stats.blocked++;
    }
  }
  
  /**
   * Get rate limiting statistics
   */
  getStats(): RateLimitStats[] {
    return Array.from(this.stats.values());
  }
  
  /**
   * Reset statistics for a tier
   */
  resetStats(tierName: string): void {
    const tier = this.tiers.get(tierName);
    if (tier) {
      this.stats.set(tierName, {
        tier: tierName,
        requests: 0,
        blocked: 0,
        remaining: tier.max,
        resetTime: new Date(Date.now() + tier.windowMs),
      });
    }
  }
  
  /**
   * Get all configured tiers
   */
  getTiers(): RateLimitTier[] {
    return Array.from(this.tiers.values());
  }
  
  /**
   * Update tier configuration
   */
  updateTier(tierName: string, config: Partial<RateLimitTier>): boolean {
    const tier = this.tiers.get(tierName);
    if (!tier) {
      return false;
    }
    
    // Update tier configuration
    Object.assign(tier, config);
    
    // Remove existing limiter to force recreation with new config
    this.limiters.delete(tierName);
    
    logger.info(`Rate limit tier '${tierName}' updated`);
    return true;
  }
  
  /**
   * Clean up rate limiting system
   */
  async cleanup(): Promise<void> {
    try {
      // Clear all limiters
      this.limiters.clear();
      
      // Clear stats
      this.stats.clear();
      
      logger.info('Rate limiting system cleaned up');
    } catch (error) {
      logger.error('Failed to cleanup rate limiting system:', error);
    }
  }
}

// Create singleton instance
const rateLimitingSystem = new RateLimitingSystem();

/**
 * Initialize rate limiting system
 */
export async function initializeRateLimitingSystem(): Promise<void> {
  try {
    logger.info('Initializing rate limiting system...');
    
    // Create default limiters
    await rateLimitingSystem.createLimiter('anonymous');
    await rateLimitingSystem.createLimiter('authenticated');
    await rateLimitingSystem.createLimiter('api');
    await rateLimitingSystem.createLimiter('auth');
    
    logger.info('✅ Rate limiting system initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize rate limiting system:', error);
    throw error;
  }
}

/**
 * Cleanup rate limiting system
 */
export async function cleanupRateLimitingSystem(): Promise<void> {
  await rateLimitingSystem.cleanup();
}

/**
 * Export rate limiters for use in routes
 */
export const rateLimiters = {
  // Get specific tier limiter
  getTierLimiter: (tier: string): Promise<RateLimitRequestHandler | null> => rateLimitingSystem.getLimiter(tier),
  
  // Dynamic limiter based on user authentication
  dynamic: rateLimitingSystem.createDynamicLimiter(),
  
  // Predefined limiters for common use cases
  anonymous: (): Promise<RateLimitRequestHandler | null> => rateLimitingSystem.getLimiter('anonymous'),
  authenticated: (): Promise<RateLimitRequestHandler | null> => rateLimitingSystem.getLimiter('authenticated'),
  api: (): Promise<RateLimitRequestHandler | null> => rateLimitingSystem.getLimiter('api'),
  auth: (): Promise<RateLimitRequestHandler | null> => rateLimitingSystem.getLimiter('auth'),
  upload: (): Promise<RateLimitRequestHandler | null> => rateLimitingSystem.getLimiter('upload'),
  admin: (): Promise<RateLimitRequestHandler | null> => rateLimitingSystem.getLimiter('admin'),
};

/**
 * Export system for management
 */
export { rateLimitingSystem };