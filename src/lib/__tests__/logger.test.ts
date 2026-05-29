/**
 * Behavioral tests for src/lib/logger.ts
 *
 * Logger reads import.meta.env at class-field initialization time, so
 * we cannot change DEV/PROD/MODE mid-test in the same module instance.
 * Strategy:
 *  - The vitest test environment runs with MODE='test', DEV=false, PROD=false
 *    (jsdom environment defaults). We verify test-env gating here.
 *  - For dev/prod branching we exercise the internal shouldLog logic via
 *    the public API, relying on the fact that in test mode only warn/error
 *    should fire console methods. This is the contract that matters at runtime.
 *  - group/groupEnd/time/timeEnd gate on isDevelopment (false in test), so
 *    we verify they do NOT call console in test mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../logger';

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let groupSpy: ReturnType<typeof vi.spyOn>;
  let groupEndSpy: ReturnType<typeof vi.spyOn>;
  let timeSpy: ReturnType<typeof vi.spyOn>;
  let timeEndSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    groupSpy = vi.spyOn(console, 'group').mockImplementation(() => undefined);
    groupEndSpy = vi
      .spyOn(console, 'groupEnd')
      .mockImplementation(() => undefined);
    timeSpy = vi.spyOn(console, 'time').mockImplementation(() => undefined);
    timeEndSpy = vi
      .spyOn(console, 'timeEnd')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // Log-level gating (test environment: only warn + error are enabled)
  // ------------------------------------------------------------------
  describe('log-level gating in test environment', () => {
    it('does NOT call console.log for debug()', () => {
      logger.debug('debug msg');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('does NOT call console.info for info()', () => {
      logger.info('info msg');
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('DOES call console.warn for warn()', () => {
      logger.warn('warn msg');
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('DOES call console.error for error()', () => {
      logger.error('error msg');
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });

  // ------------------------------------------------------------------
  // Console method routing — each level uses its own console method
  // ------------------------------------------------------------------
  describe('console method routing', () => {
    it('warn() routes to console.warn (not log/info/error)', () => {
      logger.warn('routing test');
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(logSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('error() routes to console.error (not log/info/warn)', () => {
      logger.error('routing test');
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(logSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Message formatting — prefix contains timestamp + level
  // ------------------------------------------------------------------
  describe('message formatting', () => {
    it('warn message includes [WARN] prefix', () => {
      logger.warn('check prefix');
      // First arg to console.warn is the '%s' / '%s %o' format string
      // Second arg is the formatted message — check it includes [WARN]
      const formattedMsg = warnSpy.mock.calls[0][1] as string;
      expect(formattedMsg).toMatch(/\[WARN\]/);
    });

    it('warn message includes the original message text', () => {
      logger.warn('my important warning');
      const formattedMsg = warnSpy.mock.calls[0][1] as string;
      expect(formattedMsg).toContain('my important warning');
    });

    it('error message includes [ERROR] prefix', () => {
      logger.error('check prefix');
      const formattedMsg = errorSpy.mock.calls[0][1] as string;
      expect(formattedMsg).toMatch(/\[ERROR\]/);
    });

    it('formatted message includes an ISO-like timestamp', () => {
      logger.warn('timestamp check');
      const formattedMsg = warnSpy.mock.calls[0][1] as string;
      // ISO timestamp contains "T" and "Z"
      expect(formattedMsg).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ------------------------------------------------------------------
  // Data / extra-argument handling
  // ------------------------------------------------------------------
  describe('data argument handling', () => {
    it('warn() with data uses "%s %o" format and passes data as 3rd arg', () => {
      const payload = { key: 'val' };
      logger.warn('with data', payload);
      expect(warnSpy).toHaveBeenCalledOnce();
      const [fmt, , dataArg] = warnSpy.mock.calls[0];
      expect(fmt).toBe('%s %o');
      expect(dataArg).toBe(payload);
    });

    it('warn() without data uses "%s" format and has only 2 args', () => {
      logger.warn('no data');
      expect(warnSpy).toHaveBeenCalledOnce();
      const args = warnSpy.mock.calls[0];
      expect(args[0]).toBe('%s');
      expect(args).toHaveLength(2);
    });

    it('error() with an Error object passes the error as 3rd arg', () => {
      const err = new Error('boom');
      logger.error('caught', err);
      const [fmt, , errArg] = errorSpy.mock.calls[0];
      expect(fmt).toBe('%s %o');
      expect(errArg).toBe(err);
    });

    it('error() with null data treats it as "defined" and uses %s %o', () => {
      // null is !== undefined so it is treated as provided data
      logger.error('null check', null);
      const [fmt, , dataArg] = errorSpy.mock.calls[0];
      expect(fmt).toBe('%s %o');
      expect(dataArg).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // group / groupEnd / time / timeEnd — gated on isDevelopment
  //
  // Vitest sets import.meta.env.DEV=true even in MODE='test', so the
  // Logger class initialises isDevelopment=true in this environment.
  // Therefore group/groupEnd/time/timeEnd DO fire in tests.  We verify
  // the correct console method is called (behavioral contract) and that
  // the label is forwarded unchanged.
  // ------------------------------------------------------------------
  describe('dev-only methods (isDevelopment=true in Vitest env)', () => {
    it('group() calls console.group with the label', () => {
      logger.group('my group');
      expect(groupSpy).toHaveBeenCalledOnce();
      expect(groupSpy).toHaveBeenCalledWith('my group');
    });

    it('groupEnd() calls console.groupEnd with no arguments', () => {
      logger.groupEnd();
      expect(groupEndSpy).toHaveBeenCalledOnce();
    });

    it('time() calls console.time with the label', () => {
      logger.time('my-timer');
      expect(timeSpy).toHaveBeenCalledOnce();
      expect(timeSpy).toHaveBeenCalledWith('my-timer');
    });

    it('timeEnd() calls console.timeEnd with the label', () => {
      logger.timeEnd('my-timer');
      expect(timeEndSpy).toHaveBeenCalledOnce();
      expect(timeEndSpy).toHaveBeenCalledWith('my-timer');
    });

    it('group() does NOT call error/warn/info/log', () => {
      logger.group('g');
      expect(logSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Idempotency — calling multiple times accumulates calls correctly
  // ------------------------------------------------------------------
  describe('multiple calls', () => {
    it('each warn() call appends one console.warn call', () => {
      logger.warn('first');
      logger.warn('second');
      logger.warn('third');
      expect(warnSpy).toHaveBeenCalledTimes(3);
    });

    it('each error() call is independent', () => {
      logger.error('a');
      logger.error('b');
      expect(errorSpy).toHaveBeenCalledTimes(2);
      const msg1 = errorSpy.mock.calls[0][1] as string;
      const msg2 = errorSpy.mock.calls[1][1] as string;
      expect(msg1).toContain('a');
      expect(msg2).toContain('b');
    });
  });
});
