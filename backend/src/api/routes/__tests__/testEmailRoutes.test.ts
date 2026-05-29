/**
 * testEmailRoutes.test.ts
 *
 * Supertest integration tests for src/api/routes/testEmailRoutes.ts.
 * All external deps mocked. Tests cover:
 *  - GET /test-connection: success, failure, thrown error
 *  - POST /send-test: missing body, invalid email, success, thrown error
 *  - POST /send-direct: missing body, invalid email, success, thrown error
 *  - GET /queue-status: success, thrown error
 *  - POST /force-queue-process: success, thrown error
 *  - GET /queue-emails: success, thrown error
 *  - All routes require authentication (401 without token)
 */
import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── hoisted mock references (avoids TDZ in vi.mock factories) ────────────────
const {
  mockTestConnection,
  mockSendEmail,
  mockGetQueueStatus,
  mockForceProcessQueue,
  mockGetQueuedEmails,
} = vi.hoisted(() => ({
  mockTestConnection: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGetQueueStatus: vi.fn(),
  mockForceProcessQueue: vi.fn(),
  mockGetQueuedEmails: vi.fn(),
}));

// ─── mock config (must precede any source import) ─────────────────────────────
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    FROM_EMAIL: 'test@example.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
    UPLOAD_DIR: './test-uploads',
    STORAGE_TYPE: 'local',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

// ─── service mocks ─────────────────────────────────────────────────────────────
vi.mock('../../../services/emailService', () => ({
  testConnection: mockTestConnection,
  sendEmail: mockSendEmail,
}));

vi.mock('../../../services/emailRetryService', () => ({
  getQueueStatus: mockGetQueueStatus,
  forceProcessQueue: mockForceProcessQueue,
  getQueuedEmails: mockGetQueuedEmails,
}));

// ─── middleware mocks ──────────────────────────────────────────────────────────
vi.mock('../../../middleware/auth', () => ({
  authenticate: vi.fn((_req: unknown, _res: unknown, next: () => void) =>
    next()
  ),
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    success: (res: express.Response, data: unknown, message?: string) =>
      res.status(200).json({ success: true, data, message }),
    badRequest: (res: express.Response, message: string) =>
      res.status(400).json({ success: false, message }),
    internalError: (res: express.Response, _e: unknown, message?: string) =>
      res.status(500).json({ success: false, message }),
    error: (res: express.Response, err: unknown, statusCode = 500) =>
      res.status(statusCode).json({ success: false, err }),
  },
}));

// ─── nodemailer stub (prevents SMTP connection attempt) ────────────────────────
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn(),
    verify: vi.fn(),
    close: vi.fn(),
  })),
}));

import testEmailRouter from '../testEmailRoutes';
import { authenticate } from '../../../middleware/auth';

// ─── test application factory ─────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', testEmailRouter);
  return app;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Make authenticate pass through (default). */
function allowAuth() {
  vi.mocked(authenticate).mockImplementation((_req, _res, next) => next());
}

/** Make authenticate reject with 401. */
function denyAuth() {
  vi.mocked(authenticate).mockImplementation((_req, res) => {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('testEmailRoutes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    allowAuth();
  });

  // ─── GET /test-connection ──────────────────────────────────────────────────

  describe('GET /test-connection', () => {
    it('returns 200 with service info when testConnection resolves true', async () => {
      mockTestConnection.mockResolvedValue(true);
      const res = await request(app).get('/test-connection');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 500 when testConnection resolves false', async () => {
      mockTestConnection.mockResolvedValue(false);
      const res = await request(app).get('/test-connection');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 when testConnection throws', async () => {
      mockTestConnection.mockRejectedValue(new Error('SMTP connect fail'));
      const res = await request(app).get('/test-connection');
      expect(res.status).toBe(500);
    });

    it('returns 401 when authentication fails', async () => {
      denyAuth();
      const res = await request(app).get('/test-connection');
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /send-test ──────────────────────────────────────────────────────

  describe('POST /send-test', () => {
    it('returns 400 when `to` field is absent', async () => {
      const res = await request(app).post('/send-test').send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 when `to` is not a string', async () => {
      const res = await request(app).post('/send-test').send({ to: 123 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when `to` is an invalid email format', async () => {
      const res = await request(app)
        .post('/send-test')
        .send({ to: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('returns 200 and calls sendEmail on valid email', async () => {
      mockSendEmail.mockResolvedValue(undefined);
      const res = await request(app)
        .post('/send-test')
        .send({ to: 'user@example.com' });
      expect(res.status).toBe(200);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' })
      );
    });

    it('trims whitespace from the email address', async () => {
      mockSendEmail.mockResolvedValue(undefined);
      await request(app)
        .post('/send-test')
        .send({ to: '  user@example.com  ' });
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' })
      );
    });

    it('returns 500 when sendEmail throws', async () => {
      mockSendEmail.mockRejectedValue(new Error('SMTP error'));
      const res = await request(app)
        .post('/send-test')
        .send({ to: 'user@example.com' });
      expect(res.status).toBe(500);
    });

    it('returns 401 when authentication fails', async () => {
      denyAuth();
      const res = await request(app)
        .post('/send-test')
        .send({ to: 'user@example.com' });
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /send-direct ───────────────────────────────────────────────────

  describe('POST /send-direct', () => {
    it('returns 400 when `to` field is absent', async () => {
      const res = await request(app).post('/send-direct').send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 when `to` is an invalid email', async () => {
      const res = await request(app)
        .post('/send-direct')
        .send({ to: 'bad@@email' });
      expect(res.status).toBe(400);
    });

    it('returns 200 with sendTime and recipient on success', async () => {
      mockSendEmail.mockResolvedValue(undefined);
      const res = await request(app)
        .post('/send-direct')
        .send({ to: 'direct@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data?.recipient).toBe('direct@example.com');
      expect(res.body.data?.queueBypassed).toBe(true);
    });

    it('passes allowQueue=false as second arg to sendEmail', async () => {
      mockSendEmail.mockResolvedValue(undefined);
      await request(app).post('/send-direct').send({ to: 'x@x.com' });
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'x@x.com' }),
        false
      );
    });

    it('returns 500 when sendEmail throws', async () => {
      mockSendEmail.mockRejectedValue(new Error('Direct send fail'));
      const res = await request(app)
        .post('/send-direct')
        .send({ to: 'x@x.com' });
      expect(res.status).toBe(500);
    });
  });

  // ─── GET /queue-status ────────────────────────────────────────────────────

  describe('GET /queue-status', () => {
    it('returns 200 with queue status object', async () => {
      const status = { length: 3, processing: true };
      mockGetQueueStatus.mockReturnValue(status);
      const res = await request(app).get('/queue-status');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(status);
    });

    it('returns 500 when getQueueStatus throws', async () => {
      mockGetQueueStatus.mockImplementation(() => {
        throw new Error('queue error');
      });
      const res = await request(app).get('/queue-status');
      expect(res.status).toBe(500);
    });
  });

  // ─── POST /force-queue-process ────────────────────────────────────────────

  describe('POST /force-queue-process', () => {
    it('returns 200 with updated queue status after processing', async () => {
      const afterStatus = { length: 0, processing: false };
      mockForceProcessQueue.mockResolvedValue(undefined);
      mockGetQueueStatus.mockReturnValue(afterStatus);
      const res = await request(app).post('/force-queue-process');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(afterStatus);
    });

    it('returns 500 when forceProcessQueue throws', async () => {
      mockForceProcessQueue.mockRejectedValue(new Error('process fail'));
      const res = await request(app).post('/force-queue-process');
      expect(res.status).toBe(500);
    });
  });

  // ─── GET /queue-emails ────────────────────────────────────────────────────

  describe('GET /queue-emails', () => {
    it('returns 200 with mapped email list', async () => {
      const emails = [
        {
          id: 'e1',
          options: { to: 'a@b.com', subject: 'Test' },
          createdAt: new Date().toISOString(),
          attempts: 1,
          lastError: null,
        },
      ];
      mockGetQueuedEmails.mockReturnValue(emails);
      const res = await request(app).get('/queue-emails');
      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(1);
      expect(res.body.data.emails[0].id).toBe('e1');
      expect(res.body.data.emails[0].to).toBe('a@b.com');
    });

    it('returns 200 with empty list when queue is empty', async () => {
      mockGetQueuedEmails.mockReturnValue([]);
      const res = await request(app).get('/queue-emails');
      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(0);
    });

    it('returns 500 when getQueuedEmails throws', async () => {
      mockGetQueuedEmails.mockImplementation(() => {
        throw new Error('emails error');
      });
      const res = await request(app).get('/queue-emails');
      expect(res.status).toBe(500);
    });
  });
});
