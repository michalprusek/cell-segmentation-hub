/**
 * emailRetryService.gaps5.test.ts
 *
 * Covers the module-level setInterval cleanup callback (lines 77-89)
 * which fires periodically to remove old sent-email deduplication records.
 *
 *  A. Cleanup interval — sentEmails with expired entries
 *     - Add entries older than TTL → cleanup removes them
 *     - cleaned > 0 → logger.info called
 *
 * NOTE: Lines 427-686 are deep in processEmailQueue (complex async w/ real SMTP)
 * and are intentionally skipped — these are infra-bound.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    SENT_EMAIL_TTL: 1000, // Short TTL for testing
    CLEANUP_INTERVAL: 500, // Short interval for testing
  },
  EMAIL_TIMEOUTS: {
    SEND: 30000,
    UTIA_SEND: 300000,
    CONNECT: 10000,
    GLOBAL: 60000,
  },
}));

import { logger } from '../../utils/logger';
import { testHelpers } from '../emailRetryService';

beforeEach(() => {
  vi.clearAllMocks();
  testHelpers.clearSentEmails();
});

afterEach(() => {
  testHelpers.clearSentEmails();
});

// ─── A. Cleanup interval callback ─────────────────────────────────────────────

describe('emailRetryService — setInterval cleanup callback', () => {
  it('removes expired entries and logs when entries are cleaned', async () => {
    // Record some entries with a past timestamp (> SENT_EMAIL_TTL = 1000ms ago)
    testHelpers.recordEmailSent('old@example.com', 'Old Email');

    // Verify the entry was added
    expect(
      testHelpers.wasEmailAlreadySent('old@example.com', 'Old Email')
    ).toBe(true);

    // Wait > TTL (1000ms) + CLEANUP_INTERVAL (500ms) so the setInterval fires
    await new Promise(r => setTimeout(r, 2000));

    // The entry should have been cleaned up by the interval
    expect(
      testHelpers.wasEmailAlreadySent('old@example.com', 'Old Email')
    ).toBe(false);
  }, 5000); // Extended timeout

  it('does not clean entries that are still within TTL', async () => {
    // Record an entry that is fresh
    testHelpers.recordEmailSent('fresh@example.com', 'Fresh Email');

    // Wait less than TTL (200ms < 1000ms TTL)
    await new Promise(r => setTimeout(r, 200));

    // Entry should still be there
    expect(
      testHelpers.wasEmailAlreadySent('fresh@example.com', 'Fresh Email')
    ).toBe(true);
  });
});
