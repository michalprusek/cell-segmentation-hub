/**
 * feedbackController.gaps5.test.ts
 *
 * Full coverage of feedbackController.ts — previously 0% covered:
 *
 *  A. createFeedback
 *     - no user → 401
 *     - no file → success (no attachment)
 *     - small image file → reads buffer into memory, creates feedback
 *     - large/non-image file → no buffer read, creates feedback as link-only
 *     - small image read fails → warns, still creates feedback without buffer
 *     - finally: staged file unlinked after success
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFsReadFile, mockFsUnlink } = vi.hoisted(() => ({
  mockFsReadFile: vi.fn(),
  mockFsUnlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  promises: {
    readFile: mockFsReadFile,
    unlink: mockFsUnlink,
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockCreateFeedback } = vi.hoisted(() => ({
  mockCreateFeedback: vi.fn(),
}));
vi.mock('../../../services/feedbackService', () => ({
  createFeedback: mockCreateFeedback,
  FEEDBACK_INLINE_EMAIL_MAX_BYTES: 5 * 1024 * 1024, // 5 MB
}));

vi.mock('../../../utils/response', () => ({
  asyncHandler: (fn: unknown) => fn,
  ResponseHelper: {
    success: vi.fn(),
    unauthorized: vi.fn(),
    internalError: vi.fn(),
  },
}));

import { createFeedback } from '../feedbackController';
import { ResponseHelper } from '../../../utils/response';

const RH = ResponseHelper as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as never;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'user-1', email: 'u@test.com', emailVerified: true },
    body: { type: 'bug', title: 'Bug report', body: 'Details' },
    file: undefined,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateFeedback.mockResolvedValue({
    id: 'fb-1',
    emailQueued: true,
    attachmentStored: false,
  });
});

describe('createFeedback', () => {
  it('returns 401 when no user', async () => {
    const req = makeReq({ user: undefined });
    const res = makeRes();

    await (createFeedback as Function)(req, res);
    expect(RH.unauthorized).toHaveBeenCalled();
  });

  it('success without file attachment', async () => {
    const req = makeReq({ file: undefined });
    const res = makeRes();

    await (createFeedback as Function)(req, res);

    expect(mockCreateFeedback).toHaveBeenCalledWith(
      'user-1',
      'u@test.com',
      expect.objectContaining({ type: 'bug' }),
      undefined
    );
    expect(RH.success).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ id: 'fb-1', emailQueued: true }),
      'Feedback submitted',
      201
    );
  });

  it('reads buffer for small inline image (PNG, <= 5MB)', async () => {
    const fakeBuf = Buffer.from('fake-png');
    mockFsReadFile.mockResolvedValueOnce(fakeBuf);

    const req = makeReq({
      file: {
        path: '/tmp/staged/image.png',
        size: 100 * 1024, // 100 KB (small)
        mimetype: 'image/png',
        originalname: 'screenshot.png',
      },
    });
    const res = makeRes();

    await (createFeedback as Function)(req, res);

    expect(mockFsReadFile).toHaveBeenCalledWith('/tmp/staged/image.png');
    expect(mockCreateFeedback).toHaveBeenCalledWith(
      'user-1',
      'u@test.com',
      expect.any(Object),
      expect.objectContaining({ buffer: fakeBuf, mime: 'image/png' })
    );
    expect(mockFsUnlink).toHaveBeenCalledWith('/tmp/staged/image.png');
  });

  it('skips buffer read for large file (> 5MB), still creates feedback', async () => {
    const req = makeReq({
      file: {
        path: '/tmp/staged/video.mp4',
        size: 50 * 1024 * 1024, // 50 MB (large)
        mimetype: 'video/mp4',
        originalname: 'video.mp4',
      },
    });
    const res = makeRes();

    await (createFeedback as Function)(req, res);

    // No readFile call for large files
    expect(mockFsReadFile).not.toHaveBeenCalled();
    expect(mockCreateFeedback).toHaveBeenCalledWith(
      'user-1',
      'u@test.com',
      expect.any(Object),
      expect.objectContaining({ mime: 'video/mp4', buffer: undefined })
    );
  });

  it('warns but continues when small image readFile fails', async () => {
    mockFsReadFile.mockRejectedValueOnce(new Error('Permission denied'));

    const req = makeReq({
      file: {
        path: '/tmp/staged/image.jpeg',
        size: 200 * 1024, // 200 KB
        mimetype: 'image/jpeg',
        originalname: 'photo.jpg',
      },
    });
    const res = makeRes();

    await (createFeedback as Function)(req, res);

    // Should still create feedback (without buffer)
    expect(mockCreateFeedback).toHaveBeenCalledWith(
      'user-1',
      'u@test.com',
      expect.any(Object),
      expect.objectContaining({ buffer: undefined })
    );
    expect(RH.success).toHaveBeenCalled();
  });

  it('unlinks staged file in finally block after success', async () => {
    const req = makeReq({
      file: {
        path: '/tmp/staged/test.png',
        size: 100,
        mimetype: 'image/png',
        originalname: 'test.png',
      },
    });
    mockFsReadFile.mockResolvedValueOnce(Buffer.from('data'));
    const res = makeRes();

    await (createFeedback as Function)(req, res);
    expect(mockFsUnlink).toHaveBeenCalledWith('/tmp/staged/test.png');
  });
});
