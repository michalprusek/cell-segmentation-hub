/**
 * accessLogger.gaps6.test.ts
 *
 * Covers uncovered branches in accessLogger.ts:
 *   39, 44     — RequestDeduplicator constructor (setInterval + process.on)
 *   80-93      — cleanup() method: expired entry removal + development debug log
 *   119        — ensureLogDirectory error path (mkdirSync throws)
 *   209        — writeToAccessLog fs.appendFileSync error path
 *   295        — development debug log on response finish
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mocks — must come before any source import
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// We need real fs behaviour for most tests but spy on individual calls
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(() => undefined),
    appendFileSync: vi.fn(() => undefined),
  };
});

import * as fs from 'fs';
import { accessLogger, testExports } from '../accessLogger';
import type { AuthRequest } from '../../types/auth';
import { logger } from '../../utils/logger';

const mockLogger = logger as unknown as {
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    originalUrl: '/api/items',
    url: '/api/items',
    method: 'GET',
    ip: '10.0.0.1',
    headers: {},
    get: vi.fn((h: string) => (h === 'User-Agent' ? 'test-ua' : undefined)),
    ...overrides,
  } as unknown as AuthRequest;
}

function buildRes(): {
  res: Partial<Response>;
  triggerFinish: () => void;
} {
  let finishCb: (() => void) | null = null;
  const res: Partial<Response> = {
    statusCode: 200,
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'finish') finishCb = cb;
      return res as Response;
    }),
  };
  return {
    res,
    triggerFinish: () => {
      if (finishCb) finishCb();
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.appendFileSync).mockReturnValue(undefined);
  // Clear the deduplicator cache so each test starts fresh
  (testExports.deduplicator as unknown as { cache: Map<string, number> }).cache.clear();
});

// ---------------------------------------------------------------------------
// ensureLogDirectory error path (line 119)
// ---------------------------------------------------------------------------

describe('ensureLogDirectory error path', () => {
  it('logs error when mkdirSync throws (log dir missing)', () => {
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });

    const req = buildReq();
    const { res, triggerFinish } = buildRes();
    const next = vi.fn() as NextFunction;

    // Set NODE_ENV=test so ensureLogDirectory is called per-request
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    accessLogger(req, res as Response, next);
    triggerFinish();

    process.env.NODE_ENV = origEnv;

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to create log directory:',
      expect.any(Error)
    );
  });
});

// ---------------------------------------------------------------------------
// writeToAccessLog fs error path (line 209)
// ---------------------------------------------------------------------------

describe('writeToAccessLog fs.appendFileSync error path', () => {
  it('logs error via logger when appendFileSync throws', () => {
    vi.mocked(fs.appendFileSync).mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    const req = buildReq();
    const { res, triggerFinish } = buildRes();
    const next = vi.fn() as NextFunction;

    accessLogger(req, res as Response, next);
    triggerFinish();

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to write to access log:',
      expect.any(Error),
      'accessLogger'
    );
  });
});

// ---------------------------------------------------------------------------
// Development debug log on finish (line 295)
// ---------------------------------------------------------------------------

describe('development mode debug log', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('emits debug log on response finish in development mode', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const req = buildReq();
    const { res, triggerFinish } = buildRes();
    const next = vi.fn() as NextFunction;

    accessLogger(req, res as Response, next);
    triggerFinish();

    process.env.NODE_ENV = origEnv;

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('[ACCESS]')
    );
  });
});

// ---------------------------------------------------------------------------
// RequestDeduplicator.cleanup() (lines 80-93)
// ---------------------------------------------------------------------------

describe('RequestDeduplicator.cleanup()', () => {
  it('removes entries older than the deduplication window', () => {
    const { deduplicator, DEDUPLICATION_WINDOW_MS } = testExports;
    const cache = (deduplicator as unknown as { cache: Map<string, number> })
      .cache;

    // Insert a stale entry
    const staleKey = 'stale|anon|GET|/api/old|200|ua';
    cache.set(staleKey, Date.now() - DEDUPLICATION_WINDOW_MS - 1000);

    // Insert a fresh entry
    const freshKey = 'fresh|anon|GET|/api/new|200|ua';
    cache.set(freshKey, Date.now());

    // Trigger cleanup by calling private method directly
    (deduplicator as unknown as { cleanup(): void }).cleanup();

    expect(cache.has(staleKey)).toBe(false);
    expect(cache.has(freshKey)).toBe(true);
  });

  it('emits debug log in development when entries are cleaned', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const { deduplicator, DEDUPLICATION_WINDOW_MS } = testExports;
    const cache = (deduplicator as unknown as { cache: Map<string, number> })
      .cache;

    // Insert a stale entry so cleanup has something to remove
    cache.set('k1|anon|GET|/old|200|ua', Date.now() - DEDUPLICATION_WINDOW_MS - 1);

    (deduplicator as unknown as { cleanup(): void }).cleanup();

    process.env.NODE_ENV = origEnv;

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Cleaned'),
      'RequestDeduplicator',
      expect.any(Object)
    );
  });

  it('does not emit debug log when no expired entries exist', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const { deduplicator } = testExports;
    const cache = (deduplicator as unknown as { cache: Map<string, number> })
      .cache;
    cache.clear();

    (deduplicator as unknown as { cleanup(): void }).cleanup();

    process.env.NODE_ENV = origEnv;

    // No entries were deleted → no debug log
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RequestDeduplicator LRU eviction when cache exceeds MAX_DEDUP_CACHE_SIZE
// ---------------------------------------------------------------------------

describe('RequestDeduplicator — LRU eviction', () => {
  it('evicts oldest entries when cache exceeds MAX_DEDUP_CACHE_SIZE', () => {
    const { deduplicator, MAX_DEDUP_CACHE_SIZE } = testExports;
    const cache = (deduplicator as unknown as { cache: Map<string, number> })
      .cache;
    cache.clear();

    // Fill cache beyond limit
    for (let i = 0; i <= MAX_DEDUP_CACHE_SIZE; i++) {
      deduplicator.shouldLog(`key-${i}`);
    }

    // After eviction, cache must be at or below the limit
    expect(cache.size).toBeLessThanOrEqual(MAX_DEDUP_CACHE_SIZE);
  });
});
