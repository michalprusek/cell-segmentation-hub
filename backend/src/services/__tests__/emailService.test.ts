import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// nodemailer mock: resetMocks resets implementations but not the factory.
// We return a fresh object each time createTransport is called so _transporter is set.
const createFakeTransporter = () => ({
  verify: jest.fn(async () => true) as any,
  sendMail: jest.fn(async () => ({ messageId: 'default-msg-id' })) as any,
});

jest.mock('nodemailer', () => ({
  default: {
    createTransport: jest.fn(() => createFakeTransporter()),
  },
  createTransport: jest.fn(() => createFakeTransporter()),
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../utils/envValidator', () => ({
  // Read actual env var so SKIP_EMAIL_SEND works correctly in tests
  getBooleanEnvVar: jest.fn((key: string, defaultVal: boolean) => {
    const val = process.env[key];
    if (val === 'true') return true;
    if (val === 'false') return false;
    return defaultVal;
  }),
  getNumericEnvVar: jest.fn((_key: string, defaultVal: number) => defaultVal),
}));
jest.mock('../../services/emailRetryService', () => ({
  sendEmailWithRetry: jest.fn(async () => ({ messageId: 'retry-msg-id' })),
  parseEmailTimeout: jest.fn((_key: string, def: number) => def),
  updateEmailMetrics: jest.fn(),
  queueEmailForRetry: jest.fn(() => 'queue-id-123'),
}));
jest.mock('../../constants/email', () => ({
  isUTIASmtpServer: jest.fn(() => false),
  SMTP_HOSTS: { UTIA: 'hermes.utia.cas.cz', UTIA_BACKUP: 'mail.utia.cas.cz' },
}));
jest.mock('../../templates/passwordResetEmailMultilang', () => ({
  generateSimplePasswordResetHTML: jest.fn(() => '<html>reset</html>'),
  generateSimplePasswordResetText: jest.fn(() => 'reset text'),
  getPasswordResetSubject: jest.fn(() => 'Reset your password'),
}));
jest.mock('../../templates/verificationEmail', () => ({
  generateVerificationEmailHTML: jest.fn(() => ({
    subject: 'Verify your email',
    html: '<html>verify</html>',
  })),
}));
jest.mock('../../utils/escapeHtml', () => ({
  escapeHtml: jest.fn((s: string) => s),
  sanitizeUrl: jest.fn((s: string) => s),
}));

import * as emailService from '../emailService';
import * as emailRetryService from '../emailRetryService';
import nodemailer from 'nodemailer';
import * as verificationEmailTemplate from '../../templates/verificationEmail';
import * as envValidator from '../../utils/envValidator';

const mockCreateTransport = nodemailer.createTransport as ReturnType<typeof jest.fn>;
const mockSendEmailWithRetry = emailRetryService.sendEmailWithRetry as ReturnType<typeof jest.fn>;
const mockQueueEmailForRetry = emailRetryService.queueEmailForRetry as ReturnType<typeof jest.fn>;
const mockGenerateVerificationEmailHTML = verificationEmailTemplate.generateVerificationEmailHTML as ReturnType<typeof jest.fn>;
const mockGetBooleanEnvVar = envValidator.getBooleanEnvVar as ReturnType<typeof jest.fn>;

describe('EmailService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // resetMocks:true clears implementations — re-establish all of them
    mockCreateTransport.mockImplementation(() => createFakeTransporter());
    (mockSendEmailWithRetry as any).mockResolvedValue({ messageId: 'mock-msg-id' });
    (mockQueueEmailForRetry as any).mockReturnValue('queue-id-123');
    // Re-establish template mock that gets wiped by resetMocks
    mockGenerateVerificationEmailHTML.mockReturnValue({
      subject: 'Verify your email',
      html: '<html>verify</html>',
    });
    // Re-establish envValidator to read from actual process.env
    mockGetBooleanEnvVar.mockImplementation((key: string, defaultVal: boolean) => {
      const val = process.env[key];
      if (val === 'true') return true;
      if (val === 'false') return false;
      return defaultVal;
    });

    process.env.SKIP_EMAIL_SEND = 'false';
    process.env.SMTP_HOST = 'mailhog';
    process.env.SMTP_PORT = '1025';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_AUTH = 'false';
    process.env.EMAIL_SERVICE = 'smtp';
    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  describe('init', () => {
    it('creates SMTP transporter with correct config', () => {
      emailService.init();

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'mailhog',
          port: 1025,
          secure: false,
        })
      );
    });

    it('creates sendgrid transporter when EMAIL_SERVICE is sendgrid', () => {
      process.env.EMAIL_SERVICE = 'sendgrid';
      process.env.SENDGRID_API_KEY = 'SG.test-key';

      emailService.init();

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.sendgrid.net',
          port: 587,
        })
      );
    });
  });

  describe('sendEmail', () => {
    it('sends via transporter when initialized and not UTIA', async () => {
      emailService.init();

      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>test</p>',
      });

      expect(mockSendEmailWithRetry).toHaveBeenCalled();
    });

    it('returns early when SKIP_EMAIL_SEND is true', async () => {
      process.env.SKIP_EMAIL_SEND = 'true';

      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
      });

      expect(mockSendEmailWithRetry).not.toHaveBeenCalled();
    });

    it('throws when transporter send fails', async () => {
      emailService.init();
      (mockSendEmailWithRetry as any).mockRejectedValueOnce(new Error('SMTP unavailable'));

      await expect(
        emailService.sendEmail({ to: 'user@example.com', subject: 'Test' })
      ).rejects.toThrow('Failed to send email to user@example.com');
    });

    it('throws with descriptive message on any transporter failure', async () => {
      emailService.init();
      (mockSendEmailWithRetry as any).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        emailService.sendEmail({ to: 'fail@example.com', subject: 'Boom' })
      ).rejects.toThrow('Failed to send email to fail@example.com');
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('generates correct HTML template with reset link and sends', async () => {
      emailService.init();

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await emailService.sendPasswordResetEmail(
        'user@example.com',
        'reset-token-abc',
        expiresAt,
        'en'
      );

      expect(mockSendEmailWithRetry).toHaveBeenCalled();
    });

    it('skips sending when SKIP_EMAIL_SEND is true', async () => {
      process.env.SKIP_EMAIL_SEND = 'true';

      await emailService.sendPasswordResetEmail(
        'user@example.com',
        'reset-token-abc',
        new Date(),
        'en'
      );

      expect(mockSendEmailWithRetry).not.toHaveBeenCalled();
    });
  });

  describe('sendVerificationEmail', () => {
    it('generates verification link and sends email', async () => {
      emailService.init();

      await emailService.sendVerificationEmail(
        'newuser@example.com',
        'verify-token-xyz',
        'en'
      );

      expect(mockSendEmailWithRetry).toHaveBeenCalled();
    });

    it('queues email via queueEmailForRetry when UTIA SMTP is configured', async () => {
      const { isUTIASmtpServer } = await import('../../constants/email');
      (isUTIASmtpServer as ReturnType<typeof jest.fn>).mockReturnValueOnce(true);

      await emailService.sendVerificationEmail(
        'newuser@example.com',
        'verify-token-xyz',
        'cs'
      );

      expect(mockQueueEmailForRetry).toHaveBeenCalled();
    });
  });

  describe('isConfigured (testConnection)', () => {
    it('returns true when transporter verify succeeds', async () => {
      // Build a transporter where verify resolves successfully
      const fakeTransporter = {
        verify: jest.fn(async () => true) as any,
        sendMail: jest.fn() as any,
      };
      mockCreateTransport.mockReturnValueOnce(fakeTransporter);
      emailService.init();

      const result = await emailService.testConnection();

      expect(result).toBe(true);
    });

    it('returns false when transporter verify rejects', async () => {
      const fakeTransporter = {
        verify: jest.fn(async () => { throw new Error('ECONNREFUSED'); }) as any,
        sendMail: jest.fn() as any,
      };
      mockCreateTransport.mockReturnValueOnce(fakeTransporter);
      emailService.init();

      const result = await emailService.testConnection();

      expect(result).toBe(false);
    });
  });
});
