/**
 * emailRetryService.test.ts
 *
 * Consolidated unit suite for the background email retry service. Organised by
 * concern:
 *   - deduplication keys + sent-email TTL tracking
 *   - retriable-error classification (SMTP permanent vs transient)
 *   - metrics counters + periodic checkpoint
 *   - per-send timeout wrapper (sendMailWithTimeout)
 *   - send + retry scheduling (sendEmailWithRetry) incl. mailOptions/replyTo,
 *     initialization guard and global-timeout abort
 *   - queue persistence + duplicate protection (queueEmailForRetry / status)
 *
 * The module-level cleanup-interval behaviour lives in
 * emailRetryService.cleanup.test.ts because it needs a distinct short-interval
 * mock config and real timers.
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
    SENT_EMAIL_TTL: 86400000, // 24 h
    CLEANUP_INTERVAL: 3600000,
  },
  EMAIL_TIMEOUTS: {
    SEND: 30000,
    UTIA_SEND: 300000,
  },
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
  sendEmailWithRetry,
  sendMailWithTimeout,
  queueEmailForRetry,
  getQueueStatus,
  getQueuedEmails,
  forceProcessQueue,
  isRetriableEmailError,
  parseEmailTimeout,
  updateEmailMetrics,
  getEmailMetrics,
  DEFAULT_EMAIL_RETRY_CONFIG,
  testHelpers,
} from '../emailRetryService';
import { EMAIL_RETRY } from '../../constants/email';
import { retryService, RetryService } from '../../utils/retryService';
import { logger } from '../../utils/logger';

const mockExecuteWithRetry = retryService.executeWithRetry as ReturnType<
  typeof vi.fn
>;
const mockIsCommon = RetryService.isCommonRetriableError as ReturnType<
  typeof vi.fn
>;

// Globally-unique recipient so accumulated (never-cleared) queue state from a
// prior test can never collide with a fresh enqueue.
let seq = 0;
function uniqueEmail(suffix: string): string {
  return `ers-${suffix}-${Date.now()}-${seq++}@test.com`;
}

// ── getEmailKey ───────────────────────────────────────────────────────────────

describe('getEmailKey', () => {
  it('combines to + subject, lowercased', () => {
    expect(testHelpers.getEmailKey('User@Example.COM', 'Hello World')).toBe(
      'user@example.com:hello world'
    );
  });

  it('produces the same key regardless of original casing', () => {
    expect(testHelpers.getEmailKey('U@TEST.COM', 'VERIFY EMAIL')).toBe(
      testHelpers.getEmailKey('u@test.com', 'verify email')
    );
  });
});

// ── sent-email deduplication (wasEmailAlreadySent/recordEmailSent/clear) ──────

describe('sent-email deduplication tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testHelpers.clearSentEmails();
  });

  afterEach(() => {
    vi.useRealTimers();
    testHelpers.clearSentEmails();
  });

  it('returns false for an email that was never sent', () => {
    expect(testHelpers.wasEmailAlreadySent('fresh@test.com', 'Welcome')).toBe(
      false
    );
  });

  it('returns true immediately after recordEmailSent', () => {
    const to = uniqueEmail('rec');
    testHelpers.recordEmailSent(to, 'Recorded');
    expect(testHelpers.wasEmailAlreadySent(to, 'Recorded')).toBe(true);
  });

  it('is case-insensitive on lookup', () => {
    testHelpers.recordEmailSent('Upper@Example.COM', 'MY SUBJECT');
    expect(
      testHelpers.wasEmailAlreadySent('upper@example.com', 'my subject')
    ).toBe(true);
  });

  it('returns false once the record ages past SENT_EMAIL_TTL', () => {
    const to = uniqueEmail('ttl');
    testHelpers.recordEmailSent(to, 'Old');
    vi.advanceTimersByTime(EMAIL_RETRY.SENT_EMAIL_TTL + 1);
    expect(testHelpers.wasEmailAlreadySent(to, 'Old')).toBe(false);
  });

  it('clearSentEmails empties the map', () => {
    const to = uniqueEmail('clear');
    testHelpers.recordEmailSent(to, 'Subj');
    testHelpers.clearSentEmails();
    expect(testHelpers.wasEmailAlreadySent(to, 'Subj')).toBe(false);
  });
});

// ── isRetriableEmailError ─────────────────────────────────────────────────────

describe('isRetriableEmailError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCommon.mockReturnValue(false);
  });

  it('short-circuits to true when isCommonRetriableError is true', () => {
    mockIsCommon.mockReturnValue(true);
    expect(isRetriableEmailError(new Error('connection reset'))).toBe(true);
    expect(mockIsCommon).toHaveBeenCalledTimes(1);
  });

  it('returns false for authentication errors', () => {
    expect(
      isRetriableEmailError(new Error('Authentication failed for user'))
    ).toBe(false);
  });

  it('returns false for 550 permanent error', () => {
    expect(isRetriableEmailError(new Error('550 User not found'))).toBe(false);
  });

  it('returns false for 551 error', () => {
    expect(isRetriableEmailError(new Error('551 User not local'))).toBe(false);
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

  it('defaults to true for unknown errors', () => {
    expect(isRetriableEmailError(new Error('something unfamiliar'))).toBe(true);
  });

  it('defaults to true for an empty error message', () => {
    expect(isRetriableEmailError(new Error(''))).toBe(true);
  });
});

// ── parseEmailTimeout ─────────────────────────────────────────────────────────

describe('parseEmailTimeout', () => {
  it('returns the supplied default when the env var is absent', () => {
    expect(parseEmailTimeout('EMAIL_DOES_NOT_EXIST', 12000)).toBe(12000);
  });
});

// ── metrics ───────────────────────────────────────────────────────────────────

describe('updateEmailMetrics / getEmailMetrics', () => {
  // Metrics are module-level singletons — capture a baseline before each test.
  let baseline: ReturnType<typeof getEmailMetrics>;

  beforeEach(() => {
    baseline = getEmailMetrics();
  });

  it('increments sent by 1 on success without retries', () => {
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

  it('increments retried when retries > 0', () => {
    updateEmailMetrics(true, 2);
    expect(getEmailMetrics().retried).toBe(baseline.retried + 1);
  });

  it('keeps a positive running avgRetries after a retried send', () => {
    updateEmailMetrics(true, 4);
    expect(getEmailMetrics().avgRetries).toBeGreaterThan(0);
  });

  it('increments failed by 1 on failure', () => {
    updateEmailMetrics(false, 0);
    expect(getEmailMetrics().failed).toBe(baseline.failed + 1);
  });

  it('stores lastError message when an error is provided', () => {
    updateEmailMetrics(false, 0, new Error('SMTP unreachable'));
    expect(getEmailMetrics().lastError).toBe('SMTP unreachable');
  });

  it('getEmailMetrics returns a detached snapshot', () => {
    const snap = getEmailMetrics();
    const sentBefore = snap.sent;
    updateEmailMetrics(true, 0);
    expect(snap.sent).toBe(sentBefore);
  });

  it('logs a checkpoint when (sent + failed) hits an exact multiple of 100', () => {
    vi.clearAllMocks();
    const current = getEmailMetrics().sent + getEmailMetrics().failed;
    const needed = Math.ceil((current + 1) / 100) * 100 - current;
    for (let i = 0; i < needed; i++) {
      updateEmailMetrics(true, 0);
    }
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining('checkpoint'),
      expect.any(String),
      expect.any(Object)
    );
  });
});

// ── sendMailWithTimeout ───────────────────────────────────────────────────────

describe('sendMailWithTimeout', () => {
  const mailOptions = {
    to: 'dest@test.com',
    subject: 'Timeout test',
    html: '<p>x</p>',
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the sendMail result when SMTP responds before timeout', async () => {
    const expected = { messageId: 'fast-send' };
    const transporter = { sendMail: vi.fn().mockResolvedValue(expected) };
    const promise = sendMailWithTimeout(transporter, mailOptions);
    vi.advanceTimersByTime(0);
    await expect(promise).resolves.toEqual(expected);
  });

  it('rejects with a timeout error when sendMail hangs past EMAIL_TIMEOUTS.SEND', async () => {
    const transporter = {
      sendMail: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    const promise = sendMailWithTimeout(transporter, mailOptions);
    vi.advanceTimersByTime(31000);
    await expect(promise).rejects.toThrow(/timeout/i);
  });
});

// ── sendEmailWithRetry ────────────────────────────────────────────────────────

describe('sendEmailWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testHelpers.clearSentEmails();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const config = { from: { name: 'My Platform', email: 'noreply@platform.com' } };
  const okConfig = {
    ...DEFAULT_EMAIL_RETRY_CONFIG,
    maxRetries: 0,
    globalTimeout: 60000,
  };

  it('succeeds on the first attempt', async () => {
    const expected = { messageId: 'ok-123' };
    const transporter = { sendMail: vi.fn().mockResolvedValue(expected) };
    const result = await sendEmailWithRetry(
      transporter,
      config,
      { to: 'ok@test.com', subject: 'OK', html: '<p>ok</p>' },
      okConfig
    );
    expect(result).toEqual(expected);
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure via executeWithRetry', async () => {
    const transporter = { sendMail: vi.fn() };
    transporter.sendMail
      .mockRejectedValueOnce(new Error('ECONNRESET network error'))
      .mockResolvedValueOnce({ messageId: 'msg-retry-ok' });

    // Simulate executeWithRetry invoking the operation twice.
    mockExecuteWithRetry.mockImplementationOnce(async (fn: () => unknown) => {
      try {
        return await fn();
      } catch {
        return await fn();
      }
    });

    const result = await sendEmailWithRetry(
      transporter,
      config,
      { to: 'user@example.com', subject: 'Retry Test' },
      DEFAULT_EMAIL_RETRY_CONFIG
    );
    expect(result).toEqual({ messageId: 'msg-retry-ok' });
    expect(transporter.sendMail).toHaveBeenCalledTimes(2);
  });

  it('builds mailOptions with from/to/subject/html', async () => {
    let captured: Record<string, unknown> | undefined;
    const transporter = {
      sendMail: vi.fn(async (opts: Record<string, unknown>) => {
        captured = opts;
        return { messageId: 'opt-check' };
      }),
    };
    await sendEmailWithRetry(
      transporter,
      config,
      { to: 'user@example.com', subject: 'Hello', html: '<p>hi</p>' },
      okConfig
    );
    expect(captured!.from).toBe('"My Platform" <noreply@platform.com>');
    expect(captured!.to).toBe('user@example.com');
    expect(captured!.subject).toBe('Hello');
    expect(captured!.html).toBe('<p>hi</p>');
  });

  it('defaults replyTo to config.from when options.replyTo is absent', async () => {
    let captured: Record<string, unknown> | undefined;
    const transporter = {
      sendMail: vi.fn(async (opts: Record<string, unknown>) => {
        captured = opts;
        return { messageId: 'reply-default' };
      }),
    };
    await sendEmailWithRetry(
      transporter,
      config,
      { to: 'a@b.com', subject: 'Sub' },
      okConfig
    );
    expect(captured!.replyTo).toBe('"My Platform" <noreply@platform.com>');
  });

  it('uses caller-supplied replyTo when provided', async () => {
    let captured: Record<string, unknown> | undefined;
    const transporter = {
      sendMail: vi.fn(async (opts: Record<string, unknown>) => {
        captured = opts;
        return { messageId: 'reply-override' };
      }),
    };
    await sendEmailWithRetry(
      transporter,
      config,
      { to: 'a@b.com', subject: 'Sub', replyTo: 'submitter@user.com' },
      okConfig
    );
    expect(captured!.replyTo).toBe('submitter@user.com');
  });

  it('throws "not properly initialized" when transporter is null', async () => {
    mockExecuteWithRetry.mockImplementationOnce(async (fn: () => unknown) =>
      fn()
    );
    await expect(
      sendEmailWithRetry(
        null as unknown as { sendMail: () => Promise<unknown> },
        config,
        { to: 'x@y.com', subject: 'S' },
        okConfig
      )
    ).rejects.toThrow('not properly initialized');
  });

  it('throws a global-timeout error when elapsed time approaches the limit', async () => {
    const fakeStart = Date.now() - 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeStart + 60_000);
    mockExecuteWithRetry.mockImplementationOnce(async (fn: () => unknown) =>
      fn()
    );

    const transporter = { sendMail: vi.fn(async () => ({ messageId: 'm' })) };
    await expect(
      sendEmailWithRetry(
        transporter,
        config,
        { to: 'x@y.com', subject: 'Timeout test' },
        { ...DEFAULT_EMAIL_RETRY_CONFIG, maxRetries: 0, globalTimeout: 1000 }
      )
    ).rejects.toThrow(/timeout/i);

    vi.restoreAllMocks();
  });
});

// ── DEFAULT_EMAIL_RETRY_CONFIG ────────────────────────────────────────────────

describe('DEFAULT_EMAIL_RETRY_CONFIG', () => {
  it('has numeric fields for all knobs', () => {
    expect(typeof DEFAULT_EMAIL_RETRY_CONFIG.maxRetries).toBe('number');
    expect(typeof DEFAULT_EMAIL_RETRY_CONFIG.initialDelay).toBe('number');
    expect(typeof DEFAULT_EMAIL_RETRY_CONFIG.maxDelay).toBe('number');
    expect(typeof DEFAULT_EMAIL_RETRY_CONFIG.backoffFactor).toBe('number');
    expect(typeof DEFAULT_EMAIL_RETRY_CONFIG.globalTimeout).toBe('number');
  });

  it('backoffFactor defaults to 2 when EMAIL_RETRY_BACKOFF_FACTOR is unset', () => {
    expect(DEFAULT_EMAIL_RETRY_CONFIG.backoffFactor).toBe(2);
  });
});

// ── queueEmailForRetry — persistence + duplicate protection ──────────────────
//
// Fake timers freeze the queue processor (setImmediate never fires), so the
// queue stays put for length/field assertions and no real SMTP send is attempted.

describe('queueEmailForRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    testHelpers.clearSentEmails();
  });

  afterEach(() => {
    vi.useRealTimers();
    testHelpers.clearSentEmails();
  });

  it('returns a fresh "email_"-prefixed id on first enqueue', () => {
    const id = queueEmailForRetry({ to: uniqueEmail('first'), subject: 'First' });
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^email_/);
  });

  it('returns "duplicate-skipped" and warns when the email was already sent', () => {
    const to = uniqueEmail('sent');
    testHelpers.recordEmailSent(to, 'Already sent');
    expect(queueEmailForRetry({ to, subject: 'Already sent' })).toBe(
      'duplicate-skipped'
    );
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'Email already sent recently, skipping queue',
      'EmailRetryService',
      expect.any(Object)
    );
  });

  it('does NOT grow the queue when the email was already sent', () => {
    const to = uniqueEmail('noqueue');
    testHelpers.recordEmailSent(to, 'Should not queue');
    const before = getQueueStatus().length;
    queueEmailForRetry({ to, subject: 'Should not queue' });
    expect(getQueueStatus().length).toBe(before);
  });

  it('returns the existing id and warns when the same to+subject is already queued', () => {
    const opts = { to: uniqueEmail('dup'), subject: 'Same subject' };
    const id1 = queueEmailForRetry(opts);
    vi.mocked(logger.warn).mockClear();
    const id2 = queueEmailForRetry(opts);
    expect(id2).toBe(id1);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'Email already in queue, skipping duplicate',
      'EmailRetryService',
      expect.any(Object)
    );
  });

  it('allows distinct recipients that share a subject', () => {
    const subject = 'Shared Subject';
    const id1 = queueEmailForRetry({ to: uniqueEmail('a'), subject });
    const id2 = queueEmailForRetry({ to: uniqueEmail('b'), subject });
    expect(id1).not.toBe(id2);
  });

  it('allows distinct subjects to the same recipient', () => {
    const to = uniqueEmail('same-to');
    const id1 = queueEmailForRetry({ to, subject: 'Sub Alpha' });
    const id2 = queueEmailForRetry({ to, subject: 'Sub Beta' });
    expect(id1).not.toBe(id2);
  });
});

// ── getQueueStatus ────────────────────────────────────────────────────────────

describe('getQueueStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testHelpers.clearSentEmails();
  });

  afterEach(() => {
    vi.useRealTimers();
    testHelpers.clearSentEmails();
  });

  it('returns { length, processing, emails }', () => {
    const status = getQueueStatus();
    expect(typeof status.length).toBe('number');
    expect(typeof status.processing).toBe('boolean');
    expect(Array.isArray(status.emails)).toBe(true);
  });

  it('reflects a freshly queued email with attempts/globalAttempts=0 and no nextRetryAt', () => {
    const opts = { to: uniqueEmail('qs'), subject: 'QueueStatus probe' };
    const id = queueEmailForRetry(opts);
    const entry = getQueueStatus().emails.find(e => e.id === id);
    expect(entry).toBeDefined();
    expect(entry!.to).toBe(opts.to);
    expect(entry!.subject).toBe(opts.subject);
    expect(entry!.attempts).toBe(0);
    expect(entry!.globalAttempts).toBe(0);
    // nextRetryAt is only set after a failure.
    expect(entry!.nextRetryAt).toBeUndefined();
  });

  it('length grows by one per unique enqueue', () => {
    const before = getQueueStatus().length;
    queueEmailForRetry({ to: uniqueEmail('len1'), subject: 'Len1' });
    queueEmailForRetry({ to: uniqueEmail('len2'), subject: 'Len2' });
    expect(getQueueStatus().length).toBe(before + 2);
  });

  it('length is unchanged when an in-queue duplicate is re-queued', () => {
    const opts = { to: uniqueEmail('inq'), subject: 'InQ Dup' };
    queueEmailForRetry(opts);
    const before = getQueueStatus().length;
    queueEmailForRetry(opts);
    expect(getQueueStatus().length).toBe(before);
  });
});

// ── getQueuedEmails ───────────────────────────────────────────────────────────

describe('getQueuedEmails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testHelpers.clearSentEmails();
  });

  afterEach(() => {
    vi.useRealTimers();
    testHelpers.clearSentEmails();
  });

  it('returns a separate array instance on each call', () => {
    expect(getQueuedEmails()).not.toBe(getQueuedEmails());
  });

  it('returns a defensive copy — mutations do not affect internal state', () => {
    queueEmailForRetry({ to: uniqueEmail('copy'), subject: 'Copy test' });
    const snapshot = getQueuedEmails();
    const lengthBefore = snapshot.length;
    snapshot.splice(0, snapshot.length);
    expect(getQueuedEmails()).toHaveLength(lengthBefore);
  });

  it('exposes id/options/attempts/globalAttempts/createdAt on entries', () => {
    const opts = { to: uniqueEmail('entry'), subject: 'Entry fields' };
    const id = queueEmailForRetry(opts);
    const entry = getQueuedEmails().find(e => e.id === id);
    expect(entry).toBeDefined();
    expect(entry!.options.to).toBe(opts.to);
    expect(entry!.options.subject).toBe(opts.subject);
    expect(entry!.attempts).toBe(0);
    expect(entry!.globalAttempts).toBe(0);
    expect(entry!.createdAt).toBeInstanceOf(Date);
  });
});

// ── forceProcessQueue ─────────────────────────────────────────────────────────

describe('forceProcessQueue', () => {
  it('resolves without error when the queue is empty', async () => {
    testHelpers.clearSentEmails();
    await expect(forceProcessQueue()).resolves.toBeUndefined();
  });
});
