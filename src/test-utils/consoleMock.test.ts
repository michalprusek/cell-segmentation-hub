import { vi, beforeEach, afterEach } from 'vitest';

/**
 * Console Mock Utility
 *
 * Provides a reusable mock for console methods to prevent test output pollution
 * and enable testing of logging behavior.
 *
 * Usage:
 * ```typescript
 * import { mockConsole } from '@/test-utils/consoleMock';
 *
 * describe('MyComponent', () => {
 *   mockConsole();
 *
 *   it('should log message', () => {
 *     // test code
 *     // eslint-disable-next-line no-console
 *     expect(console.log).toHaveBeenCalledWith('expected message');
 *   });
 * });
 * ```
 */

interface ConsoleMock {
  log: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}

let originalConsole: Console;

/**
 * Mocks all console methods with Vitest spies
 * Automatically restores original console after each test
 */
export const mockConsole = (): void => {
  beforeEach(() => {
    originalConsole = { ...console };

    global.console = {
      ...console,
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    global.console = originalConsole;
  });
};

/**
 * Creates a console mock object that can be used programmatically
 * without automatic setup/teardown
 */
export const createConsoleMock = (): ConsoleMock => {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
};

/**
 * Suppress console output for specific tests without mocking
 * Useful when you don't need to assert on console calls
 */
export const suppressConsole = (): void => {
  beforeEach(() => {
    originalConsole = { ...console };

    global.console = {
      ...console,
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
  });

  afterEach(() => {
    global.console = originalConsole;
  });
};

/**
 * Get the mock console instance for assertions
 * Only works when mockConsole() has been called
 */
export const getConsoleMock = (): ConsoleMock => {
  return {
    // eslint-disable-next-line no-console
    log: console.log as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line no-console
    error: console.error as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line no-console
    warn: console.warn as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line no-console
    info: console.info as ReturnType<typeof vi.fn>,
    // eslint-disable-next-line no-console
    debug: console.debug as ReturnType<typeof vi.fn>,
  };
};
