/**
 * emailRetryService.cleanup.test.ts
 *
 * Exercises the module-level setInterval that expires stale sent-email
 * deduplication records. Kept separate from the main suite because it needs a
 * distinct short-interval mock config and real timers (the cleanup callback is
 * registered at module load and can only be observed over wall-clock time).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/envValidator', () => ({
  getNumericEnvVar: vi.fn((_key: string, defaultVal: number) => defaultVal),
}));

vi.mock('../../constants/email', () => ({
  EMAIL_RETRY: {
    MAX_ATTEMPTS: 3,
    UTIA_MAX_ATTEMPTS: 5,
    MAX_GLOBAL_ATTEMPTS: 10,
    INITIAL_DELAY: 1000,
    MAX_DELAY: 10000,
    QUEUE_TTL: 3600000,
    SENT_EMAIL_TTL: 1000, // short TTL so records expire quickly
    CLEANUP_INTERVAL: 500, // short interval so the cleanup timer fires during the test
  },
  EMAIL_TIMEOUTS: {
    SEND: 30000,
    UTIA_SEND: 300000,
  },
}));

import { testHelpers } from '../emailRetryService';

beforeEach(() => {
  vi.clearAllMocks();
  testHelpers.clearSentEmails();
});

afterEach(() => {
  testHelpers.clearSentEmails();
});

describe('emailRetryService — sent-record cleanup interval', () => {
  it('drops records that outlive SENT_EMAIL_TTL', async () => {
    testHelpers.recordEmailSent('old@example.com', 'Old Email');
    expect(
      testHelpers.wasEmailAlreadySent('old@example.com', 'Old Email')
    ).toBe(true);

    // Wait past TTL (1000ms) + a cleanup tick (500ms).
    await new Promise(r => setTimeout(r, 2000));

    expect(
      testHelpers.wasEmailAlreadySent('old@example.com', 'Old Email')
    ).toBe(false);
  }, 5000);

  it('retains records that are still within TTL', async () => {
    testHelpers.recordEmailSent('fresh@example.com', 'Fresh Email');

    // Wait less than the TTL.
    await new Promise(r => setTimeout(r, 200));

    expect(
      testHelpers.wasEmailAlreadySent('fresh@example.com', 'Fresh Email')
    ).toBe(true);
  });
});
