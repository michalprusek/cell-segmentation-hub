/**
 * uploadCancelController.gaps5.test.ts
 *
 * Full coverage of UploadCancelController — previously 0% covered:
 *
 *  A. cancelUpload
 *     - no userId → 401 unauthorized
 *     - no uploadId → 400 bad request
 *     - success path → emits WS event, returns 200
 *     - WebSocketService.getInstance throws → 500 internal error
 *
 *  B. cancelAllUploads
 *     - no userId → 401 unauthorized
 *     - no projectId → 400 bad request
 *     - success path → emits WS event, returns 200
 *     - WebSocketService.getInstance throws → 500 internal error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { mockEmitToUser, mockGetInstance } = vi.hoisted(() => ({
  mockEmitToUser: vi.fn(),
  mockGetInstance: vi.fn(),
}));

vi.mock('../../../services/websocketService', () => ({
  WebSocketService: {
    getInstance: mockGetInstance,
  },
}));

vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    unauthorized: vi.fn(),
    badRequest: vi.fn(),
    internalError: vi.fn(),
  },
}));

import { UploadCancelController } from '../uploadCancelController';
import { ResponseHelper } from '../../../utils/response';
import type { AuthRequest } from '../../../types/auth';
import type { Response } from 'express';

const MockResponseHelper = ResponseHelper as {
  unauthorized: ReturnType<typeof vi.fn>;
  badRequest: ReturnType<typeof vi.fn>;
  internalError: ReturnType<typeof vi.fn>;
};

function makeRes(): Response {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    params: {},
    user: { id: 'user-1' },
    ...overrides,
  } as unknown as AuthRequest;
}

let controller: UploadCancelController;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInstance.mockReturnValue({ emitToUser: mockEmitToUser });
  controller = new UploadCancelController();
});

// ─── A. cancelUpload ──────────────────────────────────────────────────────────

describe('UploadCancelController.cancelUpload', () => {
  it('returns 401 when userId is missing', async () => {
    const req = makeReq({ user: undefined, params: { uploadId: 'upload-1' } });
    const res = makeRes();

    await controller.cancelUpload(req, res);
    expect(MockResponseHelper.unauthorized).toHaveBeenCalledWith(
      res,
      'Unauthorized',
      'UploadCancelController'
    );
  });

  it('returns 400 when uploadId is missing', async () => {
    const req = makeReq({ params: {} });
    const res = makeRes();

    await controller.cancelUpload(req, res);
    expect(MockResponseHelper.badRequest).toHaveBeenCalledWith(
      res,
      'Upload ID is required',
      'UploadCancelController'
    );
  });

  it('emits WS event and responds 200 on success', async () => {
    const req = makeReq({ params: { uploadId: 'upload-abc' } });
    const res = makeRes();

    await controller.cancelUpload(req, res);

    expect(mockEmitToUser).toHaveBeenCalledWith(
      'user-1',
      'operation:cancelled',
      expect.objectContaining({
        operationId: 'upload-abc',
        operationType: 'upload',
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, uploadId: 'upload-abc' })
    );
  });

  it('returns 500 when WebSocketService.getInstance throws', async () => {
    mockGetInstance.mockImplementationOnce(() => {
      throw new Error('WS not initialized');
    });
    const req = makeReq({ params: { uploadId: 'upload-abc' } });
    const res = makeRes();

    await controller.cancelUpload(req, res);
    expect(MockResponseHelper.internalError).toHaveBeenCalledWith(
      res,
      expect.any(Error),
      'Failed to cancel upload',
      'UploadCancelController'
    );
  });
});

// ─── B. cancelAllUploads ──────────────────────────────────────────────────────

describe('UploadCancelController.cancelAllUploads', () => {
  it('returns 401 when userId is missing', async () => {
    const req = makeReq({ user: undefined, params: { projectId: 'proj-1' } });
    const res = makeRes();

    await controller.cancelAllUploads(req, res);
    expect(MockResponseHelper.unauthorized).toHaveBeenCalledWith(
      res,
      'Unauthorized',
      'UploadCancelController'
    );
  });

  it('returns 400 when projectId is missing', async () => {
    const req = makeReq({ params: {} });
    const res = makeRes();

    await controller.cancelAllUploads(req, res);
    expect(MockResponseHelper.badRequest).toHaveBeenCalledWith(
      res,
      'Project ID is required',
      'UploadCancelController'
    );
  });

  it('emits WS event and responds 200 on success', async () => {
    const req = makeReq({ params: { projectId: 'proj-123' } });
    const res = makeRes();

    await controller.cancelAllUploads(req, res);

    expect(mockEmitToUser).toHaveBeenCalledWith(
      'user-1',
      'operation:cancelled',
      expect.objectContaining({
        operationId: 'project_proj-123_uploads',
        operationType: 'upload',
        projectId: 'proj-123',
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, projectId: 'proj-123' })
    );
  });

  it('returns 500 when WebSocketService.getInstance throws', async () => {
    mockGetInstance.mockImplementationOnce(() => {
      throw new Error('WS not initialized');
    });
    const req = makeReq({ params: { projectId: 'proj-123' } });
    const res = makeRes();

    await controller.cancelAllUploads(req, res);
    expect(MockResponseHelper.internalError).toHaveBeenCalledWith(
      res,
      expect.any(Error),
      'Failed to cancel all uploads',
      'UploadCancelController'
    );
  });
});
