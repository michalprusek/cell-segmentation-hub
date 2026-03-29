import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mocks must be before imports
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../utils/envValidator', () => ({
  getNumericEnvVar: jest.fn((_key: string, defaultVal: number) => defaultVal),
}));
jest.mock('../../constants/email', () => ({
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
  isUTIASmtpServer: jest.fn(() => false),
  getMaxRetryAttempts: jest.fn(() => 3),
  getQueueProcessingDelay: jest.fn(() => 10),
}));
jest.mock('../../utils/retryService', () => ({
  retryService: {
    executeWithRetry: jest.fn(async (fn: () => unknown) => fn()),
  },
  RetryService: {
    isCommonRetriableError: jest.fn(() => false),
  },
}));

import {
  sendEmailWithRetry,
  queueEmailForRetry,
  testHelpers,
  DEFAULT_EMAIL_RETRY_CONFIG,
} from '../emailRetryService';
import { retryService } from '../../utils/retryService';

const mockExecuteWithRetry = retryService.executeWithRetry as ReturnType<typeof jest.fn>;

describe('EmailRetryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    testHelpers.clearSentEmails();
  });

  afterEach(() => {
    testHelpers.clearSentEmails();
  });

  describe('sendEmailWithRetry', () => {
    it('succeeds on first attempt', async () => {
      const mockResult = { messageId: 'msg-ok' };
      const mockTransporter = {
        sendMail: jest.fn(() => Promise.resolve(mockResult)) as any,
      };
      mockExecuteWithRetry.mockImplementationOnce(async (fn: () => unknown) => fn() as any);
      mockTransporter.sendMail.mockResolvedValueOnce(mockResult as any);

      const config = {
        from: { name: 'Test Platform', email: 'noreply@test.com' },
      };

      const result = await sendEmailWithRetry(
        mockTransporter,
        config,
        { to: 'user@example.com', subject: 'Hello', html: '<p>test</p>' },
        { ...DEFAULT_EMAIL_RETRY_CONFIG, maxRetries: 1 }
      );

      expect(result).toEqual(mockResult);
    });

    it('retries on transient failure via executeWithRetry', async () => {
      const mockTransporter = {
        sendMail: jest.fn() as any,
      };
      const transientError = new Error('ECONNRESET network error');
      mockTransporter.sendMail
        .mockRejectedValueOnce(transientError as any)
        .mockResolvedValueOnce({ messageId: 'msg-retry-ok' } as any);

      // Simulate retry logic: executeWithRetry calls the fn twice internally
      mockExecuteWithRetry.mockImplementationOnce(async (fn: () => unknown) => {
        try {
          return await fn() as any;
        } catch {
          return await fn() as any; // retry once
        }
      });

      const config = { from: { name: 'Test', email: 'noreply@test.com' } };
      const result = await sendEmailWithRetry(
        mockTransporter,
        config,
        { to: 'user@example.com', subject: 'Retry Test' },
        DEFAULT_EMAIL_RETRY_CONFIG
      );

      expect(result).toEqual({ messageId: 'msg-retry-ok' });
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(2);
    });
  });

  describe('wasEmailAlreadySent', () => {
    it('detects duplicates within TTL', () => {
      testHelpers.recordEmailSent('user@example.com', 'Welcome!');

      const isDuplicate = testHelpers.wasEmailAlreadySent('user@example.com', 'Welcome!');

      expect(isDuplicate).toBe(true);
    });

    it('is case-insensitive for email and subject', () => {
      testHelpers.recordEmailSent('User@Example.COM', 'WELCOME!');

      const isDuplicate = testHelpers.wasEmailAlreadySent('user@example.com', 'welcome!');

      expect(isDuplicate).toBe(true);
    });

    it('returns false when no record exists', () => {
      const isDuplicate = testHelpers.wasEmailAlreadySent('new@example.com', 'Hello');

      expect(isDuplicate).toBe(false);
    });

    it('allows re-send after TTL expiry by simulating expired record', () => {
      // Manually manipulate via recordEmailSent and then clear
      testHelpers.recordEmailSent('old@example.com', 'Old subject');
      testHelpers.clearSentEmails(); // clear simulates TTL expiry for test purposes

      const isDuplicate = testHelpers.wasEmailAlreadySent('old@example.com', 'Old subject');

      expect(isDuplicate).toBe(false);
    });
  });

  describe('recordEmailSent', () => {
    it('records in sent map so subsequent calls detect duplicate', () => {
      expect(testHelpers.wasEmailAlreadySent('track@example.com', 'Track me')).toBe(false);

      testHelpers.recordEmailSent('track@example.com', 'Track me');

      expect(testHelpers.wasEmailAlreadySent('track@example.com', 'Track me')).toBe(true);
    });
  });

  describe('queueEmailForRetry', () => {
    it('adds to retry queue and returns an id', () => {
      const id = queueEmailForRetry({
        to: 'queued@example.com',
        subject: 'Queue test',
        html: '<p>queued</p>',
      });

      expect(typeof id).toBe('string');
      expect(id).toMatch(/email_/);
    });

    it('returns duplicate-skipped when email was already sent', () => {
      testHelpers.recordEmailSent('sent@example.com', 'Already sent');

      const id = queueEmailForRetry({
        to: 'sent@example.com',
        subject: 'Already sent',
        html: '<p>dup</p>',
      });

      expect(id).toBe('duplicate-skipped');
    });

    it('returns existing queue id for duplicate in-flight email', () => {
      const id1 = queueEmailForRetry({
        to: 'inflight@example.com',
        subject: 'In flight',
      });
      const id2 = queueEmailForRetry({
        to: 'inflight@example.com',
        subject: 'In flight',
      });

      expect(id1).toBe(id2);
    });
  });

  describe('getEmailKey', () => {
    it('generates consistent lowercase key', () => {
      const key1 = testHelpers.getEmailKey('User@Test.COM', 'Hello World');
      const key2 = testHelpers.getEmailKey('user@test.com', 'hello world');

      expect(key1).toBe(key2);
    });
  });
});
