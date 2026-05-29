/**
 * emailRetryService.dedup.test.ts
 *
 * Covers deduplication / queue-protection branches NOT exercised by the
 * existing sibling tests:
 *
 *  - testHelpers.getEmailKey — normalises to-lowercase + subject-lowercase
 *  - testHelpers.wasEmailAlreadySent — false when map empty, false when TTL
 *    expired, true when freshly recorded
 *  - testHelpers.recordEmailSent — populates the map so wasEmailAlreadySent
 *    returns true immediately after
 *  - testHelpers.clearSentEmails — clears the map so subsequent checks return false
 *  - queueEmailForRetry — returns 'duplicate-skipped' when email was already sent
 *  - queueEmailForRetry — returns existing id when same email+subject is
 *    already in the queue
 *  - queueEmailForRetry — enqueues with attempts=0 and globalAttempts=0 on
 *    first call for a unique email
 *  - getQueueStatus — length matches actual queue contents after multiple enqueues
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/envValidator', () => ({
  getNumericEnvVar: vi.fn((_k: string, d: number) => d),
}));

vi.mock('../../constants/email', () => ({
  EMAIL_RETRY: {
    MAX_ATTEMPTS: 3,
    UTIA_MAX_ATTEMPTS: 5,
    MAX_GLOBAL_ATTEMPTS: 10,
    INITIAL_DELAY: 1000,
    MAX_DELAY: 10000,
    // 100 ms TTL — short enough to test expiry without real timers
    SENT_EMAIL_TTL: 100,
    QUEUE_TTL: 3600000,
    CLEANUP_INTERVAL: 3600000,
  },
  EMAIL_TIMEOUTS: { SEND: 30000, UTIA_SEND: 300000 },
  isUTIASmtpServer: vi.fn(() => false),
  getMaxRetryAttempts: vi.fn(() => 3),
  getQueueProcessingDelay: vi.fn(() => 1),
}));

vi.mock('../../utils/retryService', () => ({
  retryService: {
    executeWithRetry: vi.fn(async (fn: () => unknown) => fn()),
  },
  RetryService: {
    isCommonRetriableError: vi.fn(() => false),
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  queueEmailForRetry,
  getQueueStatus,
  testHelpers,
} from '../emailRetryService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uniqueEmail(suffix: string) {
  return `dedup-${suffix}-${Date.now()}@test.com`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('emailRetryService — deduplication helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testHelpers.clearSentEmails();
  });

  afterEach(() => {
    vi.useRealTimers();
    testHelpers.clearSentEmails();
  });

  // =========================================================================
  // getEmailKey
  // =========================================================================
  describe('getEmailKey', () => {
    it('returns a string combining to + subject in lowercase', () => {
      const key = testHelpers.getEmailKey('User@Example.COM', 'Hello World');
      expect(key).toBe('user@example.com:hello world');
    });

    it('normalises both parts to lowercase', () => {
      const key = testHelpers.getEmailKey('A@B.COM', 'SUBJECT');
      expect(key).toBe('a@b.com:subject');
    });

    it('returns the same key regardless of original casing', () => {
      const k1 = testHelpers.getEmailKey('u@test.com', 'verify email');
      const k2 = testHelpers.getEmailKey('U@TEST.COM', 'VERIFY EMAIL');
      expect(k1).toBe(k2);
    });
  });

  // =========================================================================
  // wasEmailAlreadySent / recordEmailSent / clearSentEmails
  // =========================================================================
  describe('wasEmailAlreadySent', () => {
    it('returns false for an email that was never sent', () => {
      expect(testHelpers.wasEmailAlreadySent('fresh@test.com', 'Welcome')).toBe(
        false
      );
    });

    it('returns true immediately after recordEmailSent', () => {
      const to = uniqueEmail('rec');
      const subject = 'Recorded Subject';
      testHelpers.recordEmailSent(to, subject);
      expect(testHelpers.wasEmailAlreadySent(to, subject)).toBe(true);
    });

    it('returns false after TTL expires (advance timers past 100ms TTL)', () => {
      const to = uniqueEmail('ttl');
      const subject = 'TTL Subject';
      testHelpers.recordEmailSent(to, subject);

      // Advance past the 100ms TTL configured in our mock
      vi.advanceTimersByTime(200);

      // wasEmailAlreadySent checks age and deletes expired entries
      expect(testHelpers.wasEmailAlreadySent(to, subject)).toBe(false);
    });

    it('is case-insensitive (same key as getEmailKey)', () => {
      const to = 'Upper@Example.COM';
      testHelpers.recordEmailSent(to, 'MY SUBJECT');
      // Lookup with different casing — same key
      expect(
        testHelpers.wasEmailAlreadySent('upper@example.com', 'my subject')
      ).toBe(true);
    });
  });

  describe('clearSentEmails', () => {
    it('removes all previously recorded emails', () => {
      const to = uniqueEmail('clear');
      testHelpers.recordEmailSent(to, 'Subj');
      expect(testHelpers.wasEmailAlreadySent(to, 'Subj')).toBe(true);

      testHelpers.clearSentEmails();

      expect(testHelpers.wasEmailAlreadySent(to, 'Subj')).toBe(false);
    });
  });

  // =========================================================================
  // queueEmailForRetry — deduplication paths
  // =========================================================================
  describe('queueEmailForRetry', () => {
    it('returns a string id on first enqueue', () => {
      const opts = { to: uniqueEmail('first'), subject: 'First' };
      const id = queueEmailForRetry(opts);
      expect(typeof id).toBe('string');
      expect(id).not.toBe('duplicate-skipped');
    });

    it('enqueues with attempts=0 and globalAttempts=0', () => {
      const opts = { to: uniqueEmail('fresh'), subject: 'Fresh Sub' };
      const id = queueEmailForRetry(opts);

      const status = getQueueStatus();
      const entry = status.emails.find(e => e.id === id);
      expect(entry).toBeDefined();
      expect(entry!.attempts).toBe(0);
      expect(entry!.globalAttempts).toBe(0);
    });

    it("returns 'duplicate-skipped' when email was already recorded as sent", () => {
      const to = uniqueEmail('dup-sent');
      const subject = 'Dup-Sent Subject';

      testHelpers.recordEmailSent(to, subject);

      const id = queueEmailForRetry({ to, subject });
      expect(id).toBe('duplicate-skipped');
    });

    it('returns existing id when same to+subject is already in the queue', () => {
      const opts = {
        to: uniqueEmail('dup-queue'),
        subject: 'Dup-Queue Subject',
      };
      const id1 = queueEmailForRetry(opts);
      const id2 = queueEmailForRetry(opts);

      expect(id1).toBe(id2);
      expect(id1).not.toBe('duplicate-skipped');
    });

    it('allows distinct emails with the same subject', () => {
      const subject = 'Shared Subject';
      const id1 = queueEmailForRetry({ to: uniqueEmail('a'), subject });
      const id2 = queueEmailForRetry({ to: uniqueEmail('b'), subject });

      expect(id1).not.toBe(id2);
    });

    it('allows distinct subjects to the same address', () => {
      const to = uniqueEmail('same-to');
      const id1 = queueEmailForRetry({ to, subject: 'Sub Alpha' });
      const id2 = queueEmailForRetry({ to, subject: 'Sub Beta' });

      expect(id1).not.toBe(id2);
    });
  });

  // =========================================================================
  // getQueueStatus — length tracking
  // =========================================================================
  describe('getQueueStatus length', () => {
    it('length increases by 1 after each unique enqueue', () => {
      const before = getQueueStatus().length;
      queueEmailForRetry({ to: uniqueEmail('len1'), subject: 'Len1' });
      queueEmailForRetry({ to: uniqueEmail('len2'), subject: 'Len2' });
      const after = getQueueStatus().length;
      expect(after).toBe(before + 2);
    });

    it('length does NOT change when duplicate-skipped email is re-queued', () => {
      const to = uniqueEmail('no-len-inc');
      const subject = 'No Len Inc Sub';
      testHelpers.recordEmailSent(to, subject);

      const before = getQueueStatus().length;
      queueEmailForRetry({ to, subject });
      const after = getQueueStatus().length;
      expect(after).toBe(before);
    });

    it('length does NOT change when in-queue duplicate is re-queued', () => {
      const opts = { to: uniqueEmail('in-q-dup'), subject: 'InQ Dup' };
      queueEmailForRetry(opts);
      const before = getQueueStatus().length;
      queueEmailForRetry(opts);
      const after = getQueueStatus().length;
      expect(after).toBe(before);
    });
  });
});
