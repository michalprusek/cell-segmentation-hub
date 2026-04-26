import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import type { MockedFunction } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// All mocks BEFORE source imports
// ---------------------------------------------------------------------------

// Capture every config object passed to rateLimit() at module load time.
// We use a module-scoped array so Jest's resetMocks/clearMocks does NOT wipe it.
const capturedConfigs: Array<Record<string, unknown>> = [];

vi.mock('express-rate-limit', () => {
  const mockRateLimit = vi.fn(
    (config: Record<string, unknown>) => {
      capturedConfigs.push(config);
      // Return a lightweight middleware stub that simply calls next()
      const middleware = vi.fn(
        (_req: Request, _res: Response, next: NextFunction) => next()
      );
      (middleware as unknown as Record<string, unknown>).__config = config;
      return middleware;
    }
  );
  return { __esModule: true, default: mockRateLimit };
});

vi.mock('../../utils/logger', () => ({
  __esModule: true,
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../utils/response', () => ({
  __esModule: true,
  ResponseHelper: {
    rateLimit: vi.fn(),
    validationError: vi.fn(),
    internalError: vi.fn(),
    unauthorized: vi.fn(),
  },
}));

vi.mock('../../config/uploadLimits', () => ({
  __esModule: true,
  getUploadLimitsForEnvironment: vi.fn(() => ({
    AUTH_WINDOW_MS: 15 * 60 * 1000,   // 15 minutes
    AUTH_MAX_REQUESTS: 20,
    API_WINDOW_MS: 5 * 60 * 1000,     // 5 minutes
    API_MAX_REQUESTS: 1000,
    UPLOAD_WINDOW_MS: 5 * 60 * 1000,
    UPLOAD_MAX_REQUESTS: 200,
    BULK_UPLOAD_WINDOW_MS: 5 * 60 * 1000,
    BULK_UPLOAD_MAX_REQUESTS: 10000,
    PROCESSING_WINDOW_MS: 10 * 60 * 1000,
    PROCESSING_MAX_REQUESTS: 20,
  })),
}));

import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import rateLimit from 'express-rate-limit';
import {
  authRateLimiter,
  apiRateLimiter,
} from '../rateLimiter';

const mockRateLimit = rateLimit as MockedFunction<typeof rateLimit>;

// Snapshot of configs captured during module import (immutable reference)
// These are populated the first time the module is imported and never cleared.
// They represent the real rate limiter configurations used by the app.
let moduleLoadConfigs: Array<Record<string, unknown>> = [];

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------
const buildReq = (overrides: Partial<Request> = {}): Partial<Request> => ({
  ip: '127.0.0.1',
  path: '/api/test',
  method: 'POST',
  connection: { remoteAddress: '127.0.0.1' } as Request['connection'],
  headers: {},
  ...overrides,
});

const buildRes = (): Partial<Response> => ({
  status: vi.fn().mockReturnThis() as unknown as Response['status'],
  json: vi.fn().mockReturnThis() as unknown as Response['json'],
  send: vi.fn().mockReturnThis() as unknown as Response['send'],
  headersSent: false,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Rate Limiter Middleware', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    // IMPORTANT: do NOT reset capturedConfigs — module-load configs are
    // captured once at import time and must remain accessible across all tests.
    // Save a stable snapshot the first time beforeEach runs.
    if (moduleLoadConfigs.length === 0 && capturedConfigs.length > 0) {
      moduleLoadConfigs = [...capturedConfigs];
    }

    // Only clear call counts, not captured config data
    vi.clearAllMocks();

    mockNext = vi.fn() as NextFunction;
  });

  // -------------------------------------------------------------------------
  // Exports exist and are callable middleware
  // -------------------------------------------------------------------------
  describe('authRateLimiter export', () => {
    it('exports a callable middleware function', () => {
      expect(typeof authRateLimiter).toBe('function');
    });

    it('is an Express-style middleware (accepts req, res, next)', () => {
      // Verify the function arity — Express middleware takes 3 arguments
      expect(authRateLimiter.length).toBe(3);
    });
  });

  describe('apiRateLimiter export', () => {
    it('exports a callable middleware function', () => {
      expect(typeof apiRateLimiter).toBe('function');
    });

    it('is an Express-style middleware (accepts req, res, next)', () => {
      expect(apiRateLimiter.length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // rateLimit() factory was called with expected configurations
  // -------------------------------------------------------------------------
  describe('rate limiter configurations', () => {
    it('express-rate-limit factory was called at least twice (auth + api)', () => {
      expect(mockRateLimit.mock.calls.length + capturedConfigs.length).toBeGreaterThan(0);
      // The module defines many limiters — at least authRateLimiter + apiRateLimiter
      expect(capturedConfigs.length).toBeGreaterThanOrEqual(2);
    });

    it('authRateLimiter config has windowMs = 15 minutes', () => {
      const authConfig = capturedConfigs.find(
        c => c.windowMs === 15 * 60 * 1000 && (c.max as number) <= 20
      );
      expect(authConfig).toBeDefined();
      expect(authConfig?.windowMs).toBe(15 * 60 * 1000);
    });

    it('authRateLimiter config has max = 20', () => {
      const authConfig = capturedConfigs.find(
        c => c.windowMs === 15 * 60 * 1000 && (c.max as number) <= 20
      );
      expect(authConfig?.max).toBe(20);
    });

    it('apiRateLimiter config has windowMs = 5 minutes', () => {
      const apiConfig = capturedConfigs.find(
        c => c.windowMs === 5 * 60 * 1000 && (c.max as number) >= 1000
      );
      expect(apiConfig).toBeDefined();
      expect(apiConfig?.windowMs).toBe(5 * 60 * 1000);
    });

    it('apiRateLimiter config has max = 1000', () => {
      const apiConfig = capturedConfigs.find(
        c => c.windowMs === 5 * 60 * 1000 && (c.max as number) === 1000
      );
      expect(apiConfig?.max).toBe(1000);
    });

    it('all created limiters use standardHeaders: true', () => {
      expect(capturedConfigs.length).toBeGreaterThan(0);
      for (const cfg of capturedConfigs) {
        expect(cfg.standardHeaders).toBe(true);
      }
    });

    it('all created limiters use legacyHeaders: false', () => {
      expect(capturedConfigs.length).toBeGreaterThan(0);
      for (const cfg of capturedConfigs) {
        expect(cfg.legacyHeaders).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // skip() function — health-check paths bypass limiting
  // -------------------------------------------------------------------------
  describe('skip() function skips health-check paths', () => {
    // Retrieve the skip function from the first captured config.
    // We access it directly from capturedConfigs (not moduleLoadConfigs snapshot)
    // because the array is populated once at module-load and not cleared.
    const getSkipFn = (): ((req: Partial<Request>) => boolean) => {
      const cfg = capturedConfigs[0];
      if (!cfg) {
        throw new Error('No rate limiter configs captured — ensure rateLimiter module was imported');
      }
      return cfg.skip as (req: Partial<Request>) => boolean;
    };

    it('returns true for /health path', () => {
      const skip = getSkipFn();
      expect(skip(buildReq({ path: '/health' }))).toBe(true);
    });

    it('returns true for /api/health path', () => {
      const skip = getSkipFn();
      expect(skip(buildReq({ path: '/api/health' }))).toBe(true);
    });

    it('returns true for /metrics path', () => {
      const skip = getSkipFn();
      expect(skip(buildReq({ path: '/metrics' }))).toBe(true);
    });

    it('returns true for /api/ml/health path', () => {
      const skip = getSkipFn();
      expect(skip(buildReq({ path: '/api/ml/health' }))).toBe(true);
    });

    it('returns false for a normal API path', () => {
      const skip = getSkipFn();
      expect(skip(buildReq({ path: '/api/projects' }))).toBe(false);
    });

    it('returns false for /api/users path', () => {
      const skip = getSkipFn();
      expect(skip(buildReq({ path: '/api/users' }))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // handler() — rate limit exceeded callback
  // -------------------------------------------------------------------------
  describe('rate limit handler', () => {
    const getHandler = (): ((
      req: Partial<Request>,
      res: Partial<Response>,
      next?: NextFunction
    ) => void) => {
      const cfg = capturedConfigs[0];
      if (!cfg) {
        throw new Error('No rate limiter configs captured — ensure rateLimiter module was imported');
      }
      return cfg.handler as (
        req: Partial<Request>,
        res: Partial<Response>,
        next?: NextFunction
      ) => void;
    };

    it('logs a warning when rate limit is exceeded', () => {
      const handler = getHandler();
      const req = buildReq({ path: '/api/login', method: 'POST' });
      const res = buildRes();

      handler(req, res);

      expect(logger.warn).toHaveBeenCalledWith(
        'Rate limit exceeded',
        'RateLimit',
        expect.objectContaining({ path: '/api/login' })
      );
    });

    it('calls ResponseHelper.rateLimit() when rate limit is triggered', () => {
      const handler = getHandler();
      const req = buildReq();
      const res = buildRes();

      handler(req, res);

      expect(ResponseHelper.rateLimit).toHaveBeenCalledWith(
        res,
        expect.stringContaining('Too many requests')
      );
    });

    it('does not call next() — handler terminates the request', () => {
      const handler = getHandler();
      const req = buildReq();
      const res = buildRes();

      handler(req, res, mockNext);

      // The rate limit handler sends a response and does NOT forward to next()
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
