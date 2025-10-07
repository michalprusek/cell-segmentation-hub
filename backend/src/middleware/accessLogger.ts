import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../types/auth';
import { logger } from '../utils/logger';

/**
 * Access Log Middleware
 *
 * Logs all HTTP requests with user information to a persistent file.
 * This provides comprehensive audit trail for IT security requirements.
 *
 * Log format: [timestamp] IP_ADDRESS USERNAME METHOD URL STATUS_CODE DURATION USER_AGENT
 */

const LOG_DIR = process.env.LOG_DIR || '/app/logs';
const ACCESS_LOG_PATH = path.join(LOG_DIR, 'access.log');

// Time-windowed deduplication configuration
const DEDUPLICATION_WINDOW_MS = 5000; // 5 seconds
const MAX_DEDUP_CACHE_SIZE = 1000; // Limit memory usage

// Health check endpoints to skip (reduces verbosity)
const SKIP_ENDPOINTS = ['/health', '/api/health'];

/**
 * LRU Cache for time-windowed request deduplication
 * Prevents duplicate log entries for identical requests within a time window
 */
class RequestDeduplicator {
  private cache: Map<string, number>;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cache = new Map();

    // Periodic cleanup of expired entries (every 10 seconds)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10000);

    // Ensure cleanup on process exit
    process.on('beforeExit', () => {
      clearInterval(this.cleanupInterval);
    });
  }

  /**
   * Check if request should be logged (not a duplicate within time window)
   */
  shouldLog(deduplicationKey: string): boolean {
    const now = Date.now();
    const lastSeen = this.cache.get(deduplicationKey);

    if (lastSeen && now - lastSeen < DEDUPLICATION_WINDOW_MS) {
      // Duplicate within time window - skip logging
      return false;
    }

    // Update timestamp for this request
    this.cache.set(deduplicationKey, now);

    // Enforce cache size limit (LRU behavior)
    if (this.cache.size > MAX_DEDUP_CACHE_SIZE) {
      // Remove oldest entries (first entries in Map)
      const keysToDelete = Array.from(this.cache.keys()).slice(
        0,
        Math.floor(MAX_DEDUP_CACHE_SIZE * 0.2)
      );
      keysToDelete.forEach(key => this.cache.delete(key));
    }

    return true;
  }

  /**
   * Remove expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    for (const [key, timestamp] of this.cache.entries()) {
      if (now - timestamp >= DEDUPLICATION_WINDOW_MS) {
        entriesToDelete.push(key);
      }
    }

    entriesToDelete.forEach(key => this.cache.delete(key));

    // Log cleanup stats in development
    if (process.env.NODE_ENV === 'development' && entriesToDelete.length > 0) {
      logger.debug(
        `[AccessLogger] Cleaned ${entriesToDelete.length} expired deduplication entries`,
        'RequestDeduplicator',
        { cacheSize: this.cache.size }
      );
    }
  }

  /**
   * Get current cache size (for monitoring)
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

// Initialize deduplicator
const deduplicator = new RequestDeduplicator();

// Ensure log directory exists
function ensureLogDirectory(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (error) {
    logger.error('Failed to create log directory:', error);
  }
}

// Initialize log directory
ensureLogDirectory();

/**
 * Format access log entry according to IT standards
 * Note: Excludes timestamp from comparison key for deduplication
 */
function formatAccessLog(
  timestamp: string,
  ip: string,
  username: string,
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  userAgent: string
): string {
  // Sanitize user agent to prevent log injection
  const safeUserAgent = userAgent.replace(/[\r\n]/g, ' ').substring(0, 200);

  return `[${timestamp}] ${ip} ${username} ${method} ${url} ${statusCode} ${duration}ms "${safeUserAgent}"\n`;
}

/**
 * Create deduplication key from log entry (excludes timestamp and duration)
 * This allows us to detect duplicate requests even if timing varies
 */
function getDeduplicationKey(
  ip: string,
  username: string,
  method: string,
  url: string,
  statusCode: number,
  userAgent: string
): string {
  const safeUserAgent = userAgent.replace(/[\r\n]/g, ' ').substring(0, 200);
  return `${ip}|${username}|${method}|${url}|${statusCode}|${safeUserAgent}`;
}

/**
 * Extract real IP address from request
 * Handles X-Real-IP and X-Forwarded-For headers from nginx proxy
 */
function getClientIP(req: Request): string {
  // Priority order for IP detection
  const xRealIP = req.headers['x-real-ip'] as string;
  const xForwardedFor = req.headers['x-forwarded-for'] as string;

  if (xRealIP) {
    return xRealIP;
  }

  if (xForwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first one (original client)
    return xForwardedFor.split(',')[0].trim();
  }

  // Fallback to req.ip (from Express)
  return req.ip || 'unknown';
}

/**
 * Extract username from authenticated request
 */
function getUsername(req: AuthRequest): string {
  if (req.user?.email) {
    return req.user.email;
  }
  return 'anonymous';
}

/**
 * Append log entry to access log file (only if not duplicate within time window)
 */
function writeToAccessLog(logEntry: string, deduplicationKey: string): void {
  // Check if this entry is duplicate within time window
  if (!deduplicator.shouldLog(deduplicationKey)) {
    // Skip duplicate - don't write to log
    return;
  }

  try {
    fs.appendFileSync(ACCESS_LOG_PATH, logEntry, { encoding: 'utf8' });
  } catch (error) {
    // Log using logger if file write fails, but don't crash the server
    logger.error(
      'Failed to write to access log:',
      error instanceof Error ? error : undefined,
      'accessLogger'
    );
  }
}

/**
 * Access Logger Middleware
 *
 * Captures all HTTP requests with:
 * - Timestamp
 * - Client IP address (from X-Real-IP or X-Forwarded-For)
 * - Username (from JWT token) or "anonymous"
 * - HTTP method and URL
 * - Response status code
 * - Request duration in milliseconds
 * - User agent
 *
 * Features:
 * - Skips health check endpoints to reduce verbosity
 * - Deduplicates consecutive identical requests
 *
 * Logs are written to: /app/logs/access.log
 */
export const accessLogger = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const url = req.originalUrl || req.url;

  // Skip health check endpoints to reduce log verbosity
  if (SKIP_ENDPOINTS.includes(url)) {
    next();
    return;
  }

  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const ip = getClientIP(req);
  const method = req.method;
  const userAgent = req.get('User-Agent') || 'unknown';

  // Capture response finish event
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const username = getUsername(req);

    // Create deduplication key (excludes timestamp and duration)
    const deduplicationKey = getDeduplicationKey(
      ip,
      username,
      method,
      url,
      statusCode,
      userAgent
    );

    const logEntry = formatAccessLog(
      timestamp,
      ip,
      username,
      method,
      url,
      statusCode,
      duration,
      userAgent
    );

    // Write to access log file (will skip if duplicate)
    writeToAccessLog(logEntry, deduplicationKey);

    // Also log using logger in development for debugging
    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        `[ACCESS] ${ip} ${username} ${method} ${url} ${statusCode} ${duration}ms`
      );
    }
  });

  next();
};

/**
 * Export functions and classes for testing
 */
export const testExports = {
  formatAccessLog,
  getClientIP,
  getUsername,
  getDeduplicationKey,
  ACCESS_LOG_PATH,
  deduplicator,
  DEDUPLICATION_WINDOW_MS,
  MAX_DEDUP_CACHE_SIZE,
};
