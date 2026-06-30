/**
 * logger.gaps5.test.ts
 *
 * Covers branches still uncovered in logger.ts:
 *
 *  A. Logger.setLevel
 *     - changes the current log level
 *
 *  B. Logger — debug level (console.debug)
 *     - debug method at DEBUG level → console.debug called
 *
 *  C. createRequestLogger
 *     - 5xx status → logger.error called
 *     - 4xx status → logger.warn called
 *     - 2xx status → logger.info called
 *     - next() called in all cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { LogLevel, logger, createRequestLogger } from '../logger';

// Helper to make a minimal Request/Response pair
function makePair(statusCode: number) {
  const finishHandlers: Array<() => void> = [];
  const res = {
    statusCode,
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'finish') finishHandlers.push(handler);
    }),
    get: vi.fn(() => 'TestAgent'),
  } as unknown as Response;
  const req = {
    method: 'GET',
    url: '/test',
    ip: '127.0.0.1',
    get: vi.fn(() => 'TestAgent'),
  } as unknown as Request;
  const fireFinish = () => finishHandlers.forEach(h => h());
  return { req, res, fireFinish };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── A. Logger.setLevel ───────────────────────────────────────────────────────

describe('Logger.setLevel', () => {
  it('changes the current log level', () => {
    const log = logger;
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    // At default level (INFO), debug should not print
    log.debug('test debug message');
    expect(consoleSpy).not.toHaveBeenCalled();

    // After setting to DEBUG, it should print
    log.setLevel(LogLevel.DEBUG);
    log.debug('test debug message');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    // Reset to default
    log.setLevel(LogLevel.INFO);
  });
});

// ─── B. Logger — debug level ──────────────────────────────────────────────────

describe('Logger — debug level console output', () => {
  it('calls console.debug when level is DEBUG', () => {
    const log = logger;
    log.setLevel(LogLevel.DEBUG);
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    log.debug('debug message', 'TestContext', { key: 'value' });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('debug message')
    );
    consoleSpy.mockRestore();
    log.setLevel(LogLevel.INFO);
  });
});

// ─── C. createRequestLogger ───────────────────────────────────────────────────

describe('createRequestLogger', () => {
  it('calls next()', () => {
    const middleware = createRequestLogger('TEST');
    const { req, res } = makePair(200);
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls logger.error for 5xx responses', () => {
    const middleware = createRequestLogger('TEST');
    const { req, res, fireFinish } = makePair(500);
    const next = vi.fn() as NextFunction;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    middleware(req, res, next);
    fireFinish();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('calls logger.warn for 4xx responses', () => {
    const middleware = createRequestLogger('TEST');
    const { req, res, fireFinish } = makePair(404);
    const next = vi.fn() as NextFunction;

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    middleware(req, res, next);
    fireFinish();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('calls logger.info for 2xx responses', () => {
    const middleware = createRequestLogger('TEST');
    const { req, res, fireFinish } = makePair(200);
    const next = vi.fn() as NextFunction;

    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    middleware(req, res, next);
    fireFinish();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ─── D. Log-injection sanitization (CWE-117 regression) ──────────────────────

describe('Logger log-injection sanitization', () => {
  it('strips CR/LF from the user message and context so a value cannot forge a new log line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('upload evil.png\nFAKE: admin granted', undefined, 'Ctx\ninj');

    const out = spy.mock.calls[0][0] as string;
    // The whole entry must be a single line (no injected newline survives).
    expect(out).not.toContain('\nFAKE');
    expect(out.split('\n')).toHaveLength(1);
    // The neutralized content is still present (replaced with a space).
    expect(out).toContain('upload evil.png FAKE: admin granted');
    expect(out).toContain('[Ctx inj]');
    spy.mockRestore();
  });

  it('preserves the intentional newline before the structured Data section', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logger.info('clean message', 'Ctx', { a: 1 });

    const out = spy.mock.calls[0][0] as string;
    expect(out).toContain('\nData:');
    spy.mockRestore();
  });
});
