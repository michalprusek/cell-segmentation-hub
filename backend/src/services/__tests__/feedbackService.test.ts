import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks — Vitest moves these above the imports so the service
// pulls in the test doubles instead of the real prisma client / email
// transport / filesystem / config.
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
vi.mock('../../utils/config', () => ({
  config: { UPLOAD_DIR: '/app/uploads' },
}));
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

import { createFeedback, FEEDBACK_RECIPIENT } from '../feedbackService';
import { prisma } from '../../db/prismaClient';
import { sendEmail } from '../emailService';
import { logger } from '../../utils/logger';
import { promises as fs } from 'fs';

const mockCreate = prisma.feedback.create as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.feedback.update as unknown as ReturnType<typeof vi.fn>;
const mockSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;
const mockLoggerError = logger.error as unknown as ReturnType<typeof vi.fn>;
const mockRename = fs.rename as unknown as ReturnType<typeof vi.fn>;
const mockMkdir = fs.mkdir as unknown as ReturnType<typeof vi.fn>;

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
    mockRename.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('persists the row and queues the notification email', async () => {
    const result = await createFeedback(USER_ID, USER_EMAIL, BASE_DATA);

    expect(result).toEqual({ id: 'fb-abc', emailQueued: true });

    // DB write — attachmentPath / attachmentMime are null when no attachment
    // is supplied so the column constraints stay clean.
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

    // emailSentAt marker on success — the only update when there's no file.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
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

  it('stores a small image on disk and inlines it into the email', async () => {
    const attachment = {
      stagedPath: '/app/uploads/feedback/_staging/abc.png',
      mime: 'image/png',
      filename: 'screenshot.png',
      sizeBytes: 4,
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    };

    await createFeedback(USER_ID, USER_EMAIL, BASE_DATA, attachment);

    // Row is created with mime upfront but no path (id not known yet)...
    expect(mockCreate.mock.calls[0][0].data.attachmentPath).toBeNull();
    expect(mockCreate.mock.calls[0][0].data.attachmentMime).toBe('image/png');

    // ...then the staged file is moved into feedback/<id>/ and the path is
    // patched onto the row as a storage key relative to the uploads root.
    expect(mockRename).toHaveBeenCalledWith(
      attachment.stagedPath,
      '/app/uploads/feedback/fb-abc/screenshot.png'
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'fb-abc' },
      data: { attachmentPath: 'feedback/fb-abc/screenshot.png' },
    });

    // Small image → inlined into the email with matching contentType + buffer.
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.attachments).toEqual([
      {
        filename: 'screenshot.png',
        content: attachment.buffer,
        contentType: 'image/png',
      },
    ]);
  });

  it('stores a large video on disk but does NOT email it inline', async () => {
    const attachment = {
      stagedPath: '/app/uploads/feedback/_staging/xyz.nd2',
      mime: 'application/octet-stream',
      filename: 'WellD03.nd2',
      sizeBytes: 12 * 1024 * 1024 * 1024, // 12 GB
      buffer: undefined, // controller never reads large files into memory
    };

    await createFeedback(USER_ID, USER_EMAIL, BASE_DATA, attachment);

    expect(mockRename).toHaveBeenCalledWith(
      attachment.stagedPath,
      '/app/uploads/feedback/fb-abc/WellD03.nd2'
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'fb-abc' },
      data: { attachmentPath: 'feedback/fb-abc/WellD03.nd2' },
    });

    // No inline attachment — SMTP can't carry 12 GB; the email references
    // the server path instead.
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.attachments).toBeUndefined();
    expect(emailArgs.text).toContain('WellD03.nd2');
    expect(emailArgs.text).toContain('/app/uploads/feedback/fb-abc/WellD03.nd2');
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
