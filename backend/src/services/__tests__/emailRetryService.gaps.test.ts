/**
 * Gap-coverage tests for emailRetryService.ts
 *
 * Targets uncovered exports/paths NOT tested by emailRetryService.test.ts:
 *   - isRetriableEmailError — all classification branches
 *   - parseEmailTimeout — env-driven numeric resolution
 *   - updateEmailMetrics — counter mechanics and running avgRetries
 *   - getEmailMetrics — returns a detached copy
 *   - sendMailWithTimeout — resolves fast, rejects on timeout
 *   - getQueueStatus — shape and relationship to queue contents
 *
 * Uses the same vi.mock ordering as the existing sibling test so that module
 * isolation is consistent and the mocks resolve correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks — must precede any import from the module under test ────────────────

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
    SENT_EMAIL_TTL: 86400000,
    CLEANUP_INTERVAL: 3600000,
  },
  EMAIL_TIMEOUTS: {
    SEND: 30000,
    UTIA_SEND: 300000,
  },
  isUTIASmtpServer: vi.fn(() => false),
  getMaxRetryAttempts: vi.fn(() => 3),
  getQueueProcessingDelay: vi.fn(() => 10),
}));

vi.mock('../../utils/retryService', () => ({
  retryService: {
    executeWithRetry: vi.fn(async (fn: () => unknown) => fn()),
  },
  RetryService: {
    // Default: not a common retriable error (so email-specific logic runs)
    isCommonRetriableError: vi.fn(() => false),
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  isRetriableEmailError,
  parseEmailTimeout,
  updateEmailMetrics,
  getEmailMetrics,
  sendMailWithTimeout,
  queueEmailForRetry,
  getQueueStatus,
  testHelpers,
} from '../emailRetryService';
import { RetryService } from '../../utils/retryService';

const mockIsCommon = RetryService.isCommonRetriableError as ReturnType<
  typeof vi.fn
>;

// ── isRetriableEmailError ─────────────────────────────────────────────────────

describe('isRetriableEmailError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: RetryService.isCommonRetriableError returns false so we exercise
    // the email-specific branches inside isRetriableEmailError.
    mockIsCommon.mockReturnValue(false);
  });

  it('returns true immediately when isCommonRetriableError returns true', () => {
    mockIsCommon.mockReturnValue(true);
    expect(isRetriableEmailError(new Error('connection reset'))).toBe(true);
    // Should short-circuit — the common check runs first
    expect(mockIsCommon).toHaveBeenCalledTimes(1);
  });

  it('returns false for auth error (message contains "auth")', () => {
    expect(
      isRetriableEmailError(new Error('Authentication failed for user'))
    ).toBe(false);
  });

  it('returns false for 550 permanent error', () => {
    expect(isRetriableEmailError(new Error('550 User not found'))).toBe(false);
  });

  it('returns false for 551 error', () => {
    expect(
      isRetriableEmailError(
        new Error('551 User not local; please try forwarding')
      )
    ).toBe(false);
  });

  it('returns false for 553 error', () => {
    expect(
      isRetriableEmailError(new Error('553 mailbox name not allowed'))
    ).toBe(false);
  });

  it('returns false for 554 transaction-failed error', () => {
    expect(
      isRetriableEmailError(new Error('554 transaction failed permanently'))
    ).toBe(false);
  });

  it('returns true for unknown errors (default fallback)', () => {
    // No auth/5xx permanent match → defaults to retriable
    expect(
      isRetriableEmailError(new Error('something entirely unfamiliar'))
    ).toBe(true);
  });

  it('returns true for an error whose message is empty (edge case)', () => {
    expect(isRetriableEmailError(new Error(''))).toBe(true);
  });
});

// ── parseEmailTimeout ─────────────────────────────────────────────────────────

describe('parseEmailTimeout', () => {
  it('returns the supplied default when env var is absent', () => {
    // getNumericEnvVar mock returns defaultVal directly
    expect(parseEmailTimeout('EMAIL_DOES_NOT_EXIST', 12000)).toBe(12000);
  });

  it('returns a different default value when specified', () => {
    expect(parseEmailTimeout('EMAIL_DOES_NOT_EXIST', 30000)).toBe(30000);
  });
});

// ── updateEmailMetrics / getEmailMetrics ──────────────────────────────────────

describe('updateEmailMetrics and getEmailMetrics', () => {
  // Metrics are module-level singletons — capture baseline before each test.
  let baseline: ReturnType<typeof getEmailMetrics>;

  beforeEach(() => {
    baseline = getEmailMetrics();
  });

  it('increments sent counter by 1 on success without retries', () => {
    updateEmailMetrics(true, 0);
    expect(getEmailMetrics().sent).toBe(baseline.sent + 1);
  });

  it('sets lastSuccess to a recent Date on success', () => {
    const before = Date.now();
    updateEmailMetrics(true, 0);
    const { lastSuccess } = getEmailMetrics();
    expect(lastSuccess).toBeInstanceOf(Date);
    expect(lastSuccess!.getTime()).toBeGreaterThanOrEqual(before - 50);
  });

  it('does NOT increment retried when retries=0', () => {
    updateEmailMetrics(true, 0);
    expect(getEmailMetrics().retried).toBe(baseline.retried);
  });

  it('increments retried counter when retries > 0', () => {
    updateEmailMetrics(true, 2);
    expect(getEmailMetrics().retried).toBe(baseline.retried + 1);
  });

  it('running avgRetries is positive after at least one retried send', () => {
    updateEmailMetrics(true, 4);
    expect(getEmailMetrics().avgRetries).toBeGreaterThan(0);
  });

  it('increments failed counter by 1 on failure', () => {
    updateEmailMetrics(false, 0);
    expect(getEmailMetrics().failed).toBe(baseline.failed + 1);
  });

  it('stores lastError message when an error is provided', () => {
    updateEmailMetrics(false, 0, new Error('SMTP unreachable'));
    expect(getEmailMetrics().lastError).toBe('SMTP unreachable');
  });

  it('getEmailMetrics returns a detached snapshot — future updates do not mutate it', () => {
    const snap = getEmailMetrics();
    const sentBefore = snap.sent;
    updateEmailMetrics(true, 0);
    // The snapshot captured before the update must be unchanged
    expect(snap.sent).toBe(sentBefore);
  });
});

// ── sendMailWithTimeout ───────────────────────────────────────────────────────

describe('sendMailWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mailOptions = {
    to: 'dest@test.com',
    subject: 'Timeout test',
    html: '<p>x</p>',
  };

  it('resolves with sendMail result when SMTP responds before timeout', async () => {
    const expected = { messageId: 'fast-send' };
    const transporter = { sendMail: vi.fn().mockResolvedValue(expected) };

    const promise = sendMailWithTimeout(transporter, mailOptions);
    // Advance by a trivial amount — SMTP already resolved via microtask queue
    vi.advanceTimersByTime(0);
    const result = await promise;
    expect(result).toEqual(expected);
  });

  it('rejects with a timeout error when sendMail hangs past EMAIL_TIMEOUTS.SEND (30s)', async () => {
    // sendMail returns a promise that never resolves
    const transporter = {
      sendMail: vi.fn().mockReturnValue(new Promise(() => {})),
    };

    const promise = sendMailWithTimeout(transporter, mailOptions);
    // The mock returns 30 000 ms for the SEND timeout
    vi.advanceTimersByTime(31000);
    await expect(promise).rejects.toThrow(/timeout/i);
  });

  it('includes the word "timeout" (not an SMTP error) in the rejection message', async () => {
    const transporter = {
      sendMail: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    const promise = sendMailWithTimeout(transporter, mailOptions);
    vi.advanceTimersByTime(31000);
    await expect(promise).rejects.toThrow('timeout');
  });
});

// ── getQueueStatus ────────────────────────────────────────────────────────────

describe('getQueueStatus', () => {
  beforeEach(() => {
    testHelpers.clearSentEmails();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    testHelpers.clearSentEmails();
  });

  it('returns an object with length, processing, and emails array', () => {
    const status = getQueueStatus();
    expect(typeof status.length).toBe('number');
    expect(typeof status.processing).toBe('boolean');
    expect(Array.isArray(status.emails)).toBe(true);
  });

  it('reflects a freshly queued email in status.emails', () => {
    const opts = {
      to: 'qs-check@test.com',
      subject: 'QueueStatus probe',
      html: '<p>y</p>',
    };
    const id = queueEmailForRetry(opts);
    const status = getQueueStatus();
    const entry = status.emails.find(e => e.id === id);
    expect(entry).toBeDefined();
    expect(entry!.to).toBe(opts.to);
    expect(entry!.subject).toBe(opts.subject);
    expect(entry!.attempts).toBe(0);
    expect(entry!.globalAttempts).toBe(0);
  });

  it('status.emails items do not include nextRetryAt when not yet retried', () => {
    const opts = {
      to: 'no-retry@test.com',
      subject: 'No retry yet',
    };
    const id = queueEmailForRetry(opts);
    const status = getQueueStatus();
    const entry = status.emails.find(e => e.id === id);
    expect(entry).toBeDefined();
    // nextRetryAt is only set after a failure — should be undefined at enqueue
    expect(entry!.nextRetryAt).toBeUndefined();
  });
});
