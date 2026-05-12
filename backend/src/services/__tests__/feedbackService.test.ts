import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks — Vitest moves these above the imports so the service
// pulls in the test doubles instead of the real prisma client / email
// transport.
vi.mock('../../db/prismaClient', () => ({
  prisma: {
    feedback: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock('../emailService', () => ({
  sendEmail: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createFeedback, FEEDBACK_RECIPIENT } from '../feedbackService';
import { prisma } from '../../db/prismaClient';
import { sendEmail } from '../emailService';
import { logger } from '../../utils/logger';

const mockCreate = prisma.feedback.create as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.feedback.update as unknown as ReturnType<typeof vi.fn>;
const mockSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;
const mockLoggerError = logger.error as unknown as ReturnType<typeof vi.fn>;

const USER_ID = 'user-123';
const USER_EMAIL = 'reporter@example.com';
const BASE_DATA = {
  type: 'bug' as const,
  title: 'Buttons overlap on iPad',
  body: 'When I open the editor on iPad landscape, the save button overlaps the toolbar.',
};

describe('feedbackService.createFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'fb-abc' });
    mockUpdate.mockResolvedValue({});
    mockSendEmail.mockResolvedValue(undefined);
  });

  it('persists the row and queues the notification email', async () => {
    const result = await createFeedback(USER_ID, USER_EMAIL, BASE_DATA);

    expect(result).toEqual({ id: 'fb-abc', emailQueued: true });

    // DB write — note attachmentPath / attachmentMime must be null when
    // no attachment is supplied so the column constraints stay clean.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toEqual({
      data: {
        userId: USER_ID,
        type: 'bug',
        title: BASE_DATA.title,
        body: BASE_DATA.body,
        attachmentPath: null,
        attachmentMime: null,
      },
      select: { id: true },
    });

    // Email send — Reply-To is the submitter so the maintainer can hit
    // reply and respond directly.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe(FEEDBACK_RECIPIENT);
    expect(emailArgs.replyTo).toBe(USER_EMAIL);
    expect(emailArgs.subject).toContain(BASE_DATA.title);
    expect(emailArgs.html).toContain(BASE_DATA.title);
    expect(emailArgs.text).toContain(BASE_DATA.body);
    expect(emailArgs.attachments).toBeUndefined();

    // emailSentAt marker on success
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'fb-abc' },
      data: { emailSentAt: expect.any(Date) },
    });
  });

  it('returns success even when the email send throws (best-effort contract)', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await createFeedback(USER_ID, USER_EMAIL, BASE_DATA);

    // Row persisted, but emailQueued is false and the marker update was
    // never reached — ops can replay by selecting WHERE emailSentAt IS NULL.
    expect(result).toEqual({ id: 'fb-abc', emailQueued: false });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });

  it('forwards the attachment to sendEmail with the correct shape', async () => {
    const attachment = {
      path: '/tmp/feedback/abc.png',
      mime: 'image/png',
      filename: 'screenshot.png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    };

    await createFeedback(USER_ID, USER_EMAIL, BASE_DATA, attachment);

    // DB row stores path + mime so the row alone tells you whether an
    // attachment was sent.
    expect(mockCreate.mock.calls[0][0].data.attachmentPath).toBe(attachment.path);
    expect(mockCreate.mock.calls[0][0].data.attachmentMime).toBe(attachment.mime);

    // Email payload — single attachment, matching contentType + buffer.
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.attachments).toEqual([
      {
        filename: 'screenshot.png',
        content: attachment.buffer,
        contentType: 'image/png',
      },
    ]);
  });

  it("renders 'Feature request' wording for type='feature'", async () => {
    await createFeedback(USER_ID, USER_EMAIL, {
      ...BASE_DATA,
      type: 'feature',
    });
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.subject).toContain('[SpheroSeg feature]');
    expect(emailArgs.html).toContain('Feature request');
  });
});
