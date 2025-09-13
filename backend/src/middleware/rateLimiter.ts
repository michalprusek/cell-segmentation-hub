import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ResponseHelper } from '../utils/response';
import { getUploadLimitsForEnvironment } from '../config/uploadLimits';

// Get environment-specific rate limits
const rateLimits = getUploadLimitsForEnvironment();

/**
 * Rate limiting middleware configurations
 */

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
}

/**
 * Generate rate limit key based on user or IP
 */
const generateRateLimitKey = (req: Request): string => {
  // Use user ID if authenticated, otherwise use IP address
  const userId = (req as Request & { user?: { id?: string } }).user?.id;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  return userId ? `user:${userId}` : `ip:${ip}`;
};

/**
 * Rate limit handler with proper response formatting
 */
const rateLimitHandler = (req: Request, res: Response): void => {
  logger.warn('Rate limit exceeded', 'RateLimit', {
    ip: req.ip,
    userId: (req as Request & { user?: { id?: string } }).user?.id,
    path: req.path,
    method: req.method
  });
  
  ResponseHelper.rateLimit(res, 'Too many requests. Please try again later.');
};

/**
 * Create a rate limiter with default configuration
 */
function createRateLimiter(config: RateLimitConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: config.message || 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skipSuccessfulRequests: config.skipSuccessfulRequests || false,
    skipFailedRequests: config.skipFailedRequests || false,
    keyGenerator: config.keyGenerator || generateRateLimitKey,
    handler: rateLimitHandler,
    skip: (req: Request) => {
      // Skip rate limiting for health checks and metrics
      return req.path === '/health' || 
             req.path === '/api/health' || 
             req.path === '/metrics' ||
             req.path === '/api/ml/health';
    }
  });
}

/**
 * Strict rate limiter for authentication endpoints
 */
export const authRateLimiter = createRateLimiter({
  windowMs: rateLimits.AUTH_WINDOW_MS, // 15 minutes from config
  max: rateLimits.AUTH_MAX_REQUESTS, // 20 requests per 15 minutes from config (increased from 5)
  message: 'Too many authentication attempts, please try again later',
  skipSuccessfulRequests: true
});

// Export with shorter alias for compatibility
export const authLimiter = authRateLimiter;

/**
 * Rate limiter for password reset requests
 */
export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP/user to 3 password reset requests per hour
  message: 'Too many password reset requests, please try again later'
});

// Export with shorter alias for compatibility
export const passwordResetLimiter = passwordResetRateLimiter;

/**
 * Rate limiter for registration endpoint
 */
export const registrationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Limit each IP to 3 registration attempts per 15 minutes
  message: 'Too many registration attempts, please try again later'
});

/**
 * General API rate limiter
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: rateLimits.API_WINDOW_MS, // 5 minutes from config
  max: rateLimits.API_MAX_REQUESTS, // 1000 requests per 5 minutes from config
  message: 'Too many API requests, please try again later',
  skipSuccessfulRequests: false
});

// Export with shorter alias for compatibility
export const apiLimiter = apiRateLimiter;

/**
 * Strict rate limiter for sensitive operations
 */
export const sensitiveOperationRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit each IP/user to 10 requests per 5 minutes
  message: 'Too many requests for sensitive operations, please try again later'
});

/**
 * File upload rate limiter
 */
export const uploadRateLimiter = createRateLimiter({
  windowMs: rateLimits.UPLOAD_WINDOW_MS, // 1 minute
  max: rateLimits.UPLOAD_MAX_REQUESTS, // Increased from 10 to 100 per minute
  message: 'Too many file upload requests, please try again later'
});

/**
 * Bulk upload rate limiter for large batch operations
 */
export const bulkUploadRateLimiter = createRateLimiter({
  windowMs: rateLimits.BULK_UPLOAD_WINDOW_MS, // 5 minutes
  max: rateLimits.BULK_UPLOAD_MAX_REQUESTS, // 1000 requests per 5 minutes
  message: 'Too many bulk upload requests, please try again later'
});

/**
 * ML processing rate limiter
 */
export const mlProcessingRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP/user to 5 ML processing requests per minute
  message: 'Too many ML processing requests, please try again later'
});

/**
 * Export operations rate limiter
 */
export const exportRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Limit each IP/user to 20 export requests per 5 minutes
  message: 'Too many export requests, please try again later'
});

/**
 * Development rate limiter (more lenient)
 */
export const developmentRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // Very high limit for development
  message: 'Rate limit exceeded (development mode)'
});

/**
 * Create a conditional rate limiter based on environment
 */
export const conditionalRateLimiter = (
  productionConfig: RateLimitConfig,
  developmentConfig?: RateLimitConfig
): RateLimitRequestHandler => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (isDevelopment && developmentConfig) {
    return createRateLimiter(developmentConfig);
  } else if (isDevelopment) {
    return developmentRateLimiter;
  }
  
  return createRateLimiter(productionConfig);
};

/**
 * Skip rate limiting for certain conditions
 */
export const createConditionalSkipRateLimiter = (
  config: RateLimitConfig,
  skipCondition: (req: Request) => boolean
): RateLimitRequestHandler => {
  const limiter = createRateLimiter(config);

  const conditionalLimiter = (req: Request, res: Response, next: NextFunction): void => {
    if (skipCondition(req)) {
      return next();
    }
    limiter(req, res, next);
  };

  return conditionalLimiter as RateLimitRequestHandler;
};

/**
 * Rate limiter that skips for authenticated users
 */
export const createAuthSkipRateLimiter = (config: RateLimitConfig): RateLimitRequestHandler => {
  return createConditionalSkipRateLimiter(config, (req: Request) => {
    return !!(req as Request & { user?: unknown }).user; // Skip if user is authenticated
  });
};

/**
 * Burst rate limiter for short-term high-frequency requests
 */
export const burstRateLimiter = createRateLimiter({
  windowMs: 1000, // 1 second
  max: 5, // Max 5 requests per second
  message: 'Too many requests in a short time, please slow down'
});

/**
 * Combine multiple rate limiters
 */
export const combineRateLimiters = (...limiters: RateLimitRequestHandler[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    let currentIndex = 0;
    
    const runNextLimiter = (): void => {
      if (currentIndex >= limiters.length) {
        return next();
      }
      
      const limiter = limiters[currentIndex++];
      limiter(req, res, (err?: unknown) => {
        if (err) {
          return next(err);
        }
        runNextLimiter();
      });
    };
    
    runNextLimiter();
  };
};

// Export all rate limiters
export default {
  createRateLimiter,
  authRateLimiter,
  passwordResetRateLimiter,
  registrationRateLimiter,
  apiRateLimiter,
  sensitiveOperationRateLimiter,
  uploadRateLimiter,
  mlProcessingRateLimiter,
  exportRateLimiter,
  developmentRateLimiter,
  conditionalRateLimiter,
  createConditionalSkipRateLimiter,
  createAuthSkipRateLimiter,
  burstRateLimiter,
  combineRateLimiters
};