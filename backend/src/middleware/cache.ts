import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Cache middleware for API responses
 */

export interface CacheOptions {
  maxAge?: number; // in seconds
  ttl?: number; // TTL alias for maxAge
  private?: boolean;
  noCache?: boolean;
  mustRevalidate?: boolean;
  staleWhileRevalidate?: number;
  namespace?: string; // Cache namespace
  keyGenerator?: (req: Request) => string; // Custom key generation
}

/**
 * Create cache control headers middleware
 */
export function createCacheMiddleware(options: CacheOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Support both maxAge and ttl
      const maxAge = options.maxAge ?? options.ttl ?? 0;
      const optionsWithMaxAge = { ...options, maxAge };

      const cacheControl = buildCacheControlHeader(optionsWithMaxAge);

      if (cacheControl) {
        res.setHeader('Cache-Control', cacheControl);

        // Set Expires header if maxAge is specified
        if (maxAge > 0) {
          const expires = new Date(Date.now() + maxAge * 1000);
          res.setHeader('Expires', expires.toUTCString());
        }

        // Add ETag support for better caching
        if (maxAge > 0 && !options.noCache) {
          const etag = options.keyGenerator
            ? generateCustomETag(req, options.keyGenerator)
            : generateETag(req);
          if (etag) {
            res.setHeader('ETag', etag);
          }
        }
      }

      next();
    } catch (error) {
      logger.error('Cache middleware error:', error as Error);
      next(error);
    }
  };
}

/**
 * Build Cache-Control header value
 */
function buildCacheControlHeader(options: CacheOptions): string {
  const directives: string[] = [];

  if (options.noCache) {
    directives.push('no-cache');
  }

  if (options.private) {
    directives.push('private');
  } else {
    directives.push('public');
  }

  if (options.maxAge > 0) {
    directives.push(`max-age=${options.maxAge}`);
  }

  if (options.mustRevalidate) {
    directives.push('must-revalidate');
  }

  if (options.staleWhileRevalidate) {
    directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }

  return directives.join(', ');
}

/**
 * Generate ETag for request
 */
function generateETag(req: Request): string | null {
  try {
    // Simple ETag generation based on URL and query parameters
    const url = req.originalUrl || req.url;
    const timestamp = Math.floor(Date.now() / 1000); // Round to seconds
    const hash = Buffer.from(`${url}-${timestamp}`).toString('base64');
    return `"${hash.slice(0, 16)}"`;
  } catch (error) {
    logger.warn('Failed to generate ETag:', error);
    return null;
  }
}

/**
 * Generate custom ETag using key generator
 */
function generateCustomETag(
  req: Request,
  keyGenerator: (req: Request) => string
): string | null {
  try {
    const key = keyGenerator(req);
    const timestamp = Math.floor(Date.now() / 1000); // Round to seconds
    const hash = Buffer.from(`${key}-${timestamp}`).toString('base64');
    return `"${hash.slice(0, 16)}"`;
  } catch (error) {
    logger.warn('Failed to generate custom ETag:', error);
    return null;
  }
}

/**
 * No-cache middleware - prevents caching
 */
export const noCache = createCacheMiddleware({
  maxAge: 0,
  noCache: true,
  mustRevalidate: true,
  private: true,
});

/**
 * Short cache middleware - 5 minutes
 */
export const shortCache = createCacheMiddleware({
  maxAge: 300, // 5 minutes
  private: false,
  mustRevalidate: true,
  staleWhileRevalidate: 60, // Allow stale for 1 minute
});

/**
 * Medium cache middleware - 1 hour
 */
export const mediumCache = createCacheMiddleware({
  maxAge: 3600, // 1 hour
  private: false,
  staleWhileRevalidate: 300, // Allow stale for 5 minutes
});

/**
 * Long cache middleware - 1 day
 */
export const longCache = createCacheMiddleware({
  maxAge: 86400, // 1 day
  private: false,
  staleWhileRevalidate: 3600, // Allow stale for 1 hour
});

/**
 * Static asset cache middleware - 30 days
 */
export const staticCache = createCacheMiddleware({
  maxAge: 2592000, // 30 days
  private: false,
});

/**
 * API response cache middleware - 10 minutes
 */
export const apiCache = createCacheMiddleware({
  maxAge: 600, // 10 minutes
  private: true,
  mustRevalidate: true,
  staleWhileRevalidate: 120, // Allow stale for 2 minutes
});

/**
 * Conditional cache middleware based on environment
 */
export const conditionalCache = Object.assign(
  (development: CacheOptions, production: CacheOptions) => {
    const isDev = process.env.NODE_ENV === 'development';
    return createCacheMiddleware(isDev ? development : production);
  },
  {
    /**
     * User-specific cache middleware
     */
    userSpecific: (ttl: number) => {
      return (req: Request, res: Response, next: NextFunction): void => {
        // Add cache headers for user-specific content
        const userId = (req as Request & { user?: { id?: string } }).user?.id;
        if (userId) {
          res.setHeader('Cache-Control', `private, max-age=${ttl}`);
          res.setHeader('Vary', 'Authorization');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
        next();
      };
    },

    /**
     * Public cache middleware
     */
    public: (ttl: number) => {
      return createCacheMiddleware({
        maxAge: ttl,
        private: false,
        mustRevalidate: true,
      });
    },
  }
);

/**
 * Cache-busting middleware for dynamic content
 */
export const bustCache = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  } catch (error) {
    logger.error('Cache busting middleware error:', error as Error);
    next(error);
  }
};

/**
 * Vary header middleware to indicate response varies based on headers
 */
export function createVaryMiddleware(headers: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const varyHeader = headers.join(', ');
      res.setHeader('Vary', varyHeader);
      next();
    } catch (error) {
      logger.error('Vary middleware error:', error as Error);
      next(error);
    }
  };
}

/**
 * Common Vary middleware for API responses
 */
export const varyOnAcceptEncoding = createVaryMiddleware(['Accept-Encoding']);
export const varyOnAuthorization = createVaryMiddleware(['Authorization']);
export const varyOnUserAgent = createVaryMiddleware(['User-Agent']);
export const varyOnAcceptLanguage = createVaryMiddleware(['Accept-Language']);

/**
 * Cache middleware for Express routes
 */
export const cacheMiddleware = createCacheMiddleware;

/**
 * Cache invalidation middleware factory
 */
export const cacheInvalidationMiddleware = (
  patternGenerator: (req: Request) => string[]
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Invalidate cache after successful response
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const patterns = patternGenerator(req);
        patterns.forEach(pattern => {
          logger.info(
            `Cache invalidation triggered for pattern: ${pattern}`,
            'Cache'
          );
          // Here you would actually invalidate the cache patterns
          // This is a placeholder for the actual cache invalidation logic
        });
      }
    });
    next();
  };
};

export default {
  createCacheMiddleware,
  noCache,
  shortCache,
  mediumCache,
  longCache,
  staticCache,
  apiCache,
  conditionalCache,
  bustCache,
  createVaryMiddleware,
  varyOnAcceptEncoding,
  varyOnAuthorization,
  varyOnUserAgent,
  varyOnAcceptLanguage,
  cacheMiddleware,
  cacheInvalidationMiddleware,
};
