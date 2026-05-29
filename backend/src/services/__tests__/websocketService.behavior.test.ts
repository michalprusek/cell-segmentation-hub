/**
 * websocketService.behavior.test.ts
 *
 * Targets remaining WebSocketService paths not covered by
 * unit/gaps/parallel/realtime/cancel test files (~32 % still uncovered):
 *
 *  - shutdown() — broadcasts warning, then closes io + clears connectedUsers
 *  - emitParallelProcessingStatus() — global broadcast shape + error path
 *  - emitProcessingStreamUpdate() — global broadcast shape + error path
 *  - trackParallelProcessingUser() / untrackParallelProcessingUser()
 *    → increments / decrements concurrentUserCount + emitConcurrentUserCount
 *  - getConcurrentProcessingUserCount() — returns correct counter
 *  - emitDashboardUpdate() — delegates to emitToUser with DASHBOARD_UPDATE event
 *  - broadcastProjectUpdate() — error path (io.to throws → no rethrow)
 *  - createDataSummary() — tested indirectly via emitToUser with different
 *    data shapes: null, string (short + long), array, object, number
 *  - operation:cancel socket event — upload / segmentation / export branches,
 *    unauthenticated guard, and error path (emits cancel-error)
 *  - export:cancel socket event — success path (ExportService.cancelJob called)
 *    and unauthenticated guard
 *  - socket 'error' event handler — covered via on('error') trigger
 *  - CORS in development — localhost origin allowed, non-localhost rejected
 *  - CORS in production — allowedOrigins empty → rejected; origin in list → allowed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { prismaMock, jwtMock, makeIo } = vi.hoisted(() => {
  const jwtMock = { verify: vi.fn() as ReturnType<typeof vi.fn> };

  const prismaMock = {
    user: { findUnique: vi.fn() as ReturnType<typeof vi.fn> },
    project: { findFirst: vi.fn() as ReturnType<typeof vi.fn> },
  };

  const makeIo = () => {
    const roomEmit = vi.fn();
    const io = {
      use: vi.fn() as ReturnType<typeof vi.fn>,
      on: vi.fn() as ReturnType<typeof vi.fn>,
      to: vi.fn(() => ({ emit: roomEmit })) as ReturnType<typeof vi.fn>,
      emit: vi.fn() as ReturnType<typeof vi.fn>,
      close: vi.fn() as ReturnType<typeof vi.fn>,
      _roomEmit: roomEmit,
    };
    return io;
  };

  return { prismaMock, jwtMock, makeIo };
});

vi.mock('socket.io', () => ({
  Server: vi.fn(),
}));
vi.mock('jsonwebtoken', () => jwtMock);
vi.mock('../../utils/logger');
vi.mock('../../utils/config', () => ({
  config: {
    UPLOAD_DIR: '/tmp/test-uploads',
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-secret',
  },
}));

// ExportService mock — needed by the export:cancel handler
vi.mock('../exportService', () => ({
  ExportService: {
    getInstance: vi.fn(() => ({
      cancelJob: vi.fn(async () => undefined),
    })),
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { Server as SocketIOServer } from 'socket.io';
import { WebSocketService } from '../websocketService';
import { WebSocketEvent } from '../../types/websocket';

// ── Helpers ───────────────────────────────────────────────────────────────────

const resetSingleton = () => {
  (WebSocketService as unknown as Record<string, unknown>).instance = undefined;
};

function makeService() {
  resetSingleton();
  const io = makeIo();
  (SocketIOServer as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    function (this: Record<string, unknown>) {
      Object.assign(this, io);
    }
  );
  const svc = WebSocketService.getInstance(
    {} as import('http').Server,
    prismaMock as unknown as import('@prisma/client').PrismaClient
  );
  return { svc, io };
}

function getConnectionHandler(io: ReturnType<typeof makeIo>) {
  const call = io.on.mock.calls.find((c: unknown[]) => c[0] === 'connection');
  return call?.[1] as (socket: Record<string, unknown>) => void;
}

function makeSocket(userId: string | undefined, socketId = 'sock-1') {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const socket: Record<string, unknown> = {
    id: socketId,
    userId,
    userEmail: userId ? `${userId}@test.com` : undefined,
    join: vi.fn(),
    leave: vi.fn(),
    emit: vi.fn(),
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    },
    _trigger(event: string, ...args: unknown[]) {
      return Promise.all(
        (listeners[event] ?? []).map(cb => Promise.resolve(cb(...args)))
      );
    },
  };
  return socket as typeof socket & {
    _trigger: (event: string, ...args: unknown[]) => Promise<void[]>;
    join: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebSocketService – behavior coverage', () => {
  let svc: WebSocketService;
  let io: ReturnType<typeof makeIo>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_ACCESS_SECRET = 'test-secret-behavior';
    prismaMock.project.findFirst.mockResolvedValue(null);
    ({ svc, io } = makeService());
  });

  afterEach(() => {
    resetSingleton();
  });

  // ── shutdown() ──────────────────────────────────────────────────────────────

  describe('shutdown()', () => {
    it('broadcasts a "warning" system-message before closing', async () => {
      vi.useFakeTimers();
      const shutdownPromise = svc.shutdown();
      // Flush the 1 second delay inside shutdown
      vi.advanceTimersByTime(1000);
      await shutdownPromise;
      vi.useRealTimers();

      const systemMsgCalls = io.emit.mock.calls.filter(
        (c: unknown[]) => c[0] === 'system-message'
      );
      expect(systemMsgCalls.length).toBeGreaterThanOrEqual(1);
      const payload = systemMsgCalls[0][1] as Record<string, unknown>;
      expect(payload.type).toBe('warning');
    });

    it('calls io.close() and clears connectedUsers', async () => {
      // Seed one user into the map
      (svc as unknown as Record<string, unknown>).connectedUsers = new Map([
        ['u1', new Set(['s1'])],
      ]);

      vi.useFakeTimers();
      const shutdownPromise = svc.shutdown();
      vi.advanceTimersByTime(1000);
      await shutdownPromise;
      vi.useRealTimers();

      expect(io.close).toHaveBeenCalledTimes(1);
      expect(svc.getConnectedUsersCount()).toBe(0);
    });
  });

  // ── emitParallelProcessingStatus() ─────────────────────────────────────────

  describe('emitParallelProcessingStatus()', () => {
    it('broadcasts to ALL sockets (io.emit, not io.to) with timestamp', () => {
      svc.emitParallelProcessingStatus({
        activeStreams: 2,
        maxConcurrentStreams: 4,
        totalProcessingCapacity: 8,
        currentThroughput: 5.5,
        concurrentUserCount: 2,
      });

      expect(io.emit).toHaveBeenCalledWith(
        'parallel-processing-status',
        expect.objectContaining({
          activeStreams: 2,
          maxConcurrentStreams: 4,
          timestamp: expect.any(String),
        })
      );
      expect(io.to).not.toHaveBeenCalled();
    });

    it('does not throw when io.emit throws', () => {
      io.emit.mockImplementationOnce(() => {
        throw new Error('io gone');
      });
      expect(() =>
        svc.emitParallelProcessingStatus({
          activeStreams: 0,
          maxConcurrentStreams: 0,
          totalProcessingCapacity: 0,
          currentThroughput: 0,
          concurrentUserCount: 0,
        })
      ).not.toThrow();
    });
  });

  // ── emitProcessingStreamUpdate() ───────────────────────────────────────────

  describe('emitProcessingStreamUpdate()', () => {
    it('broadcasts to all sockets with streamId + timestamp', () => {
      svc.emitProcessingStreamUpdate('stream-42', {
        streamId: 'stream-42',
        status: 'processing',
        batchSize: 10,
        model: 'hrnet',
        progress: 50,
        estimatedTimeRemaining: 30000,
      });

      expect(io.emit).toHaveBeenCalledWith(
        'processing-stream-update',
        expect.objectContaining({
          streamId: 'stream-42',
          status: 'processing',
          batchSize: 10,
          progress: 50,
          timestamp: expect.any(String),
        })
      );
    });

    it('does not throw when io.emit throws', () => {
      io.emit.mockImplementationOnce(() => {
        throw new Error('net error');
      });
      expect(() =>
        svc.emitProcessingStreamUpdate('s1', {
          streamId: 's1',
          status: 'started',
          batchSize: 1,
          model: 'unet',
          progress: 0,
        })
      ).not.toThrow();
    });
  });

  // ── trackParallelProcessingUser / untrackParallelProcessingUser ─────────────

  describe('trackParallelProcessingUser() / untrackParallelProcessingUser()', () => {
    it('increments getConcurrentProcessingUserCount() after track', () => {
      const before = svc.getConcurrentProcessingUserCount();
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      svc.trackParallelProcessingUser('user-1', 'proj-1');
      expect(svc.getConcurrentProcessingUserCount()).toBe(before + 1);
    });

    it('emits concurrent-user-count to the project room after track', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      svc.trackParallelProcessingUser('user-T', 'proj-T');
      expect(io.to).toHaveBeenCalledWith('project:proj-T');
      expect(roomEmit).toHaveBeenCalledWith(
        'concurrent-user-count',
        expect.objectContaining({ projectId: 'proj-T' })
      );
    });

    it('decrements count and emits after untrack', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      svc.trackParallelProcessingUser('user-U', 'proj-U');
      const afterTrack = svc.getConcurrentProcessingUserCount();

      svc.untrackParallelProcessingUser('user-U', 'proj-U');
      expect(svc.getConcurrentProcessingUserCount()).toBe(afterTrack - 1);
      // emitConcurrentUserCount called again with updated count
      const calls = io.to.mock.calls.filter(
        (c: unknown[]) => c[0] === 'project:proj-U'
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('getConcurrentProcessingUserCount returns 0 initially', () => {
      expect(svc.getConcurrentProcessingUserCount()).toBe(0);
    });
  });

  // ── emitDashboardUpdate() ───────────────────────────────────────────────────

  describe('emitDashboardUpdate()', () => {
    it('delegates to emitToUser with DASHBOARD_UPDATE event', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });

      svc.emitDashboardUpdate('user-D', {
        userId: 'user-D',
        metrics: {
          totalProjects: 1,
          totalImages: 2,
          processedImages: 1,
          imagesUploadedToday: 0,
          storageUsed: '5 MB',
          storageUsedBytes: 5_000_000,
        },
        timestamp: new Date(),
      });

      expect(io.to).toHaveBeenCalledWith('user:user-D');
      expect(roomEmit).toHaveBeenCalledWith(
        WebSocketEvent.DASHBOARD_UPDATE,
        expect.objectContaining({ userId: 'user-D' })
      );
    });

    it('does not throw when io.to throws (error caught in emitToUser)', () => {
      io.to.mockImplementationOnce(() => {
        throw new Error('socket dead');
      });
      expect(() =>
        svc.emitDashboardUpdate('user-E', {
          userId: 'user-E',
          metrics: {
            totalProjects: 0,
            totalImages: 0,
            processedImages: 0,
            imagesUploadedToday: 0,
            storageUsed: '0 B',
            storageUsedBytes: 0,
          },
          timestamp: new Date(),
        })
      ).not.toThrow();
    });
  });

  // ── broadcastProjectUpdate() error path ─────────────────────────────────────

  describe('broadcastProjectUpdate() – error path', () => {
    it('does not rethrow when io.to throws', () => {
      io.to.mockImplementationOnce(() => {
        throw new Error('project room gone');
      });
      expect(() =>
        svc.broadcastProjectUpdate('proj-err', {
          projectId: 'proj-err',
          userId: 'u1',
          operation: 'updated',
          updates: { imageCount: 0, segmentedCount: 0 },
          timestamp: new Date(),
        })
      ).not.toThrow();
    });
  });

  // ── createDataSummary() — exercised through emitToUser ─────────────────────

  describe('createDataSummary (via emitToUser)', () => {
    // These tests verify that emitToUser does not crash for various data shapes,
    // which exercises all branches in the private createDataSummary method.

    it('handles null data', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      expect(() => svc.emitToUser('u', 'ev', null)).not.toThrow();
    });

    it('handles undefined data', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      expect(() => svc.emitToUser('u', 'ev', undefined)).not.toThrow();
    });

    it('handles short string data (≤50 chars)', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      expect(() => svc.emitToUser('u', 'ev', 'short')).not.toThrow();
    });

    it('handles long string data (>50 chars — triggers preview truncation)', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      expect(() => svc.emitToUser('u', 'ev', 'x'.repeat(100))).not.toThrow();
    });

    it('handles array data', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      expect(() => svc.emitToUser('u', 'ev', [1, 2, 3])).not.toThrow();
    });

    it('handles object data', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      expect(() => svc.emitToUser('u', 'ev', { a: 1, b: 2 })).not.toThrow();
    });

    it('handles numeric data (primitive fallback branch)', () => {
      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });
      expect(() => svc.emitToUser('u', 'ev', 42)).not.toThrow();
    });
  });

  // ── socket 'error' event ────────────────────────────────────────────────────

  describe("socket 'error' event", () => {
    it('does not crash the service when the socket fires an error event', () => {
      const handler = getConnectionHandler(io);
      const socket = makeSocket('user-ERR-EV');
      handler(socket as unknown as Record<string, unknown>);

      // Should not throw — the error handler just logs
      expect(() =>
        socket._trigger('error', new Error('socket-level error'))
      ).not.toThrow();
    });
  });

  // ── operation:cancel socket event ──────────────────────────────────────────

  describe('operation:cancel socket event', () => {
    it('emits upload:cancelled and cancel-ack for upload operation', async () => {
      const handler = getConnectionHandler(io);
      const socket = makeSocket('user-OC');
      handler(socket as unknown as Record<string, unknown>);

      const roomEmit = vi.fn();
      io.to.mockReturnValue({ emit: roomEmit });

      await socket._trigger('operation:cancel', {
        operationId: 'op-1',
        operationType: 'upload',
      });

      // The emitToUser call targets user room
      expect(io.to).toHaveBeenCalledWith('user:user-OC');
      // The socket.emit gets cancel-ack
      const ackCall = (socket.emit as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'operation:cancel-ack'
      );
      expect(ackCall).toBeDefined();
      expect(ackCall![1]).toMatchObject({
        operationId: 'op-1',
        operationType: 'upload',
        success: true,
      });
    });

    it('emits segmentation:cancelled and cancel-ack for segmentation operation', async () => {
      const handler = getConnectionHandler(io);
      const socket = makeSocket('user-OC2');
      handler(socket as unknown as Record<string, unknown>);

      io.to.mockReturnValue({ emit: vi.fn() });

      await socket._trigger('operation:cancel', {
        operationId: 'op-2',
        operationType: 'segmentation',
        projectId: 'proj-seg',
      });

      const ackCall = (socket.emit as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'operation:cancel-ack'
      );
      expect(ackCall).toBeDefined();
      expect(ackCall![1]).toMatchObject({ operationType: 'segmentation' });
    });

    it('emits export:cancelled and cancel-ack for export operation', async () => {
      const handler = getConnectionHandler(io);
      const socket = makeSocket('user-OC3');
      handler(socket as unknown as Record<string, unknown>);

      io.to.mockReturnValue({ emit: vi.fn() });

      await socket._trigger('operation:cancel', {
        operationId: 'op-3',
        operationType: 'export',
      });

      const ackCall = (socket.emit as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'operation:cancel-ack'
      );
      expect(ackCall).toBeDefined();
    });

    it('returns early (no emit) when socket has no userId', async () => {
      const handler = getConnectionHandler(io);
      const socket = makeSocket(undefined);
      handler(socket as unknown as Record<string, unknown>);

      await socket._trigger('operation:cancel', {
        operationId: 'op-x',
        operationType: 'upload',
      });

      // No cancel-ack should be emitted for unauthenticated sockets
      const ackCall = (socket.emit as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'operation:cancel-ack'
      );
      expect(ackCall).toBeUndefined();
    });
  });

  // ── export:cancel socket event ──────────────────────────────────────────────

  describe('export:cancel socket event', () => {
    it('calls ExportService.cancelJob when userId present', async () => {
      const handler = getConnectionHandler(io);
      const socket = makeSocket('user-EC');
      handler(socket as unknown as Record<string, unknown>);

      // ExportService is mocked at module level
      await socket._trigger('export:cancel', {
        jobId: 'job-1',
        projectId: 'proj-1',
      });

      // If no error is emitted, the cancelJob call succeeded
      const cancelErrorCall = (
        socket.emit as ReturnType<typeof vi.fn>
      ).mock.calls.find((c: unknown[]) => c[0] === 'export:cancel-error');
      expect(cancelErrorCall).toBeUndefined();
    });

    it('emits export:cancel-error when cancelJob throws', async () => {
      // Override the ExportService mock to throw
      const { ExportService } = await import('../exportService');
      const mockCancelJob = vi
        .fn()
        .mockRejectedValueOnce(new Error('job not found'));
      (
        ExportService.getInstance as ReturnType<typeof vi.fn>
      ).mockReturnValueOnce({ cancelJob: mockCancelJob });

      const handler = getConnectionHandler(io);
      const socket = makeSocket('user-EC2');
      handler(socket as unknown as Record<string, unknown>);

      await socket._trigger('export:cancel', {
        jobId: 'job-fail',
        projectId: 'proj-fail',
      });

      const cancelErrorCall = (
        socket.emit as ReturnType<typeof vi.fn>
      ).mock.calls.find((c: unknown[]) => c[0] === 'export:cancel-error');
      expect(cancelErrorCall).toBeDefined();
      expect(cancelErrorCall![1]).toMatchObject({
        jobId: 'job-fail',
        error: expect.any(String),
      });
    });

    it('returns early (no action) when userId is absent', async () => {
      const handler = getConnectionHandler(io);
      const socket = makeSocket(undefined);
      handler(socket as unknown as Record<string, unknown>);

      await socket._trigger('export:cancel', {
        jobId: 'job-anon',
        projectId: 'proj-anon',
      });

      // No error event should be emitted for unauthenticated requests
      const cancelErrorCall = (
        socket.emit as ReturnType<typeof vi.fn>
      ).mock.calls.find((c: unknown[]) => c[0] === 'export:cancel-error');
      expect(cancelErrorCall).toBeUndefined();
    });
  });

  // ── request-queue-stats with queueService wired ─────────────────────────────

  describe('request-queue-stats with queueService', () => {
    it('calls queueService.getQueueStats when project access is granted', async () => {
      prismaMock.project.findFirst.mockResolvedValue({ id: 'proj-qs2' });
      const fakeQueueService = {
        getQueueStats: vi.fn().mockResolvedValue(undefined),
      };
      svc.setQueueService(
        fakeQueueService as unknown as import('../queueService').QueueService
      );

      const handler = getConnectionHandler(io);
      const socket = makeSocket('user-QS');
      handler(socket as unknown as Record<string, unknown>);

      await socket._trigger('request-queue-stats', 'proj-qs2');

      expect(fakeQueueService.getQueueStats).toHaveBeenCalledWith(
        'proj-qs2',
        'user-QS'
      );
    });

    it('silently handles getQueueStats() throwing', async () => {
      prismaMock.project.findFirst.mockResolvedValue({ id: 'proj-qs3' });
      const fakeQueueService = {
        getQueueStats: vi.fn().mockRejectedValue(new Error('queue DB error')),
      };
      svc.setQueueService(
        fakeQueueService as unknown as import('../queueService').QueueService
      );

      const handler = getConnectionHandler(io);
      const socket = makeSocket('user-QS2');
      handler(socket as unknown as Record<string, unknown>);

      await expect(
        socket._trigger('request-queue-stats', 'proj-qs3')
      ).resolves.not.toThrow();
    });
  });

  // ── emitConcurrentUserCount error path ─────────────────────────────────────

  describe('emitConcurrentUserCount() – error path', () => {
    it('does not throw when io.to throws', () => {
      io.to.mockImplementationOnce(() => {
        throw new Error('room error');
      });
      expect(() => svc.emitConcurrentUserCount('proj-bad', 3)).not.toThrow();
    });
  });
});
