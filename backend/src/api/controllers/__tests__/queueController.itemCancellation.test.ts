import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { queueController } from '../queueController';
import { QueueService } from '../../../services/queueService';
import { WebSocketService } from '../../../services/websocketService';
import { ResponseHelper } from '../../../utils/response';
import { prisma } from '../../../db';

// Mock dependencies
vi.mock('../../../services/queueService');
vi.mock('../../../services/websocketService');
vi.mock('../../../utils/response');
vi.mock('../../../db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn()
    },
    project: {
      findFirst: vi.fn()
    },
    segmentationQueue: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }
  }
}));

// Mock data
const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User'
};

const mockProject = {
  id: 'project-123',
  name: 'Test Project',
  userId: 'user-123'
};

const mockQueueItemQueued = {
  id: 'queue-1',
  imageId: 'img-1',
  projectId: 'project-123',
  userId: 'user-123',
  status: 'queued',
  batchId: 'batch-123',
  createdAt: new Date(),
  updatedAt: new Date(),
  model: 'hrnet',
  threshold: 0.5,
  priority: 0,
  detectHoles: true,
  startedAt: null,
  completedAt: null,
  error: null,
  retryCount: 0
};

const mockQueueItemProcessing = {
  ...mockQueueItemQueued,
  id: 'queue-2',
  imageId: 'img-2',
  status: 'processing',
  startedAt: new Date()
};

const mockQueueItemCompleted = {
  ...mockQueueItemQueued,
  id: 'queue-3',
  imageId: 'img-3',
  status: 'completed',
  startedAt: new Date(),
  completedAt: new Date()
};

const createMockRequest = (params: any = {}, body: any = {}, user: any = mockUser): Request => ({
  params,
  body,
  user,
  headers: {},
  method: 'DELETE',
  url: '',
  get: vi.fn(),
  header: vi.fn(),
  accepts: vi.fn(),
  acceptsCharsets: vi.fn(),
  acceptsEncodings: vi.fn(),
  acceptsLanguages: vi.fn(),
  range: vi.fn(),
  param: vi.fn(),
  is: vi.fn(),
  query: {},
  route: {},
  cookies: {},
  signedCookies: {},
  originalUrl: '',
  baseUrl: '',
  path: '',
  hostname: '',
  ip: '',
  ips: [],
  protocol: 'http',
  secure: false,
  fresh: false,
  stale: false,
  xhr: false,
  locals: {},
  app: {} as any,
  complete: false,
  connection: {} as any,
  socket: {} as any,
  destroy: vi.fn(),
  readable: false,
  readableAborted: false,
  readableDidRead: false,
  readableEncoding: null,
  readableEnded: false,
  readableFlowing: null,
  readableHighWaterMark: 0,
  readableLength: 0,
  readableObjectMode: false,
  destroyed: false,
  closed: false,
  errored: null,
  _events: {},
  _eventsCount: 0,
  _maxListeners: 0,
  _read: vi.fn(),
  read: vi.fn(),
  setEncoding: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  isPaused: vi.fn(),
  unpipe: vi.fn(),
  unshift: vi.fn(),
  wrap: vi.fn(),
  push: vi.fn(),
  _destroy: vi.fn(),
  _undestroy: vi.fn(),
  _construct: vi.fn(),
  addListener: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
  off: vi.fn(),
  removeAllListeners: vi.fn(),
  setMaxListeners: vi.fn(),
  getMaxListeners: vi.fn(),
  listeners: vi.fn(),
  rawListeners: vi.fn(),
  emit: vi.fn(),
  listenerCount: vi.fn(),
  prependListener: vi.fn(),
  prependOnceListener: vi.fn(),
  eventNames: vi.fn(),
  pipe: vi.fn(),
  unpipe: vi.fn(),
  cork: vi.fn(),
  uncork: vi.fn(),
  destroy: vi.fn(),
  _undestroy: vi.fn(),
  append: vi.fn(),
  attachment: vi.fn(),
  cookie: vi.fn(),
  clearCookie: vi.fn(),
  download: vi.fn(),
  format: vi.fn(),
  get: vi.fn(),
  header: vi.fn(),
  links: vi.fn(),
  location: vi.fn(),
  redirect: vi.fn(),
  render: vi.fn(),
  sendFile: vi.fn(),
  sendStatus: vi.fn(),
  set: vi.fn(),
  type: vi.fn(),
  vary: vi.fn(),
  req: {} as any,
  chunkedEncoding: false,
  shouldKeepAlive: false,
  useChunkedEncodingByDefault: false,
  sendDate: false,
  app: {} as any
} as Request);

const createMockResponse = (): Response => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    removeHeader: vi.fn().mockReturnThis(),
    write: vi.fn(),
    writeHead: vi.fn().mockReturnThis(),
    locals: {},
    headersSent: false,
    statusCode: 200,
    statusMessage: '',
    socket: {} as any,
    connection: {} as any,
    finished: false,
    destroyed: false,
    writableEnded: false,
    writableFinished: false,
    writableHighWaterMark: 0,
    writableLength: 0,
    writableObjectMode: false,
    writableCorked: 0,
    closed: false,
    errored: null,
    _events: {},
    _eventsCount: 0,
    _maxListeners: 0,
    _write: vi.fn(),
    _writev: vi.fn(),
    _destroy: vi.fn(),
    _final: vi.fn(),
    _construct: vi.fn(),
    addListener: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    setMaxListeners: vi.fn(),
    getMaxListeners: vi.fn(),
    listeners: vi.fn(),
    rawListeners: vi.fn(),
    emit: vi.fn(),
    listenerCount: vi.fn(),
    prependListener: vi.fn(),
    prependOnceListener: vi.fn(),
    eventNames: vi.fn(),
    pipe: vi.fn(),
    unpipe: vi.fn(),
    cork: vi.fn(),
    uncork: vi.fn(),
    destroy: vi.fn(),
    _undestroy: vi.fn(),
    append: vi.fn(),
    attachment: vi.fn(),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    download: vi.fn(),
    format: vi.fn(),
    get: vi.fn(),
    header: vi.fn(),
    links: vi.fn(),
    location: vi.fn(),
    redirect: vi.fn(),
    render: vi.fn(),
    sendFile: vi.fn(),
    sendStatus: vi.fn(),
    set: vi.fn(),
    type: vi.fn(),
    vary: vi.fn(),
    req: {} as any,
    chunkedEncoding: false,
    shouldKeepAlive: false,
    useChunkedEncodingByDefault: false,
    sendDate: false,
    app: {} as any
  } as Response;
  return res;
};

describe('QueueController Individual Item Cancellation', () => {
  let mockQueueService: any;
  let mockWebSocketService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup QueueService mock
    mockQueueService = {
      removeFromQueueWithItem: vi.fn(),
      getQueueStats: vi.fn()
    };
    vi.mocked(QueueService.getInstance).mockReturnValue(mockQueueService);

    // Setup WebSocketService mock
    mockWebSocketService = {
      emitSegmentationUpdate: vi.fn(),
      emitQueueStatsUpdate: vi.fn()
    };
    vi.mocked(WebSocketService.getInstance).mockReturnValue(mockWebSocketService);

    // Setup default database mocks
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.findFirst).mockResolvedValue(mockProject);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('DELETE /api/queue/items/:queueId - Success Cases', () => {
    it('should successfully cancel queued item', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);
      mockQueueService.removeFromQueueWithItem.mockResolvedValue(undefined);
      mockQueueService.getQueueStats.mockResolvedValue({ queued: 0, processing: 0, total: 0 });

      await queueController.removeFromQueue(req, res);

      expect(prisma.segmentationQueue.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'queue-1',
          userId: 'user-123'
        }
      });
      expect(mockQueueService.removeFromQueueWithItem).toHaveBeenCalledWith('queue-1', 'user-123', mockQueueItemQueued);
      expect(mockWebSocketService.emitSegmentationUpdate).toHaveBeenCalledWith('user-123', {
        imageId: 'img-1',
        projectId: 'project-123',
        status: 'no_segmentation'
      });
      expect(mockWebSocketService.emitQueueStatsUpdate).toHaveBeenCalledWith('project-123', {
        projectId: 'project-123',
        queued: 0,
        processing: 0,
        total: 0
      });
      expect(ResponseHelper.success).toHaveBeenCalledWith(res, undefined, 'Položka odebrána z fronty');
    });

    it('should emit correct WebSocket events after successful cancellation', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);
      mockQueueService.removeFromQueueWithItem.mockResolvedValue(undefined);
      mockQueueService.getQueueStats.mockResolvedValue({ queued: 2, processing: 1, total: 3 });

      await queueController.removeFromQueue(req, res);

      // Verify segmentation update is emitted first
      expect(mockWebSocketService.emitSegmentationUpdate).toHaveBeenCalledBefore(
        mockWebSocketService.emitQueueStatsUpdate as any
      );

      // Verify correct data structure
      const segmentationCall = mockWebSocketService.emitSegmentationUpdate.mock.calls[0];
      expect(segmentationCall[0]).toBe('user-123');
      expect(segmentationCall[1]).toEqual({
        imageId: 'img-1',
        projectId: 'project-123',
        status: 'no_segmentation'
      });

      const statsCall = mockWebSocketService.emitQueueStatsUpdate.mock.calls[0];
      expect(statsCall[0]).toBe('project-123');
      expect(statsCall[1]).toEqual({
        projectId: 'project-123',
        queued: 2,
        processing: 1,
        total: 3
      });
    });
  });

  describe('DELETE /api/queue/items/:queueId - Business Rule Validation', () => {
    it('should reject cancellation of processing item with 409 Conflict', async () => {
      const req = createMockRequest({ queueId: 'queue-2' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemProcessing);

      // Mock service to throw business rule error for processing items
      const businessError = new Error('Cannot cancel item in processing status');
      businessError.name = 'BusinessRuleError';
      (businessError as any).statusCode = 409;
      mockQueueService.removeFromQueueWithItem.mockRejectedValue(businessError);

      await queueController.removeFromQueue(req, res);

      expect(mockQueueService.removeFromQueueWithItem).toHaveBeenCalledWith('queue-2', 'user-123', mockQueueItemProcessing);
      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        res,
        businessError,
        'Chyba při odebírání z fronty'
      );

      // Should not emit WebSocket events on failure
      expect(mockWebSocketService.emitSegmentationUpdate).not.toHaveBeenCalled();
      expect(mockWebSocketService.emitQueueStatsUpdate).not.toHaveBeenCalled();
    });

    it('should reject cancellation of completed item', async () => {
      const req = createMockRequest({ queueId: 'queue-3' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemCompleted);

      const businessError = new Error('Cannot cancel completed item');
      businessError.name = 'BusinessRuleError';
      (businessError as any).statusCode = 409;
      mockQueueService.removeFromQueueWithItem.mockRejectedValue(businessError);

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        res,
        businessError,
        'Chyba při odebírání z fronty'
      );
    });

    it('should validate item ownership before cancellation', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      // Mock item owned by different user
      const otherUserItem = { ...mockQueueItemQueued, userId: 'other-user-123' };
      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(null); // No item found for current user

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(res, 'Položka fronty nenalezena');
      expect(mockQueueService.removeFromQueueWithItem).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/queue/items/:queueId - Error Handling', () => {
    it('should handle missing queue ID parameter', async () => {
      const req = createMockRequest({ queueId: '' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(null);

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.badRequest).toHaveBeenCalledWith(res, 'Queue ID is required');
    });

    it('should handle database errors gracefully', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      const dbError = new Error('Database connection failed');
      vi.mocked(prisma.segmentationQueue.findFirst).mockRejectedValue(dbError);

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        res,
        dbError,
        'Chyba při odebírání z fronty'
      );
    });

    it('should handle service layer errors', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);

      const serviceError = new Error('Queue service error');
      mockQueueService.removeFromQueueWithItem.mockRejectedValue(serviceError);

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        res,
        serviceError,
        'Chyba při odebírání z fronty'
      );
    });

    it('should handle WebSocket errors without failing request', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);
      mockQueueService.removeFromQueueWithItem.mockResolvedValue(undefined);
      mockQueueService.getQueueStats.mockResolvedValue({ queued: 0, processing: 0, total: 0 });

      // Mock WebSocket to throw error
      mockWebSocketService.emitSegmentationUpdate.mockImplementation(() => {
        throw new Error('WebSocket connection failed');
      });

      await queueController.removeFromQueue(req, res);

      // Request should still succeed despite WebSocket error
      expect(ResponseHelper.success).toHaveBeenCalledWith(res, undefined, 'Položka odebrána z fronty');
    });

    it('should handle queue stats fetch errors gracefully', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);
      mockQueueService.removeFromQueueWithItem.mockResolvedValue(undefined);
      mockQueueService.getQueueStats.mockRejectedValue(new Error('Stats service error'));

      await queueController.removeFromQueue(req, res);

      // Should still complete successfully
      expect(ResponseHelper.success).toHaveBeenCalledWith(res, undefined, 'Položka odebrána z fronty');
      expect(mockWebSocketService.emitSegmentationUpdate).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/queue/items/:queueId - Authentication & Authorization', () => {
    it('should require user authentication', async () => {
      const req = createMockRequest({ queueId: 'queue-1' }, {}, null);
      const res = createMockResponse();

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(res, 'User authentication required');
      expect(prisma.segmentationQueue.findFirst).not.toHaveBeenCalled();
    });

    it('should require valid user ID', async () => {
      const req = createMockRequest({ queueId: 'queue-1' }, {}, { email: 'test@example.com' }); // Missing id
      const res = createMockResponse();

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(res, 'User authentication required');
    });

    it('should enforce user-scoped queue access', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(null); // No item for this user

      await queueController.removeFromQueue(req, res);

      expect(prisma.segmentationQueue.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'queue-1',
          userId: 'user-123' // Should include userId filter
        }
      });
      expect(ResponseHelper.notFound).toHaveBeenCalledWith(res, 'Položka fronty nenalezena');
    });
  });

  describe('DELETE /api/queue/items/:queueId - Performance & Race Conditions', () => {
    it('should handle concurrent cancellation attempts', async () => {
      const req1 = createMockRequest({ queueId: 'queue-1' });
      const req2 = createMockRequest({ queueId: 'queue-1' });
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst)
        .mockResolvedValueOnce(mockQueueItemQueued) // First request finds item
        .mockResolvedValueOnce(null); // Second request finds nothing (already removed)

      mockQueueService.removeFromQueueWithItem.mockResolvedValue(undefined);
      mockQueueService.getQueueStats.mockResolvedValue({ queued: 0, processing: 0, total: 0 });

      await Promise.all([
        queueController.removeFromQueue(req1, res1),
        queueController.removeFromQueue(req2, res2)
      ]);

      // First should succeed
      expect(ResponseHelper.success).toHaveBeenCalledWith(res1, undefined, 'Položka odebrána z fronty');
      // Second should fail gracefully
      expect(ResponseHelper.notFound).toHaveBeenCalledWith(res2, 'Položka fronty nenalezena');
    });

    it('should handle item status change during cancellation', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);

      // Mock service to simulate item status change during removal
      const raceConditionError = new Error('Item status changed during removal');
      raceConditionError.name = 'RaceConditionError';
      mockQueueService.removeFromQueueWithItem.mockRejectedValue(raceConditionError);

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        res,
        raceConditionError,
        'Chyba při odebírání z fronty'
      );
    });

    it('should complete cancellation within reasonable time', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);
      mockQueueService.removeFromQueueWithItem.mockResolvedValue(undefined);
      mockQueueService.getQueueStats.mockResolvedValue({ queued: 0, processing: 0, total: 0 });

      const startTime = Date.now();
      await queueController.removeFromQueue(req, res);
      const endTime = Date.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('DELETE /api/queue/items/:queueId - Transaction Safety', () => {
    it('should not emit WebSocket events if cancellation fails', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);
      mockQueueService.removeFromQueueWithItem.mockRejectedValue(new Error('Removal failed'));

      await queueController.removeFromQueue(req, res);

      expect(mockWebSocketService.emitSegmentationUpdate).not.toHaveBeenCalled();
      expect(mockWebSocketService.emitQueueStatsUpdate).not.toHaveBeenCalled();
    });

    it('should maintain data consistency on partial failures', async () => {
      const req = createMockRequest({ queueId: 'queue-1' });
      const res = createMockResponse();

      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(mockQueueItemQueued);
      mockQueueService.removeFromQueueWithItem.mockResolvedValue(undefined);

      // Stats fetch fails, but item was already removed
      mockQueueService.getQueueStats.mockRejectedValue(new Error('Stats error'));

      await queueController.removeFromQueue(req, res);

      // Should still report success and emit segmentation update
      expect(ResponseHelper.success).toHaveBeenCalledWith(res, undefined, 'Položka odebrána z fronty');
      expect(mockWebSocketService.emitSegmentationUpdate).toHaveBeenCalled();
      // Stats update should not be called due to error
      expect(mockWebSocketService.emitQueueStatsUpdate).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/queue/items/:queueId - Input Validation', () => {
    it('should validate UUID format of queue ID', async () => {
      const req = createMockRequest({ queueId: 'invalid-uuid' });
      const res = createMockResponse();

      // This validation is typically handled by express-validator middleware
      // But we test the controller behavior with invalid input
      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(null);

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(res, 'Položka fronty nenalezena');
    });

    it('should handle null queue ID parameter', async () => {
      const req = createMockRequest({ queueId: null });
      const res = createMockResponse();

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.badRequest).toHaveBeenCalledWith(res, 'Queue ID is required');
    });

    it('should handle undefined queue ID parameter', async () => {
      const req = createMockRequest({ queueId: undefined });
      const res = createMockResponse();

      await queueController.removeFromQueue(req, res);

      expect(ResponseHelper.badRequest).toHaveBeenCalledWith(res, 'Queue ID is required');
    });
  });
});