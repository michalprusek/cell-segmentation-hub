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
    method: req.method,
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
    message:
      config.message ||
      'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skipSuccessfulRequests: config.skipSuccessfulRequests || false,
    skipFailedRequests: config.skipFailedRequests || false,
    keyGenerator: config.keyGenerator || generateRateLimitKey,
    handler: rateLimitHandler,
    skip: (req: Request) => {
      // Skip rate limiting for health checks and metrics
      return (
        req.path === '/health' ||
        req.path === '/api/health' ||
        req.path === '/metrics' ||
        req.path === '/api/ml/health'
      );
    },
  });
}

/**
 * Strict rate limiter for authentication endpoints
 */
export const authRateLimiter = createRateLimiter({
  windowMs: rateLimits.AUTH_WINDOW_MS, // 15 minutes from config
  max: rateLimits.AUTH_MAX_REQUESTS, // 20 requests per 15 minutes from config (increased from 5)
  message: 'Too many authentication attempts, please try again later',
  skipSuccessfulRequests: true,
});

// Export with shorter alias for compatibility
export const authLimiter = authRateLimiter;

/**
 * Custom handler for password reset rate limit with Czech message
 */
const passwordResetRateLimitHandler = (req: Request, res: Response): void => {
  logger.warn('Password reset rate limit exceeded', 'RateLimit', {
    ip: req.ip,
    userId: (req as Request & { user?: { id?: string } }).user?.id,
    path: req.path,
    method: req.method,
  });

  ResponseHelper.rateLimit(
    res,
    'Příliš mnoho pokusů o reset hesla. Zkuste to prosím znovu za 10 minut.'
  );
};

/**
 * Rate limiter for password reset requests
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Limit each IP/user to 5 password reset requests per 10 minutes
  message:
    'Příliš mnoho pokusů o reset hesla. Zkuste to prosím znovu za 10 minut.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: generateRateLimitKey,
  handler: passwordResetRateLimitHandler,
  skip: (req: Request) => {
    return (
      req.path === '/health' ||
      req.path === '/api/health' ||
      req.path === '/metrics' ||
      req.path === '/api/ml/health'
    );
  },
});

// Export with shorter alias for compatibility
export const passwordResetLimiter = passwordResetRateLimiter;

/**
 * General API rate limiter
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: rateLimits.API_WINDOW_MS, // 5 minutes from config
  max: rateLimits.API_MAX_REQUESTS, // 1000 requests per 5 minutes from config
  message: 'Too many API requests, please try again later',
  skipSuccessfulRequests: false,
});

// Export with shorter alias for compatibility
export const apiLimiter = apiRateLimiter;

/**
 * Per-user limit on the /api/feedback POST endpoint. 5 submissions per
 * minute is generous for legitimate use but cheap enough to absorb
 * occasional duplicate-submit click spam without paging the maintainer.
 * Default keyGenerator falls back to IP when auth is missing, so
 * unauthenticated curl gets the same budget.
 */
export const feedbackRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many feedback submissions, please wait a minute',
});

// Export all rate limiters
export default {
  createRateLimiter,
  authRateLimiter,
  passwordResetRateLimiter,
  apiRateLimiter,
  feedbackRateLimiter,
};
