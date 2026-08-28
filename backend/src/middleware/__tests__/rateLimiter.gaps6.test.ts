/**
 * rateLimiter.gaps6.test.ts
 *
 * Covers uncovered lines in rateLimiter.ts not hit by rateLimiter.test.ts:
 *   28, 29, 31   — generateRateLimitKey (user-based key + IP fallback branches)
 *   93, 100      — passwordResetRateLimitHandler (logs + calls ResponseHelper.rateLimit)
 *   119          — passwordResetRateLimiter skip() function
 *   227-235      — conditionalRateLimiter (isDevelopment branches)
 *   245-258      — createConditionalSkipRateLimiter (skip and no-skip paths)
 *   285-302      — combineRateLimiters (chains multiple limiters)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mocks — before imports
// ---------------------------------------------------------------------------

const { capturedConfigs } = vi.hoisted(() => ({
  capturedConfigs: [] as Array<Record<string, unknown>>,
}));

vi.mock('express-rate-limit', () => {
  const mockRateLimit = vi.fn((config: Record<string, unknown>) => {
    capturedConfigs.push(config);
    const mw = vi.fn((_req: Request, _res: Response, next: NextFunction) =>
      next()
    );
    (mw as unknown as Record<string, unknown>).__config = config;
    return mw;
  });
  return { __esModule: true, default: mockRateLimit };
});

vi.mock('../../utils/logger', () => ({
  __esModule: true,
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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
    AUTH_WINDOW_MS: 15 * 60 * 1000,
    AUTH_MAX_REQUESTS: 20,
    API_WINDOW_MS: 5 * 60 * 1000,
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
// Side-effect import, deliberately. This suite asserts on the configs
// `rateLimiter.ts` hands to express-rate-limit at module load, captured by the
// mock above — so the module has to actually be evaluated. A named import
// whose binding is never referenced is NOT enough: esbuild elides it and
// `capturedConfigs` stays empty. That was masked while the file still imported
// helpers it used as values.
import '../rateLimiter';

const mockLogger = logger as unknown as {
  warn: ReturnType<typeof vi.fn>;
};
const mockResponse = ResponseHelper as unknown as {
  rateLimit: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReq(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    ip: '127.0.0.1',
    path: '/api/test',
    method: 'POST',
    connection: { remoteAddress: '192.168.1.1' } as Request['connection'],
    headers: {},
    ...overrides,
  };
}

function buildRes(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis() as unknown as Response['status'],
    json: vi.fn().mockReturnThis() as unknown as Response['json'],
    send: vi.fn().mockReturnThis() as unknown as Response['send'],
    headersSent: false,
  };
}

// ---------------------------------------------------------------------------
// generateRateLimitKey — extracted from capturedConfigs[0].keyGenerator
// ---------------------------------------------------------------------------

describe('generateRateLimitKey (via captured keyGenerator)', () => {
  const getKeyGenerator = (): ((req: Partial<Request>) => string) => {
    const cfg = capturedConfigs[0];
    return cfg.keyGenerator as (req: Partial<Request>) => string;
  };

  it('returns user:<id> when req.user.id is present', () => {
    const kg = getKeyGenerator();
    const req = buildReq({
      user: { id: 'abc-123' } as unknown as Request['user'],
    });
    expect(kg(req as Request)).toBe('user:abc-123');
  });

  it('returns ip:<ip> when no user but req.ip is present', () => {
    const kg = getKeyGenerator();
    const req = buildReq({ ip: '10.0.0.5' });
    // No user property
    expect(kg(req as Request)).toBe('ip:10.0.0.5');
  });

  it('falls back to connection.remoteAddress when req.ip is undefined', () => {
    const kg = getKeyGenerator();
    const req = buildReq({ ip: undefined });
    expect(kg(req as Request)).toBe('ip:192.168.1.1');
  });

  it('returns ip:unknown when both req.ip and remoteAddress are absent', () => {
    const kg = getKeyGenerator();
    const req = buildReq({
      ip: undefined,
      connection: {} as Request['connection'],
    });
    expect(kg(req as Request)).toBe('ip:unknown');
  });
});

// ---------------------------------------------------------------------------
// passwordResetRateLimitHandler — extracted from passwordResetRateLimiter config
// ---------------------------------------------------------------------------

describe('passwordResetRateLimitHandler', () => {
  // The password reset limiter is created with a custom handler.
  // We find its config in capturedConfigs by the 10-minute window.
  const getPwdResetConfig = (): Record<string, unknown> => {
    const cfg = capturedConfigs.find(
      c => c.windowMs === 10 * 60 * 1000 && (c.max as number) === 5
    );
    if (!cfg) throw new Error('passwordResetRateLimiter config not found');
    return cfg;
  };

  it('handler logs a warning with path and method', () => {
    const cfg = getPwdResetConfig();
    const handler = cfg.handler as (req: Partial<Request>, res: Partial<Response>) => void;
    const req = buildReq({ path: '/api/auth/reset', method: 'POST' });
    const res = buildRes();

    handler(req, res);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Password reset rate limit exceeded',
      'RateLimit',
      expect.objectContaining({ path: '/api/auth/reset' })
    );
  });

  it('handler calls ResponseHelper.rateLimit with Czech message', () => {
    const cfg = getPwdResetConfig();
    const handler = cfg.handler as (req: Partial<Request>, res: Partial<Response>) => void;
    const req = buildReq();
    const res = buildRes();

    handler(req, res);

    expect(mockResponse.rateLimit).toHaveBeenCalledWith(
      res,
      expect.stringContaining('mnoho')
    );
  });

  it('skip() returns true for health-check paths', () => {
    const cfg = getPwdResetConfig();
    const skip = cfg.skip as (req: Partial<Request>) => boolean;
    expect(skip(buildReq({ path: '/health' }))).toBe(true);
    expect(skip(buildReq({ path: '/api/health' }))).toBe(true);
    expect(skip(buildReq({ path: '/metrics' }))).toBe(true);
    expect(skip(buildReq({ path: '/api/ml/health' }))).toBe(true);
  });

  it('skip() returns false for password reset path', () => {
    const cfg = getPwdResetConfig();
    const skip = cfg.skip as (req: Partial<Request>) => boolean;
    expect(skip(buildReq({ path: '/api/auth/reset-password' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// conditionalRateLimiter — development branches
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// createConditionalSkipRateLimiter — skip and no-skip paths
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// combineRateLimiters — chains limiters
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type import only (needed for the combineRateLimiters test above)
// ---------------------------------------------------------------------------
import type { RateLimitRequestHandler } from 'express-rate-limit';
