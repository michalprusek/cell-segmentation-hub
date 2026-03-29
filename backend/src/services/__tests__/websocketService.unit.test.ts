import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// --- JWT mock ---
const jwtMock = {
  verify: jest.fn() as any,
};

// --- Prisma mock ---
const prismaMock = {
  user: {
    findUnique: jest.fn() as any,
  },
  project: {
    findFirst: jest.fn() as any,
  },
};

// --- Socket.IO mock ---
// The mock io instance returned by the SocketIOServer constructor
const mockIo = {
  use: jest.fn() as any,
  on: jest.fn() as any,
  to: jest.fn() as any,
  emit: jest.fn() as any,
  close: jest.fn() as any,
};
// make .to() chainable (returns object with .emit)
mockIo.to.mockReturnValue({ emit: jest.fn() });

// All mocks before imports
jest.mock('socket.io', () => ({
  Server: jest.fn(() => mockIo),
}));
jest.mock('jsonwebtoken', () => jwtMock);
jest.mock('../../utils/logger');

import { WebSocketService } from '../websocketService';
import { Server as SocketIOServer } from 'socket.io';
import {
  WebSocketEvent,
  getUserRoom,
  getProjectRoom,
} from '../../types/websocket';

// Helper to reset the singleton so each test suite gets a clean instance
const resetSingleton = () => {
  (WebSocketService as any).instance = undefined;
};

const makeService = () => {
  resetSingleton();

  // Reset mock io return on each construction
  const freshIo = {
    use: jest.fn(),
    on: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    emit: jest.fn(),
    close: jest.fn(),
  };
  (SocketIOServer as unknown as jest.Mock).mockReturnValue(freshIo);

  const httpServer = {} as any;
  const svc = WebSocketService.getInstance(httpServer, prismaMock as any);
  return { svc, io: freshIo };
};

describe('WebSocketService - Core Unit Tests', () => {
  let svc: WebSocketService;
  let io: ReturnType<typeof makeService>['io'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ svc, io } = makeService());
  });

  afterEach(() => {
    resetSingleton();
  });

  // ---------------------------------------------------------------------------
  describe('emitToUser', () => {
    it('emits to user room via io.to()', () => {
      const roomEmit = jest.fn();
      io.to.mockReturnValueOnce({ emit: roomEmit });

      svc.emitToUser('user-123', 'test-event', { payload: 'data' });

      expect(io.to).toHaveBeenCalledWith('user:user-123');
      expect(roomEmit).toHaveBeenCalledWith('test-event', { payload: 'data' });
    });

    it('does not throw with invalid userId', () => {
      expect(() => svc.emitToUser('', 'test-event', {})).not.toThrow();
      expect(io.to).not.toHaveBeenCalled();
    });

    it('does not throw with invalid event name', () => {
      expect(() => svc.emitToUser('user-123', '', {})).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  describe('broadcastProjectUpdate', () => {
    it('emits to project room with PROJECT_UPDATE event', () => {
      const roomEmit = jest.fn();
      io.to.mockReturnValueOnce({ emit: roomEmit });

      const update = {
        projectId: 'project-1',
        userId: 'user-1',
        operation: 'updated' as const,
        updates: { imageCount: 5, segmentedCount: 3 },
        timestamp: new Date(),
      };

      svc.broadcastProjectUpdate('project-1', update);

      expect(io.to).toHaveBeenCalledWith('project:project-1');
      expect(roomEmit).toHaveBeenCalledWith(
        WebSocketEvent.PROJECT_UPDATE,
        update
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('emitDashboardUpdate', () => {
    it('calls emitToUser with DASHBOARD_UPDATE event', () => {
      const roomEmit = jest.fn();
      io.to.mockReturnValueOnce({ emit: roomEmit });

      const dashboardData = {
        userId: 'user-1',
        metrics: {
          totalProjects: 3,
          totalImages: 10,
          processedImages: 7,
          imagesUploadedToday: 2,
          storageUsed: '100 MB',
          storageUsedBytes: 104857600,
        },
        timestamp: new Date(),
      };

      svc.emitDashboardUpdate('user-1', dashboardData);

      expect(io.to).toHaveBeenCalledWith('user:user-1');
      expect(roomEmit).toHaveBeenCalledWith(
        WebSocketEvent.DASHBOARD_UPDATE,
        dashboardData
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('emitSegmentationUpdate', () => {
    it('emits status and progress to user room', () => {
      const roomEmit = jest.fn();
      io.to.mockReturnValueOnce({ emit: roomEmit });

      const update = {
        imageId: 'img-1',
        projectId: 'project-1',
        status: 'processing' as any,
        queueId: 'queue-1',
        progress: 50,
      };

      svc.emitSegmentationUpdate('user-1', update);

      expect(io.to).toHaveBeenCalledWith(getUserRoom('user-1'));
      expect(roomEmit).toHaveBeenCalledWith(
        WebSocketEvent.SEGMENTATION_UPDATE,
        update
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('emitQueueStatsUpdate', () => {
    it('emits queue statistics to project room', () => {
      const roomEmit = jest.fn();
      io.to.mockReturnValueOnce({ emit: roomEmit });

      const stats = {
        projectId: 'project-1',
        queued: 3,
        processing: 1,
        total: 4,
        timestamp: new Date(),
      };

      svc.emitQueueStatsUpdate('project-1', stats);

      expect(io.to).toHaveBeenCalledWith(getProjectRoom('project-1'));
      expect(roomEmit).toHaveBeenCalledWith(WebSocketEvent.QUEUE_STATS, stats);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Connection tracking', () => {
    it('isUserConnected returns false for unknown user', () => {
      expect(svc.isUserConnected('unknown-user')).toBe(false);
    });

    it('getUserSocketsCount returns 0 for unknown user', () => {
      expect(svc.getUserSocketsCount('no-such-user')).toBe(0);
    });

    it('getConnectedUsersCount starts at 0', () => {
      expect(svc.getConnectedUsersCount()).toBe(0);
    });

    it('tracks connected users via connectedUsers map', () => {
      // Simulate what the internal connection handler does
      const connectedUsers = (svc as any).connectedUsers as Map<
        string,
        Set<string>
      >;

      connectedUsers.set('user-42', new Set(['socket-a', 'socket-b']));

      expect(svc.isUserConnected('user-42')).toBe(true);
      expect(svc.getUserSocketsCount('user-42')).toBe(2);
      expect(svc.getConnectedUsersCount()).toBe(1);
    });

    it('disconnection cleans up user tracking', () => {
      const connectedUsers = (svc as any).connectedUsers as Map<
        string,
        Set<string>
      >;

      connectedUsers.set('user-99', new Set(['socket-x']));
      expect(svc.isUserConnected('user-99')).toBe(true);

      // Simulate disconnect cleanup
      const userSockets = connectedUsers.get('user-99')!;
      userSockets.delete('socket-x');
      if (userSockets.size === 0) {
        connectedUsers.delete('user-99');
      }

      expect(svc.isUserConnected('user-99')).toBe(false);
      expect(svc.getConnectedUsersCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Authentication middleware', () => {
    it('rejects socket when no token provided', async () => {
      // Extract the middleware callback installed on io.use
      expect(io.use).toHaveBeenCalled();
      const middleware = io.use.mock.calls[0][0] as (
        socket: any,
        next: (err?: Error) => void
      ) => Promise<void>;

      const socket = {
        id: 'socket-1',
        handshake: {
          auth: {},
          headers: {},
        },
      };
      const next = jest.fn();

      await middleware(socket, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('token') })
      );
    });

    it('rejects socket with invalid JWT token', async () => {
      process.env.JWT_ACCESS_SECRET = 'test-secret';

      const middleware = io.use.mock.calls[0][0] as (
        socket: any,
        next: (err?: Error) => void
      ) => Promise<void>;

      jwtMock.verify.mockImplementationOnce(() => {
        throw new Error('jwt malformed');
      });

      const socket = {
        id: 'socket-2',
        handshake: {
          auth: { token: 'bad-token' },
          headers: {},
        },
      };
      const next = jest.fn();

      await middleware(socket, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Authentication failed' })
      );
    });

    it('rejects socket when user not found in database', async () => {
      process.env.JWT_ACCESS_SECRET = 'test-secret';

      const middleware = io.use.mock.calls[0][0] as (
        socket: any,
        next: (err?: Error) => void
      ) => Promise<void>;

      jwtMock.verify.mockReturnValueOnce({
        userId: 'ghost-user',
        email: 'ghost@example.com',
      });
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const socket = {
        id: 'socket-3',
        handshake: {
          auth: { token: 'valid-format-token' },
          headers: {},
        },
      };
      const next = jest.fn();

      await middleware(socket, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid authentication token' })
      );
    });

    it('authenticates socket with valid JWT and existing user', async () => {
      process.env.JWT_ACCESS_SECRET = 'test-secret';

      const middleware = io.use.mock.calls[0][0] as (
        socket: any,
        next: (err?: Error) => void
      ) => Promise<void>;

      jwtMock.verify.mockReturnValueOnce({
        userId: 'real-user',
        email: 'real@example.com',
      });
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'real-user',
        email: 'real@example.com',
      } as any);

      const socket: any = {
        id: 'socket-4',
        handshake: {
          auth: { token: 'good-token' },
          headers: {},
        },
      };
      const next = jest.fn();

      await middleware(socket, next);

      expect(next).toHaveBeenCalledWith(); // called with no args = success
      expect(socket.userId).toBe('real-user');
      expect(socket.userEmail).toBe('real@example.com');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getInstance', () => {
    it('returns the same singleton after init', () => {
      const a = WebSocketService.getInstance();
      const b = WebSocketService.getInstance();
      expect(a).toBe(b);
    });

    it('throws before init when no server/prisma provided', () => {
      resetSingleton();
      expect(() => WebSocketService.getInstance()).toThrow(
        'Server and Prisma are required for first initialization'
      );
    });
  });
});
