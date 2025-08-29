import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';
import { Request, Response } from 'express';

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
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 20, // 20 requests per minute
      message: 'Too many requests from this IP, please try again later',
    });
    
    // Authenticated tier - standard users
    this.tiers.set('authenticated', {
      name: 'authenticated',
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 60, // 60 requests per minute
      message: 'Rate limit exceeded, please slow down',
    });
    
    // Premium tier - premium users
    this.tiers.set('premium', {
      name: 'premium',
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 120, // 120 requests per minute
      message: 'Premium rate limit exceeded',
    });
    
    // Admin tier - administrative users
    this.tiers.set('admin', {
      name: 'admin',
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 500, // 500 requests per minute
      message: 'Admin rate limit exceeded',
    });
    
    // API tier - for API endpoints
    this.tiers.set('api', {
      name: 'api',
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // 100 requests per 15 minutes
      message: 'API rate limit exceeded, please try again later',
    });
    
    // Auth tier - for authentication endpoints
    this.tiers.set('auth', {
      name: 'auth',
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per 15 minutes
      message: 'Too many authentication attempts, please try again later',
      skipSuccessfulRequests: true, // Only count failed attempts
    });
    
    // Upload tier - for file uploads
    this.tiers.set('upload', {
      name: 'upload',
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 10, // 10 uploads per hour
      message: 'Upload limit exceeded, please try again later',
    });
  }
  
  /**
   * Create a rate limiter for a specific tier
   */
  createLimiter(tierName: string): RateLimitRequestHandler | null {
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
        const userId = (req as any).user?.id;
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
        const RedisStore = require('rate-limit-redis').default;
        options.store = new RedisStore({
          client: client,
          prefix: `rate_limit:${tierName}:`,
        });
        logger.info(`Rate limiter '${tierName}' using Redis store`);
      } catch (error) {
        logger.warn(`Failed to create Redis store for rate limiter '${tierName}', using memory store`);
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
  getLimiter(tierName: string): RateLimitRequestHandler | null {
    return this.limiters.get(tierName) || this.createLimiter(tierName);
  }
  
  /**
   * Get user tier based on request
   */
  getUserTier(req: Request): string {
    const user = (req as any).user;
    
    if (!user) {
      return 'anonymous';
    }
    
    if (user.role === 'admin') {
      return 'admin';
    }
    
    if (user.role === 'premium' || user.isPremium) {
      return 'premium';
    }
    
    return 'authenticated';
  }
  
  /**
   * Create dynamic rate limiter based on user tier
   */
  createDynamicLimiter(): RateLimitRequestHandler {
    return (req: Request, res: Response, next: Function) => {
      const tier = this.getUserTier(req);
      const limiter = this.getLimiter(tier);
      
      if (!limiter) {
        // Fallback to anonymous if tier not found
        const fallbackLimiter = this.getLimiter('anonymous');
        if (fallbackLimiter) {
          return fallbackLimiter(req, res, next);
        }
        return next();
      }
      
      return limiter(req, res, next);
    };
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
    rateLimitingSystem.createLimiter('anonymous');
    rateLimitingSystem.createLimiter('authenticated');
    rateLimitingSystem.createLimiter('api');
    rateLimitingSystem.createLimiter('auth');
    
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
  getTierLimiter: (tier: string) => rateLimitingSystem.getLimiter(tier),
  
  // Dynamic limiter based on user authentication
  dynamic: rateLimitingSystem.createDynamicLimiter(),
  
  // Predefined limiters for common use cases
  anonymous: () => rateLimitingSystem.getLimiter('anonymous'),
  authenticated: () => rateLimitingSystem.getLimiter('authenticated'),
  api: () => rateLimitingSystem.getLimiter('api'),
  auth: () => rateLimitingSystem.getLimiter('auth'),
  upload: () => rateLimitingSystem.getLimiter('upload'),
  admin: () => rateLimitingSystem.getLimiter('admin'),
};

/**
 * Export system for management
 */
export { rateLimitingSystem };