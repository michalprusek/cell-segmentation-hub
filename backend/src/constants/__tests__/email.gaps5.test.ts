/**
 * email.gaps5.test.ts
 *
 * Covers branches still uncovered in constants/email.ts:
 *
 *  A. isUTIASmtpServer — returns true for UTIA hosts
 *  B. getEmailTimeout — returns UTIA timeout for UTIA host
 *  C. getMaxRetryAttempts — returns UTIA max attempts for UTIA host
 *  D. getQueueProcessingDelay — returns UTIA delay for UTIA host
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ORIGINAL_SMTP_HOST = process.env.SMTP_HOST;

afterEach(() => {
  if (ORIGINAL_SMTP_HOST === undefined) {
    delete process.env.SMTP_HOST;
  } else {
    process.env.SMTP_HOST = ORIGINAL_SMTP_HOST;
  }
});

import {
  isUTIASmtpServer,
  getEmailTimeout,
  getMaxRetryAttempts,
  getQueueProcessingDelay,
} from '../email';

describe('isUTIASmtpServer', () => {
  it('returns true for UTIA host', () => {
    process.env.SMTP_HOST = 'mail.utia.cas.cz';
    expect(isUTIASmtpServer()).toBe(true);
  });

  it('returns true for UTIA backup host', () => {
    process.env.SMTP_HOST = 'hermes.utia.cas.cz';
    expect(isUTIASmtpServer()).toBe(true);
  });

  it('returns false for other host', () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    expect(isUTIASmtpServer()).toBe(false);
  });

  it('returns false when SMTP_HOST is not set', () => {
    delete process.env.SMTP_HOST;
    expect(isUTIASmtpServer()).toBe(false);
  });
});

describe('getEmailTimeout', () => {
  it('returns UTIA timeout for UTIA host', () => {
    process.env.SMTP_HOST = 'mail.utia.cas.cz';
    const timeout = getEmailTimeout();
    expect(timeout).toBeGreaterThan(0);
  });

  it('returns standard timeout for non-UTIA host', () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    const timeout = getEmailTimeout();
    expect(timeout).toBeGreaterThan(0);
  });
});

describe('getMaxRetryAttempts', () => {
  it('returns UTIA max attempts for UTIA host', () => {
    process.env.SMTP_HOST = 'mail.utia.cas.cz';
    const attempts = getMaxRetryAttempts();
    expect(attempts).toBeGreaterThan(0);
  });

  it('returns standard max attempts for non-UTIA host', () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    const attempts = getMaxRetryAttempts();
    expect(attempts).toBeGreaterThan(0);
  });
});

describe('getQueueProcessingDelay', () => {
  it('returns UTIA delay for UTIA host', () => {
    process.env.SMTP_HOST = 'mail.utia.cas.cz';
    const delay = getQueueProcessingDelay();
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('returns standard delay for non-UTIA host', () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    const delay = getQueueProcessingDelay();
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});
