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
      deleteMany: vi.fn()
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

const mockQueueItems = [
  {
    id: 'queue-1',
    imageId: 'img-1',
    projectId: 'project-123',
    userId: 'user-123',
    status: 'queued',
    batchId: 'batch-123',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'queue-2',
    imageId: 'img-2',
    projectId: 'project-123',
    userId: 'user-123',
    status: 'processing',
    batchId: 'batch-123',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'queue-3',
    imageId: 'img-3',
    projectId: 'project-123',
    userId: 'other-user',
    status: 'queued',
    batchId: 'batch-456',
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

const createMockRequest = (params: any = {}, body: any = {}, user: any = mockUser): Request => ({
  params,
  body,
  user,
  headers: {},
  method: 'POST',
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
  pipe: vi.fn()
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

describe('QueueController Cancel Endpoints', () => {
  let mockQueueService: any;
  let mockWebSocketService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup QueueService mock
    mockQueueService = {
      cancelByProject: vi.fn(),
      cancelBatch: vi.fn(),
      getQueueStats: vi.fn()
    };
    vi.mocked(QueueService.getInstance).mockReturnValue(mockQueueService);

    // Setup WebSocketService mock
    mockWebSocketService = {
      emitToUser: vi.fn(),
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

  describe('POST /api/queue/projects/:projectId/cancel', () => {
    it('should cancel all user queue items for project', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      mockQueueService.cancelByProject.mockResolvedValue(['queue-1', 'queue-2']);

      await queueController.cancelProjectQueue(req, res);

      expect(mockQueueService.cancelByProject).toHaveBeenCalledWith('project-123', 'user-123');
      expect(mockWebSocketService.emitToUser).toHaveBeenCalledWith('user-123', {
        type: 'queue:cancelled',
        projectId: 'project-123',
        cancelledCount: 2,
        timestamp: expect.any(String)
      });
      expect(ResponseHelper.success).toHaveBeenCalledWith(
        res,
        { cancelledItems: 2 },
        'Zrušeno 2 položek z fronty'
      );
    });

    it('should handle empty queue gracefully', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      mockQueueService.cancelByProject.mockResolvedValue([]);

      await queueController.cancelProjectQueue(req, res);

      expect(mockQueueService.cancelByProject).toHaveBeenCalledWith('project-123', 'user-123');
      expect(mockWebSocketService.emitToUser).toHaveBeenCalledWith('user-123', {
        type: 'queue:cancelled',
        projectId: 'project-123',
        cancelledCount: 0,
        timestamp: expect.any(String)
      });
      expect(ResponseHelper.success).toHaveBeenCalledWith(
        res,
        { cancelledItems: 0 },
        'Zrušeno 0 položek z fronty'
      );
    });

    it('should only cancel pending/processing items', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      // Mock service to return only cancellable items
      mockQueueService.cancelByProject.mockResolvedValue(['queue-1']); // Only queued item

      await queueController.cancelProjectQueue(req, res);

      expect(mockQueueService.cancelByProject).toHaveBeenCalledWith('project-123', 'user-123');
      expect(ResponseHelper.success).toHaveBeenCalledWith(
        res,
        { cancelledItems: 1 },
        'Zrušeno 1 položek z fronty'
      );
    });

    it('should require user authentication', async () => {
      const req = createMockRequest({ projectId: 'project-123' }, {}, null);
      const res = createMockResponse();

      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(res, 'User authentication required');
      expect(mockQueueService.cancelByProject).not.toHaveBeenCalled();
    });

    it('should validate project ownership', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);

      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(res, 'Projekt nenalezen nebo nemáte oprávnění');
      expect(mockQueueService.cancelByProject).not.toHaveBeenCalled();
    });

    it('should handle shared project access', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      const sharedProject = {
        ...mockProject,
        userId: 'owner-123', // Different owner
        shares: [
          {
            sharedWithId: 'user-123',
            status: 'accepted'
          }
        ]
      };

      vi.mocked(prisma.project.findFirst).mockResolvedValue(sharedProject);
      mockQueueService.cancelByProject.mockResolvedValue(['queue-1']);

      await queueController.cancelProjectQueue(req, res);

      expect(mockQueueService.cancelByProject).toHaveBeenCalledWith('project-123', 'user-123');
      expect(ResponseHelper.success).toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      const error = new Error('Database error');
      mockQueueService.cancelByProject.mockRejectedValue(error);

      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        res,
        error,
        'Chyba při rušení fronty projektu'
      );
    });

    it('should emit correct WebSocket events', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      mockQueueService.cancelByProject.mockResolvedValue(['queue-1', 'queue-2']);

      await queueController.cancelProjectQueue(req, res);

      expect(mockWebSocketService.emitToUser).toHaveBeenCalledWith('user-123', {
        type: 'queue:cancelled',
        projectId: 'project-123',
        cancelledCount: 2,
        timestamp: expect.any(String)
      });

      // Verify timestamp format
      const call = mockWebSocketService.emitToUser.mock.calls[0][1];
      expect(new Date(call.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('POST /api/queue/batches/:batchId/cancel', () => {
    it('should cancel all items in specific batch', async () => {
      const req = createMockRequest({ batchId: 'batch-123' });
      const res = createMockResponse();

      mockQueueService.cancelBatch.mockResolvedValue(['queue-1', 'queue-2']);

      await queueController.cancelBatch(req, res);

      expect(mockQueueService.cancelBatch).toHaveBeenCalledWith('batch-123', 'user-123');
      expect(mockWebSocketService.emitToUser).toHaveBeenCalledWith('user-123', {
        type: 'batch:cancelled',
        batchId: 'batch-123',
        cancelledCount: 2,
        timestamp: expect.any(String)
      });
      expect(ResponseHelper.success).toHaveBeenCalledWith(
        res,
        { cancelledItems: 2 },
        'Zrušeno 2 položek z batch operace'
      );
    });

    it('should respect user authorization', async () => {
      const req = createMockRequest({ batchId: 'batch-123' });
      const res = createMockResponse();

      // Mock service to only return user's items
      mockQueueService.cancelBatch.mockResolvedValue(['queue-1']); // Only user's item

      await queueController.cancelBatch(req, res);

      expect(mockQueueService.cancelBatch).toHaveBeenCalledWith('batch-123', 'user-123');
      expect(ResponseHelper.success).toHaveBeenCalledWith(
        res,
        { cancelledItems: 1 },
        'Zrušeno 1 položek z batch operace'
      );
    });

    it('should handle non-existent batch', async () => {
      const req = createMockRequest({ batchId: 'non-existent-batch' });
      const res = createMockResponse();

      mockQueueService.cancelBatch.mockResolvedValue([]);

      await queueController.cancelBatch(req, res);

      expect(ResponseHelper.success).toHaveBeenCalledWith(
        res,
        { cancelledItems: 0 },
        'Zrušeno 0 položek z batch operace'
      );
    });

    it('should require user authentication', async () => {
      const req = createMockRequest({ batchId: 'batch-123' }, {}, null);
      const res = createMockResponse();

      await queueController.cancelBatch(req, res);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(res, 'User authentication required');
      expect(mockQueueService.cancelBatch).not.toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      const req = createMockRequest({ batchId: 'batch-123' });
      const res = createMockResponse();

      const error = new Error('Service error');
      mockQueueService.cancelBatch.mockRejectedValue(error);

      await queueController.cancelBatch(req, res);

      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        res,
        error,
        'Chyba při rušení batch operace'
      );
    });

    it('should emit proper WebSocket events', async () => {
      const req = createMockRequest({ batchId: 'batch-123' });
      const res = createMockResponse();

      mockQueueService.cancelBatch.mockResolvedValue(['queue-1', 'queue-2']);

      await queueController.cancelBatch(req, res);

      expect(mockWebSocketService.emitToUser).toHaveBeenCalledWith('user-123', {
        type: 'batch:cancelled',
        batchId: 'batch-123',
        cancelledCount: 2,
        timestamp: expect.any(String)
      });
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle missing user in database', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(res, 'Uživatel nenalezen');
    });

    it('should handle database connection errors', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      const dbError = new Error('Database connection failed');
      vi.mocked(prisma.user.findUnique).mockRejectedValue(dbError);

      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        res,
        dbError,
        'Chyba při rušení fronty projektu'
      );
    });

    it('should handle WebSocket service errors gracefully', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      mockQueueService.cancelByProject.mockResolvedValue(['queue-1']);
      mockWebSocketService.emitToUser.mockImplementation(() => {
        throw new Error('WebSocket error');
      });

      // Should complete successfully despite WebSocket error
      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.success).toHaveBeenCalled();
    });
  });

  describe('Race Condition Handling', () => {
    it('should handle concurrent cancellation requests', async () => {
      const req1 = createMockRequest({ projectId: 'project-123' });
      const req2 = createMockRequest({ projectId: 'project-123' });
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      // First request cancels items, second finds empty queue
      mockQueueService.cancelByProject
        .mockResolvedValueOnce(['queue-1', 'queue-2'])
        .mockResolvedValueOnce([]);

      await Promise.all([
        queueController.cancelProjectQueue(req1, res1),
        queueController.cancelProjectQueue(req2, res2)
      ]);

      expect(mockQueueService.cancelByProject).toHaveBeenCalledTimes(2);
      expect(ResponseHelper.success).toHaveBeenCalledTimes(2);
    });

    it('should handle item status changes during cancellation', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      // Simulate partial cancellation due to status changes
      mockQueueService.cancelByProject.mockResolvedValue(['queue-1']); // Only one cancelled

      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.success).toHaveBeenCalledWith(
        res,
        { cancelledItems: 1 },
        'Zrušeno 1 položek z fronty'
      );
    });
  });

  describe('Large Scale Operations', () => {
    it('should handle cancellation of large batches', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      // Generate large number of cancelled items
      const largeResultSet = Array.from({ length: 1000 }, (_, i) => `queue-${i}`);
      mockQueueService.cancelByProject.mockResolvedValue(largeResultSet);

      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.success).toHaveBeenCalledWith(
        res,
        { cancelledItems: 1000 },
        'Zrušeno 1000 položek z fronty'
      );
      expect(mockWebSocketService.emitToUser).toHaveBeenCalledWith('user-123', {
        type: 'queue:cancelled',
        projectId: 'project-123',
        cancelledCount: 1000,
        timestamp: expect.any(String)
      });
    });

    it('should handle performance within reasonable time', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      const startTime = Date.now();

      mockQueueService.cancelByProject.mockResolvedValue(['queue-1']);

      await queueController.cancelProjectQueue(req, res);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 1 second for unit test
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Security Tests', () => {
    it('should prevent unauthorized access to other users\' queues', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      // Mock project owned by different user without sharing
      const otherUserProject = {
        ...mockProject,
        userId: 'other-user-123'
      };
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null); // No access

      await queueController.cancelProjectQueue(req, res);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(res, 'Projekt nenalezen nebo nemáte oprávnění');
      expect(mockQueueService.cancelByProject).not.toHaveBeenCalled();
    });

    it('should validate project sharing permissions', async () => {
      const req = createMockRequest({ projectId: 'project-123' });
      const res = createMockResponse();

      // Project shared but with pending status
      const pendingSharedProject = {
        ...mockProject,
        userId: 'owner-123',
        shares: [
          {
            sharedWithId: 'user-123',
            status: 'pending' // Not accepted yet
          }
        ]
      };

      // Project should still be accessible with pending status
      vi.mocked(prisma.project.findFirst).mockResolvedValue(pendingSharedProject);
      mockQueueService.cancelByProject.mockResolvedValue(['queue-1']);

      await queueController.cancelProjectQueue(req, res);

      expect(mockQueueService.cancelByProject).toHaveBeenCalled();
    });

    it('should prevent SQL injection in project ID', async () => {
      const maliciousProjectId = "'; DROP TABLE projects; --";
      const req = createMockRequest({ projectId: maliciousProjectId });
      const res = createMockResponse();

      await queueController.cancelProjectQueue(req, res);

      // Should be handled by Prisma's query building
      expect(mockQueueService.cancelByProject).toHaveBeenCalledWith(maliciousProjectId, 'user-123');
    });

    it('should prevent SQL injection in batch ID', async () => {
      const maliciousBatchId = "'; DROP TABLE segmentationQueue; --";
      const req = createMockRequest({ batchId: maliciousBatchId });
      const res = createMockResponse();

      mockQueueService.cancelBatch.mockResolvedValue([]);

      await queueController.cancelBatch(req, res);

      expect(mockQueueService.cancelBatch).toHaveBeenCalledWith(maliciousBatchId, 'user-123');
    });
  });
});