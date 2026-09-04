/**
 * segmentationController.gaps5.test.ts
 *
 * Covers branches still uncovered after segmentationController.test.ts:
 *
 *  A. validateParams (private) — missing required param → 400
 *  B. getSegmentationResults — missing imageId → 400
 *  C. updateSegmentationResults — validateParams triggers → 400
 *  D. deleteSegmentationResults — validateParams triggers → 400
 *  E. batchGetSegmentationResults — >1000 images → 400
 *  F. batchProcess — error catch → 500
 *  G. batchGetSegmentationResults — error catch → 500
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/segmentationService');
vi.mock('../../../services/imageService');
vi.mock('../../../utils/logger');
vi.mock('../../../db');
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long-for-test',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
  },
}));

const { mockRH } = vi.hoisted(() => ({
  mockRH: {
    success: vi.fn(),
    badRequest: vi.fn(),
    validationError: vi.fn(),
    internalError: vi.fn(),
    unauthorized: vi.fn(),
    notFound: vi.fn(),
  },
}));

vi.mock('../../../utils/response', () => ({
  ResponseHelper: mockRH,
  asyncHandler: (fn: unknown) => fn,
}));

import { SegmentationService } from '../../../services/segmentationService';
import { segmentationController } from '../segmentationController';

const MockSegService = SegmentationService as unknown as ReturnType<
  typeof vi.fn
>;

const mockUser = { id: 'user-1', email: 'u@test.com', emailVerified: true };

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as never;
}

function makeReq(
  params: Record<string, string> = {},
  user: typeof mockUser | undefined = mockUser,
  body: Record<string, unknown> = {}
) {
  return { params, user, body } as never;
}

/**
 * The SegmentationService instance the controller actually calls.
 *
 * `segmentationController` is a module-level singleton, so its
 * `segmentationService` was constructed when this file imported the module —
 * before any `beforeEach` ran. Programming the constructor mock therefore does
 * nothing to it; the instance has to be reached through the controller.
 *
 * This used to be an `if (segSvc?.batchProcess) { ... }` around the setup and
 * an `expect(true).toBe(true)` for the assertion, which passed whether or not
 * the mock was ever installed. It throws now, so a controller that stops
 * holding a service fails loudly instead of silently testing nothing.
 */
function liveService(): Record<string, ReturnType<typeof vi.fn>> {
  const svc = (
    segmentationController as unknown as {
      segmentationService?: Record<string, ReturnType<typeof vi.fn>>;
    }
  ).segmentationService;
  if (!svc?.batchProcess || !svc?.getBatchSegmentationResults) {
    throw new Error(
      'segmentationController.segmentationService is not the mocked service'
    );
  }
  return svc;
}

beforeEach(() => {
  vi.clearAllMocks();
  MockSegService.mockImplementation(function (this: Record<string, unknown>) {
    this.getSegmentationResults = vi.fn().mockResolvedValue(null);
    this.updateSegmentationResults = vi.fn().mockResolvedValue({});
    this.deleteSegmentationResults = vi.fn().mockResolvedValue(undefined);
    this.getBatchSegmentationResults = vi.fn().mockResolvedValue([]);
    this.batchProcess = vi
      .fn()
      .mockResolvedValue({ successful: 0, failed: 0, results: [] });
  });
});

// ─── B. getSegmentationResults — missing imageId ──────────────────────────────

describe('segmentationController.getSegmentationResults', () => {
  it('returns 400 when imageId is missing', async () => {
    const req = makeReq({}, mockUser);
    const res = makeRes();

    await segmentationController.getSegmentationResults(req, res);
    expect(mockRH.badRequest).toHaveBeenCalledWith(res, 'Image ID is required');
  });
});

// ─── C. updateSegmentationResults — validateParams triggers ──────────────────

describe('segmentationController.updateSegmentationResults', () => {
  it('returns validation error when imageId is missing', async () => {
    const req = makeReq({}, mockUser, { polygons: [] });
    const res = makeRes();

    await segmentationController.updateSegmentationResults(req, res);
    expect(mockRH.validationError).toHaveBeenCalledWith(
      res,
      'Missing required parameter: imageId'
    );
  });
});

// ─── D. deleteSegmentationResults — validateParams triggers ──────────────────

describe('segmentationController.deleteSegmentationResults', () => {
  it('returns validation error when imageId is missing', async () => {
    const req = makeReq({}, mockUser);
    const res = makeRes();

    await segmentationController.deleteSegmentationResults(req, res);
    expect(mockRH.validationError).toHaveBeenCalledWith(
      res,
      'Missing required parameter: imageId'
    );
  });
});

// ─── E. batchGetSegmentationResults — >1000 images ────────────────────────────

describe('segmentationController.batchGetSegmentationResults', () => {
  it('returns 400 when more than 1000 imageIds provided', async () => {
    const imageIds = Array.from({ length: 1001 }, (_, i) => `img-${i}`);
    const req = makeReq({}, mockUser, { imageIds });
    const res = makeRes();

    await segmentationController.batchGetSegmentationResults(req, res);
    expect(mockRH.validationError).toHaveBeenCalledWith(
      res,
      'Maximum 1000 images per batch request'
    );
  });

  it('reports the service failure as a 500 and returns no results', async () => {
    const boom = new Error('DB error');
    liveService().getBatchSegmentationResults.mockRejectedValueOnce(boom);

    const req = makeReq({}, mockUser, { imageIds: ['img-1'] });
    const res = makeRes();

    await segmentationController.batchGetSegmentationResults(req, res);

    expect(mockRH.internalError).toHaveBeenCalledWith(res, boom, 'DB error');
    expect(mockRH.success).not.toHaveBeenCalled();
  });
});

// ─── F. batchSegment — error catch ───────────────────────────────────────────

describe('segmentationController.batchSegment', () => {
  it('reports the ML failure as a 500 and does not report success', async () => {
    const boom = new Error('ML error');
    liveService().batchProcess.mockRejectedValueOnce(boom);

    const req = makeReq({}, mockUser, {
      imageIds: ['img-1', 'img-2'],
      model: 'hrnet',
      threshold: 0.5,
    });
    const res = makeRes();

    await segmentationController.batchSegment(req, res);

    expect(mockRH.internalError).toHaveBeenCalledWith(res, boom, 'ML error');
    expect(mockRH.success).not.toHaveBeenCalled();
  });

  it('enqueues and reports success when the service resolves', async () => {
    const outcome = { successful: 2, failed: 0, results: [] };
    liveService().batchProcess.mockResolvedValueOnce(outcome);

    const req = makeReq({}, mockUser, {
      imageIds: ['img-1', 'img-2'],
      model: 'hrnet',
      threshold: 0.5,
    });
    const res = makeRes();

    await segmentationController.batchSegment(req, res);

    // The happy path is what makes the failure test above mean something:
    // without it, a controller that never called the service at all would
    // satisfy "internalError was called" just as well.
    expect(liveService().batchProcess).toHaveBeenCalledWith(
      ['img-1', 'img-2'],
      'hrnet',
      0.5,
      mockUser.id,
      true, // detectHoles defaults on
      undefined // no channel override
    );
    expect(mockRH.success).toHaveBeenCalledWith(
      res,
      outcome,
      'Dávkové zpracování dokončeno'
    );
    expect(mockRH.internalError).not.toHaveBeenCalled();
  });
});
