// TODO: Install compression package - temporarily commented out for TypeScript compilation
// import compression from 'compression';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Smart compression middleware that applies different compression strategies
 * based on response type and size
 * TODO: Uncomment when compression package is installed
 */
export const smartCompression = (req: Request, res: Response, next: NextFunction): void => {
  // Temporary no-op implementation until compression package is installed
  next();
};

/*
// Original implementation - uncomment when compression package is installed:
export const smartCompression = compression({
  // Only compress responses larger than 1KB
  threshold: 1024,

  // Custom filter to determine what should be compressed
  filter: (req: Request, res: Response): boolean => {
    // Don't compress if the client doesn't support it
    if (!req.headers['accept-encoding']?.includes('gzip')) {
      return false;
    }

    // Don't compress images, videos, or already compressed content
    const contentType = res.get('Content-Type') || '';
    if (contentType.startsWith('image/') ||
        contentType.startsWith('video/') ||
        contentType.includes('zip') ||
        contentType.includes('gzip')) {
      return false;
    }

    // Compress JSON responses (API responses)
    if (contentType.includes('application/json')) {
      return true;
    }

    // Compress HTML, CSS, JavaScript
    if (contentType.includes('text/') ||
        contentType.includes('application/javascript') ||
        contentType.includes('application/xml')) {
      return true;
    }

    // Use compression's default filter for other cases
    return compression.filter(req, res);
  },

  // Compression level (1-9, 6 is default good balance)
  level: 6,

  // Set memory level for compression (1-9, 8 is default)
  memLevel: 8,

  // Compression strategy
  strategy: compression.constants.Z_DEFAULT_STRATEGY
});
*/

/**
 * Middleware to add performance headers to responses
 */
export const performanceHeaders = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Override res.json to add performance metrics
  const originalJson = res.json;
  res.json = function(obj: any) {
    const processingTime = Date.now() - startTime;

    // Add performance headers
    res.set('X-Response-Time', `${processingTime}ms`);
    res.set('X-Cache-Status', res.get('X-Cache-Status') || 'MISS');

    // Log slow responses
    if (processingTime > 1000) {
      logger.warn(`Slow response detected: ${req.method} ${req.path} took ${processingTime}ms`, 'Performance');
    }

    return originalJson.call(this, obj);
  };

  next();
};

/**
 * Response size monitoring middleware
 */
export const responseSizeMonitor = (req: Request, res: Response, next: NextFunction): void => {
  const originalSend = res.send;
  const originalJson = res.json;

  res.send = function(data: any) {
    const size = Buffer.byteLength(data, 'utf8');
    res.set('X-Content-Length', size.toString());

    // Log large responses
    if (size > 1024 * 1024) { // 1MB
      logger.warn(`Large response: ${req.method} ${req.path} - ${(size / 1024 / 1024).toFixed(2)}MB`, 'Performance');
    }

    return originalSend.call(this, data);
  };

  res.json = function(obj: any) {
    const data = JSON.stringify(obj);
    const size = Buffer.byteLength(data, 'utf8');
    res.set('X-Content-Length', size.toString());

    // Log large JSON responses
    if (size > 500 * 1024) { // 500KB
      logger.warn(`Large JSON response: ${req.method} ${req.path} - ${(size / 1024).toFixed(2)}KB`, 'Performance');
    }

    return originalJson.call(this, obj);
  };

  next();
};

export default {
  smartCompression,
  performanceHeaders,
  responseSizeMonitor
};