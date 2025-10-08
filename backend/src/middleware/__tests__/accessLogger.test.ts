import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { accessLogger, testExports } from '../accessLogger';
import { AuthRequest } from '../../types/auth';

// Mock fs module
jest.mock('fs');

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Access Logger Middleware', () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let finishCallback: (() => void) | null;

  beforeEach(() => {
    jest.clearAllMocks();
    finishCallback = null;

    // Mock fs operations
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(fs.mkdirSync).mockReturnValue(undefined);
    jest.mocked(fs.appendFileSync).mockReturnValue(undefined);

    // Setup mock request
    mockReq = {
      originalUrl: '/api/test',
      url: '/api/test',
      method: 'GET',
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'test-agent',
      },
      get: jest.fn((header: string) => {
        if (header === 'User-Agent') return 'test-agent';
        return undefined;
      }),
      user: undefined,
    };

    // Setup mock response with finish event emitter
    mockRes = {
      statusCode: 200,
      on: jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockRes as Response;
      }),
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Basic Logging', () => {
    it('should log request with anonymous user', () => {
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();

      // Trigger finish event
      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('access.log'),
        expect.stringContaining('anonymous'),
        { encoding: 'utf8' }
      );
    });

    it('should log request with authenticated user', () => {
      mockReq.user = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      };

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('test@example.com'),
        { encoding: 'utf8' }
      );
    });

    it('should include method, URL, status code, and duration', () => {
      mockReq.method = 'POST';
      mockReq.originalUrl = '/api/projects/123';
      mockRes.statusCode = 201;

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      if (finishCallback) {
        finishCallback();
      }

      const logCall = jest.mocked(fs.appendFileSync).mock.calls[0];
      const logEntry = logCall[1] as string;

      expect(logEntry).toContain('POST');
      expect(logEntry).toContain('/api/projects/123');
      expect(logEntry).toContain('201');
      expect(logEntry).toMatch(/\d+ms/); // Duration in ms
    });

    it('should handle missing user agent gracefully', () => {
      mockReq.get = jest.fn(() => undefined);

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('unknown'),
        { encoding: 'utf8' }
      );
    });
  });

  describe('Health Check Endpoint Filtering', () => {
    it('should skip logging for /health endpoint', () => {
      mockReq.originalUrl = '/health';

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();

      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it('should skip logging for /api/health endpoint', () => {
      mockReq.originalUrl = '/api/health';

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();

      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it('should log non-health endpoints', () => {
      mockReq.originalUrl = '/api/projects';

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalled();
    });
  });

  describe('IP Address Detection', () => {
    it('should extract IP from X-Real-IP header', () => {
      const { getClientIP } = testExports;
      mockReq.headers = {
        'x-real-ip': '192.168.1.100',
      };

      const ip = getClientIP(mockReq as Request);
      expect(ip).toBe('192.168.1.100');
    });

    it('should extract IP from X-Forwarded-For header', () => {
      const { getClientIP } = testExports;
      mockReq.headers = {
        'x-forwarded-for': '192.168.1.100, 10.0.0.1, 172.16.0.1',
      };

      const ip = getClientIP(mockReq as Request);
      expect(ip).toBe('192.168.1.100'); // First IP in the chain
    });

    it('should prioritize X-Real-IP over X-Forwarded-For', () => {
      const { getClientIP } = testExports;
      mockReq.headers = {
        'x-real-ip': '192.168.1.100',
        'x-forwarded-for': '10.0.0.1',
      };

      const ip = getClientIP(mockReq as Request);
      expect(ip).toBe('192.168.1.100');
    });

    it('should fallback to req.ip when headers missing', () => {
      const { getClientIP } = testExports;
      mockReq.ip = '127.0.0.1';
      mockReq.headers = {};

      const ip = getClientIP(mockReq as Request);
      expect(ip).toBe('127.0.0.1');
    });
  });

  describe('Time-Windowed Deduplication', () => {
    beforeEach(() => {
      // Clear the deduplicator cache between tests
      const { deduplicator } = testExports;
      // Access private cache through reflection for testing
      (deduplicator as any).cache.clear();
    });

    it('should log first request', () => {
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    });

    it('should skip duplicate request within time window', () => {
      // First request
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);

      // Reset mocks but keep deduplicator state
      jest.mocked(fs.appendFileSync).mockClear();

      // Second identical request immediately
      finishCallback = null;
      mockRes.on = jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockRes as Response;
      });

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
      if (finishCallback) {
        finishCallback();
      }

      // Should be deduplicated
      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it('should log request after time window expires', async () => {
      const { DEDUPLICATION_WINDOW_MS } = testExports;

      // First request
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);

      // Wait for deduplication window to expire
      await new Promise(resolve =>
        setTimeout(resolve, DEDUPLICATION_WINDOW_MS + 100)
      );

      // Reset mocks
      jest.mocked(fs.appendFileSync).mockClear();
      finishCallback = null;
      mockRes.on = jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockRes as Response;
      });

      // Second request after window
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
      if (finishCallback) {
        finishCallback();
      }

      // Should be logged again
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent different requests correctly', () => {
      // First request to /api/projects
      mockReq.originalUrl = '/api/projects';
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);

      // Reset mocks
      jest.mocked(fs.appendFileSync).mockClear();
      finishCallback = null;
      mockRes.on = jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockRes as Response;
      });

      // Second request to different URL
      mockReq.originalUrl = '/api/images';
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
      if (finishCallback) {
        finishCallback();
      }

      // Should log both (different URLs)
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    });

    it('should differentiate requests with different status codes', () => {
      // First request with 200
      mockRes.statusCode = 200;
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
      if (finishCallback) {
        finishCallback();
      }

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);

      // Reset mocks
      jest.mocked(fs.appendFileSync).mockClear();
      finishCallback = null;
      mockRes.on = jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockRes as Response;
      });

      // Second request with 500
      mockRes.statusCode = 500;
      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
      if (finishCallback) {
        finishCallback();
      }

      // Should log both (different status codes)
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('Deduplication Key Generation', () => {
    it('should generate consistent key for same request', () => {
      const { getDeduplicationKey } = testExports;

      const key1 = getDeduplicationKey(
        '127.0.0.1',
        'test@example.com',
        'GET',
        '/api/test',
        200,
        'test-agent'
      );

      const key2 = getDeduplicationKey(
        '127.0.0.1',
        'test@example.com',
        'GET',
        '/api/test',
        200,
        'test-agent'
      );

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different requests', () => {
      const { getDeduplicationKey } = testExports;

      const key1 = getDeduplicationKey(
        '127.0.0.1',
        'test@example.com',
        'GET',
        '/api/test',
        200,
        'test-agent'
      );

      const key2 = getDeduplicationKey(
        '127.0.0.1',
        'test@example.com',
        'POST', // Different method
        '/api/test',
        200,
        'test-agent'
      );

      expect(key1).not.toBe(key2);
    });

    it('should sanitize user agent to prevent log injection', () => {
      const { getDeduplicationKey } = testExports;

      const maliciousUserAgent = 'test\r\n[malicious] INJECTED\n\rentry';

      const key = getDeduplicationKey(
        '127.0.0.1',
        'test@example.com',
        'GET',
        '/api/test',
        200,
        maliciousUserAgent
      );

      // Should not contain newlines
      expect(key).not.toContain('\r');
      expect(key).not.toContain('\n');
    });
  });

  describe('Error Handling', () => {
    it('should handle fs.appendFileSync errors gracefully', () => {
      jest.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      if (finishCallback) {
        finishCallback();
      }

      // Should not throw - error handled internally
      expect(mockNext).toHaveBeenCalled();
    });

    it('should create log directory if missing', () => {
      jest.mocked(fs.existsSync).mockReturnValue(false);

      accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true })
      );
    });
  });

  describe('Log Format', () => {
    it('should format log entry correctly', () => {
      const { formatAccessLog } = testExports;

      const logEntry = formatAccessLog(
        '2024-01-01T00:00:00.000Z',
        '192.168.1.100',
        'test@example.com',
        'GET',
        '/api/test',
        200,
        150,
        'Mozilla/5.0'
      );

      expect(logEntry).toContain('[2024-01-01T00:00:00.000Z]');
      expect(logEntry).toContain('192.168.1.100');
      expect(logEntry).toContain('test@example.com');
      expect(logEntry).toContain('GET');
      expect(logEntry).toContain('/api/test');
      expect(logEntry).toContain('200');
      expect(logEntry).toContain('150ms');
      expect(logEntry).toContain('Mozilla/5.0');
      expect(logEntry).toEndWith('\n');
    });

    it('should sanitize user agent in log format', () => {
      const { formatAccessLog } = testExports;

      const maliciousUserAgent =
        'test\r\n[INJECTED] malicious\nentry\r\nfake log';

      const logEntry = formatAccessLog(
        '2024-01-01T00:00:00.000Z',
        '192.168.1.100',
        'test@example.com',
        'GET',
        '/api/test',
        200,
        150,
        maliciousUserAgent
      );

      // Should replace newlines with spaces
      expect(logEntry).not.toContain('\r\n[INJECTED]');
      expect(logEntry).not.toContain('\nfake log');
      expect(logEntry.split('\n').length).toBe(2); // Only one newline at end
    });

    it('should truncate very long user agents', () => {
      const { formatAccessLog } = testExports;

      const longUserAgent = 'A'.repeat(500);

      const logEntry = formatAccessLog(
        '2024-01-01T00:00:00.000Z',
        '192.168.1.100',
        'test@example.com',
        'GET',
        '/api/test',
        200,
        150,
        longUserAgent
      );

      // User agent should be truncated to 200 chars
      const match = logEntry.match(/"([^"]+)"/);
      expect(match).toBeTruthy();
      if (match) {
        expect(match[1].length).toBeLessThanOrEqual(200);
      }
    });
  });

  describe('Deduplicator Cache Management', () => {
    it('should enforce cache size limit', () => {
      const { deduplicator, MAX_DEDUP_CACHE_SIZE } = testExports;

      // Clear cache
      (deduplicator as any).cache.clear();

      // Add more entries than the limit
      for (let i = 0; i < MAX_DEDUP_CACHE_SIZE + 100; i++) {
        mockReq.originalUrl = `/api/test${i}`;
        accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
        if (finishCallback) {
          finishCallback();
        }

        // Reset for next iteration
        finishCallback = null;
        mockRes.on = jest.fn((event: string, callback: () => void) => {
          if (event === 'finish') {
            finishCallback = callback;
          }
          return mockRes as Response;
        });
      }

      // Cache should be limited
      const cacheSize = deduplicator.getCacheSize();
      expect(cacheSize).toBeLessThanOrEqual(MAX_DEDUP_CACHE_SIZE);
    });

    it('should provide cache size for monitoring', () => {
      const { deduplicator } = testExports;

      const initialSize = deduplicator.getCacheSize();
      expect(typeof initialSize).toBe('number');
      expect(initialSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance', () => {
    it('should process 1000 requests efficiently', () => {
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        mockReq.originalUrl = `/api/test${i}`;
        accessLogger(mockReq as AuthRequest, mockRes as Response, mockNext);
        if (finishCallback) {
          finishCallback();
        }

        // Reset for next iteration
        finishCallback = null;
        mockRes.on = jest.fn((event: string, callback: () => void) => {
          if (event === 'finish') {
            finishCallback = callback;
          }
          return mockRes as Response;
        });
      }

      const duration = Date.now() - startTime;

      // Should process 1000 requests in less than 1 second
      expect(duration).toBeLessThan(1000);
    });
  });
});
