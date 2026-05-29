/**
 * emailRetryService.gaps6.test.ts
 *
 * Targets remaining uncovered lines reachable via the public API:
 *   362-371  — queueEmailForRetry: already-sent dedup skip
 *   380-391  — queueEmailForRetry: already-in-queue dedup
 *
 * Lines 427, 432, 436, 472-686 are inside processEmailQueue internals or the
 * "already running" guard that requires a module-private queueProcessing flag —
 * not reachable from the public API without a SMTP server (infra-bound).
 * Covered separately by emailRetryService.behavior.test.ts for the processable paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks BEFORE imports
// ---------------------------------------------------------------------------

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
    INITIAL_DELAY: 1,
    MAX_DELAY: 10,
    QUEUE_TTL: 3600000,
    SENT_EMAIL_TTL: 86400000,
    CLEANUP_INTERVAL: 3600000,
  },
  EMAIL_TIMEOUTS: { SEND: 30000, UTIA_SEND: 300000 },
  isUTIASmtpServer: vi.fn(() => false),
  getMaxRetryAttempts: vi.fn(() => 3),
  getQueueProcessingDelay: vi.fn(() => 0),
}));

vi.mock('../../utils/retryService', () => ({
  retryService: {
    executeWithRetry: vi.fn(async (fn: () => unknown) => fn()),
  },
  RetryService: {
    isCommonRetriableError: vi.fn(() => false),
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  queueEmailForRetry,
  getQueueStatus,
  getQueuedEmails,
  testHelpers,
} from '../emailRetryService';
import { logger } from '../../utils/logger';

const mockLogger = logger as unknown as {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

function makeOpts(to = 'u@example.com', subject = 'Test subject') {
  return { to, subject, html: '<p>body</p>' };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  testHelpers.clearSentEmails();
});

afterEach(() => {
  vi.useRealTimers();
  testHelpers.clearSentEmails();
});

// ---------------------------------------------------------------------------
// queueEmailForRetry — duplicate email in queue (lines 380-391)
// ---------------------------------------------------------------------------

describe('queueEmailForRetry — duplicate email in queue', () => {
  it('returns existing id and logs warning when same to+subject is already queued', () => {
    const opts = makeOpts('dup@x.com', 'Same subject');
    const id1 = queueEmailForRetry(opts);

    mockLogger.warn.mockClear();

    const id2 = queueEmailForRetry(opts);

    expect(id2).toBe(id1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Email already in queue, skipping duplicate',
      'EmailRetryService',
      expect.any(Object)
    );
  });
});

// ---------------------------------------------------------------------------
// queueEmailForRetry — already-sent dedup (lines 362-371)
// ---------------------------------------------------------------------------

describe('queueEmailForRetry — already-sent dedup', () => {
  it('returns "duplicate-skipped" when email was recently sent', () => {
    const opts = makeOpts('sent@x.com', 'Already sent');
    testHelpers.recordEmailSent(opts.to, opts.subject);

    const result = queueEmailForRetry(opts);

    expect(result).toBe('duplicate-skipped');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Email already sent recently, skipping queue',
      'EmailRetryService',
      expect.any(Object)
    );
  });

  it('does NOT add the email to the queue when already sent', () => {
    const opts = makeOpts('noqueue@x.com', 'Should not queue');
    testHelpers.recordEmailSent(opts.to, opts.subject);

    const statusBefore = getQueueStatus();
    queueEmailForRetry(opts);
    const statusAfter = getQueueStatus();

    expect(statusAfter.length).toBe(statusBefore.length);
  });
});

// ---------------------------------------------------------------------------
// getQueueStatus — shape and item reflection
// ---------------------------------------------------------------------------

describe('getQueueStatus()', () => {
  it('returns object with length, processing, emails fields', () => {
    const status = getQueueStatus();
    expect(typeof status.length).toBe('number');
    expect(typeof status.processing).toBe('boolean');
    expect(Array.isArray(status.emails)).toBe(true);
  });

  it('reflects queued items in the emails array', () => {
    const opts = makeOpts('check@x.com', 'Status check');
    queueEmailForRetry(opts);

    const status = getQueueStatus();
    const found = status.emails.find(e => e.to === 'check@x.com');
    expect(found).toBeDefined();
    expect(found!.subject).toBe('Status check');
  });

  it('emails entries have required fields', () => {
    const opts = makeOpts('fields@x.com', 'Fields test');
    queueEmailForRetry(opts);

    const status = getQueueStatus();
    const entry = status.emails.find(e => e.to === 'fields@x.com');
    expect(entry).toBeDefined();
    expect(typeof entry!.id).toBe('string');
    expect(typeof entry!.attempts).toBe('number');
    expect(typeof entry!.globalAttempts).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// getQueuedEmails — returns copy not reference
// ---------------------------------------------------------------------------

describe('getQueuedEmails()', () => {
  it('returns a separate array instance each call', () => {
    const a = getQueuedEmails();
    const b = getQueuedEmails();
    expect(a).not.toBe(b);
  });

  it('mutations to the returned array do not affect internal queue', () => {
    const opts = makeOpts('copy@x.com', 'Copy test');
    queueEmailForRetry(opts);

    const copy = getQueuedEmails();
    const lenBefore = copy.length;
    copy.splice(0, copy.length);

    expect(getQueuedEmails()).toHaveLength(lenBefore);
  });

  it('entries have options, attempts, globalAttempts fields', () => {
    const opts = makeOpts('entry@x.com', 'Entry fields');
    queueEmailForRetry(opts);

    const entries = getQueuedEmails();
    const entry = entries.find(e => e.options.to === 'entry@x.com');
    expect(entry).toBeDefined();
    expect(entry!.options.subject).toBe('Entry fields');
    expect(entry!.attempts).toBe(0);
    expect(entry!.globalAttempts).toBe(0);
  });
});
