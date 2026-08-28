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
  /** NOT READ. Both of these existed only to seed the ETag this middleware
   *  used to generate, and that generation is gone — see createCacheMiddleware
   *  for why. They are kept so the existing call sites still type-check, but
   *  nothing namespaces or keys anything on them today; passing a value has no
   *  effect. */
  namespace?: string;
  /** NOT READ — see `namespace`. */
  keyGenerator?: (req: Request) => string;
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

        // NO ETag IS SET HERE, DELIBERATELY. This middleware runs BEFORE the
        // handler, so the response body does not exist yet and anything it
        // could hash would describe the REQUEST, not the content — which is
        // what an ETag has to identify.
        //
        // It used to hash `${url}-${timestamp}` and truncate to 16 base64
        // characters. Sixteen base64 characters encode twelve bytes, and the
        // first twelve bytes of every URL on this router are `/api/images/`,
        // so every response carried the SAME ETag: "L2FwaS9pbWFnZXMv". The
        // server honoured it too — a request for any frame with that
        // If-None-Match got a 304, whatever its content or length.
        //
        // Worse, it suppressed the correct one. `res.sendFile` sets an ETag
        // from the file's size and mtime, but only `if (!res.getHeader('ETag'))`
        // (send/index.js:763), and `res.json`/`res.send` likewise generate a
        // body-derived ETag only when none is present. Setting a placeholder
        // here is exactly what stopped both. Leaving the header alone gives
        // every route a content-derived ETag from Express itself.
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
  conditionalCache,
  cacheMiddleware,
  cacheInvalidationMiddleware,
};
