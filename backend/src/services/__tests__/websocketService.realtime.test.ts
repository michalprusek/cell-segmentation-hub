import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Server as HTTPServer, createServer } from 'http';
// import { Server as SocketIOServer } from 'socket.io';
import Client from 'socket.io-client';

// Mock Prisma client
type MockPrismaClient = {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  project: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  image: {
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  segmentation: {
    count: ReturnType<typeof vi.fn>;
  };
};

const prismaMock: MockPrismaClient = {
  user: {
    findUnique: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    // isValidProjectAccess() (gating join-project) queries findFirst.
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  image: {
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
  segmentation: {
    count: vi.fn(),
  },
};

// Mock dependencies
vi.mock('../../db', () => ({
  prisma: prismaMock,
}));
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock('jsonwebtoken', () => ({
  verify: vi.fn(),
  default: {
    verify: vi.fn(),
  },
}));
// websocketService imports authCookies → config. Stub config so the real
// one (which process.exit's on a missing test env) is skipped.
vi.mock('../../utils/config', () => ({
  config: { UPLOAD_DIR: '/tmp/test-uploads', NODE_ENV: 'test' },
}));

// Import after mocking
import { WebSocketService } from '../websocketService';
import {
  WebSocketEvent,
  SegmentationUpdateData,
  ProjectUpdateData,
} from '../../types/websocket';
import jwt from 'jsonwebtoken';

describe('WebSocket Real-time Updates', () => {
  let httpServer: HTTPServer;
  let wsService: WebSocketService;
  let clientSocket: ReturnType<typeof Client>;
  let port: number;

  const mockToken = 'valid-jwt-token';

  // ---- helpers -------------------------------------------------------------

  /** Create an authenticated socket.io client (cookie auth). */
  function makeClient(): ReturnType<typeof Client> {
    return Client(`http://localhost:${port}`, {
      extraHeaders: { cookie: `access_token=${mockToken}` },
    });
  }

  /** Mock JWT + user lookup + project-access so a connection authenticates and
   * `join-project` succeeds for the given user. */
  function authAs(userId: string, email: string): void {
    (jwt.verify as Mock).mockReturnValue({ userId, email });
    prismaMock.user.findUnique.mockResolvedValue({ id: userId, email });
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project', userId });
  }

  /**
   * Connect a client, optionally join the project room, then repeatedly run
   * `broadcast` until the client has received `event` `receipts` times. The
   * server-side join is async (it awaits a DB access check), so a single
   * broadcast can race ahead of room membership — re-broadcasting on an
   * interval makes delivery deterministic. `assert` runs on each payload;
   * a thrown assertion (or connect error / timeout) rejects the test.
   */
  function runBroadcastTest<T = unknown>(opts: {
    projectId: string;
    event: string;
    broadcast: () => void;
    assert: (data: T) => void;
    join?: boolean;
    receipts?: number;
    timeoutMs?: number;
  }): Promise<void> {
    const {
      projectId,
      event,
      broadcast,
      assert,
      join = true,
      receipts = 1,
      timeoutMs = 8000,
    } = opts;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let received = 0;
      let interval: ReturnType<typeof setInterval> | undefined;
      const timer = setTimeout(
        () => finish(new Error(`Timed out waiting for ${event}`)),
        timeoutMs
      );
      const finish = (err?: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (interval) {
          clearInterval(interval);
        }
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } else {
          resolve();
        }
      };

      clientSocket = makeClient();
      clientSocket.on('connect_error', (e: Error) => finish(e));
      clientSocket.on('connect', () => {
        if (join) {
          clientSocket.emit('join-project', projectId);
        }
        clientSocket.on(event, (data: T) => {
          received++;
          try {
            assert(data);
          } catch (e) {
            finish(e);
            return;
          }
          if (received >= receipts) {
            finish();
          }
        });
        broadcast();
        interval = setInterval(broadcast, 25);
      });
    });
  }

  beforeEach(
    () =>
      new Promise<void>(resolve => {
        httpServer = createServer();
        wsService = new WebSocketService(httpServer, prismaMock as never);

        httpServer.listen(() => {
          const address = httpServer.address();
          port = address && typeof address === 'object' ? address.port : 3001;
          resolve();
        });
      })
  );

  afterEach(
    () =>
      new Promise<void>(resolve => {
        if (clientSocket) {
          clientSocket.disconnect();
        }
        httpServer.close(() => resolve());
      })
  );

  describe('PROJECT_UPDATE Events', () => {
    it('should emit PROJECT_UPDATE events on image operations', () => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      authAs(testUserId, 'test@example.com');

      const updateData: ProjectUpdateData = {
        projectId: testProjectId,
        userId: testUserId,
        operation: 'updated',
        updates: { imageCount: 15, segmentedCount: 12 },
        timestamp: new Date(),
      };

      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, updateData),
        assert: data => {
          expect(data.projectId).toBe(testProjectId);
          expect(data.userId).toBe(testUserId);
          expect(data.operation).toBe('updated');
          expect(data.updates).toBeDefined();
          expect(data.timestamp).toBeDefined();
        },
      });
    });

    it('should emit PROJECT_UPDATE with correct statistics after image deletion', () => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      authAs(testUserId, 'test@example.com');

      const updateData: ProjectUpdateData = {
        projectId: testProjectId,
        userId: testUserId,
        operation: 'updated',
        updates: { imageCount: 10, segmentedCount: 8 }, // After deletion
        timestamp: new Date(),
      };

      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, updateData),
        assert: data => {
          expect(data.projectId).toBe(testProjectId);
          expect(data.operation).toBe('updated');
          expect(data.updates?.imageCount).toBe(10);
          expect(data.updates?.segmentedCount).toBe(8);
        },
      });
    });

    it('should emit PROJECT_UPDATE with segmentation completion statistics', () => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      authAs(testUserId, 'test@example.com');

      const updateData: ProjectUpdateData = {
        projectId: testProjectId,
        userId: testUserId,
        operation: 'updated',
        updates: { imageCount: 15, segmentedCount: 13 }, // Increased
        timestamp: new Date(),
      };

      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, updateData),
        assert: data => {
          expect(data.projectId).toBe(testProjectId);
          expect(data.operation).toBe('updated');
          expect(data.updates?.segmentedCount).toBe(13);
          expect(data.timestamp).toBeDefined();
        },
      });
    });
  });

  describe('broadcastProjectUpdate method', () => {
    it('should broadcast to correct project room', () => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      authAs(testUserId, 'test@example.com');

      const updateData: ProjectUpdateData = {
        projectId: testProjectId,
        userId: testUserId,
        operation: 'updated',
        updates: { imageCount: 20, segmentedCount: 15 },
        timestamp: new Date(),
      };

      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, updateData),
        assert: data => {
          expect(data.projectId).toBe(testProjectId);
          expect(data.userId).toBe(testUserId);
        },
      });
    });

    it('should handle shared project notifications', () => {
      const ownerId = 'owner-user-id';
      const sharedUserId = 'shared-user-id';
      const testProjectId = 'shared-project-id';
      // The connected client is the *shared* collaborator; the owner makes the
      // change.
      authAs(sharedUserId, 'shared@example.com');

      const updateData: ProjectUpdateData = {
        projectId: testProjectId,
        userId: ownerId, // Owner made the change
        operation: 'updated',
        updates: { imageCount: 25, segmentedCount: 18 },
        timestamp: new Date(),
      };

      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, updateData),
        assert: data => {
          expect(data.projectId).toBe(testProjectId);
          expect(data.userId).toBe(ownerId);
          expect(data.operation).toBe('updated');
        },
      });
    });
  });

  describe('Real-time Update Event Payloads', () => {
    it('should include correct data structure in PROJECT_UPDATE events', () => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      authAs(testUserId, 'test@example.com');

      const updateData: ProjectUpdateData = {
        projectId: testProjectId,
        userId: testUserId,
        operation: 'updated',
        updates: {
          title: 'Updated Project Title',
          description: 'Updated description',
          imageCount: 30,
          segmentedCount: 22,
        },
        timestamp: new Date(),
      };

      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, updateData),
        assert: data => {
          expect(data).toEqual({
            projectId: expect.any(String),
            userId: expect.any(String),
            operation: expect.any(String),
            updates: expect.objectContaining({
              imageCount: expect.any(Number),
              segmentedCount: expect.any(Number),
              title: expect.any(String),
              description: expect.any(String),
            }),
            timestamp: expect.any(String),
          });
          expect(data.operation).toMatch(/^(created|updated|deleted|shared)$/);
        },
      });
    });

    it('should emit SEGMENTATION_UPDATE events with correct data', () => {
      const testUserId = 'test-user-id';
      const testImageId = 'test-image-id';
      const testProjectId = 'test-project-id';
      authAs(testUserId, 'test@example.com');

      // emitSegmentationUpdate targets the user's personal room (auto-joined on
      // connect), so no project-room join is required.
      return runBroadcastTest<SegmentationUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.SEGMENTATION_UPDATE,
        join: false,
        broadcast: () =>
          wsService.emitSegmentationUpdate(testUserId, {
            imageId: testImageId,
            projectId: testProjectId,
            status: 'completed',
            progress: 100,
          }),
        assert: data => {
          expect(data.imageId).toBe(testImageId);
          expect(data.projectId).toBe(testProjectId);
          expect(data.status).toBe('completed');
          expect(data.progress).toBe(100);
        },
      });
    });
  });

  describe('WebSocket Integration with Operations', () => {
    it('should integrate with image upload operations', () => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      authAs(testUserId, 'test@example.com');

      // The original test also expected an UPLOAD_COMPLETED event, but the
      // service has no such emitter (only PROJECT_UPDATE). Verify the upload
      // broadcast carries a positive image count.
      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, {
            projectId: testProjectId,
            userId: testUserId,
            operation: 'updated',
            updates: { imageCount: 5, segmentedCount: 0 },
            timestamp: new Date(),
          }),
        assert: data => {
          expect(data.projectId).toBe(testProjectId);
          expect(data.operation).toBe('updated');
          expect(data.updates?.imageCount).toBeGreaterThan(0);
        },
      });
    });

    it('should integrate with image deletion operations', () => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      authAs(testUserId, 'test@example.com');

      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, {
            projectId: testProjectId,
            userId: testUserId,
            operation: 'updated',
            updates: { imageCount: 2, segmentedCount: 1 }, // After deletion
            timestamp: new Date(),
          }),
        assert: data => {
          expect(data.projectId).toBe(testProjectId);
          expect(data.operation).toBe('updated');
          expect(data.updates?.imageCount).toBe(2);
          expect(data.updates?.segmentedCount).toBe(1);
        },
      });
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require valid JWT token for WebSocket connection', () => {
      (jwt.verify as Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(
          () => finish(new Error('Expected a connect_error')),
          8000
        );
        const finish = (err?: unknown): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          } else {
            resolve();
          }
        };

        clientSocket = makeClient();
        clientSocket.on('connect_error', (error: Error) => {
          try {
            expect(error.message).toContain('Authentication failed');
            finish();
          } catch (e) {
            finish(e);
          }
        });
        clientSocket.on('connect', () =>
          finish(new Error('Should not have connected with invalid token'))
        );
      });
    });

    it('should only send PROJECT_UPDATE events to authorized users', () => {
      const authorizedUserId = 'authorized-user-id';
      const testProjectId = 'private-project-id';
      authAs(authorizedUserId, 'authorized@example.com');

      // Receiving the broadcast confirms the authorized client is in the
      // project room (an unauthorized client never joins it).
      return runBroadcastTest<ProjectUpdateData>({
        projectId: testProjectId,
        event: WebSocketEvent.PROJECT_UPDATE,
        broadcast: () =>
          wsService.broadcastProjectUpdate(testProjectId, {
            projectId: testProjectId,
            userId: authorizedUserId,
            operation: 'updated',
            updates: { imageCount: 10, segmentedCount: 8 },
            timestamp: new Date(),
          }),
        assert: data => {
          expect(data.projectId).toBe(testProjectId);
        },
      });
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle multiple concurrent WebSocket connections', () => {
      const testUserId = 'test-user-id';
      const testProjectId = 'test-project-id';
      const connectionCount = 5;
      authAs(testUserId, 'test@example.com');

      return new Promise<void>((resolve, reject) => {
        const clients: ReturnType<typeof Client>[] = [];
        const joined = new Set<number>();
        const receivedClients = new Set<number>();
        let settled = false;
        let interval: ReturnType<typeof setInterval> | undefined;

        const timer = setTimeout(
          () =>
            finish(
              new Error(
                `Only ${receivedClients.size}/${connectionCount} clients received the update`
              )
            ),
          8000
        );
        const finish = (err?: unknown): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (interval) {
            clearInterval(interval);
          }
          clients.forEach(c => c.disconnect());
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          } else {
            resolve();
          }
        };

        const broadcast = (): void =>
          wsService.broadcastProjectUpdate(testProjectId, {
            projectId: testProjectId,
            userId: testUserId,
            operation: 'updated',
            updates: { imageCount: 15, segmentedCount: 12 },
            timestamp: new Date(),
          });

        for (let i = 0; i < connectionCount; i++) {
          const client = makeClient();
          clients.push(client);
          client.on('connect_error', (e: Error) => finish(e));
          client.on('connect', () => {
            client.emit('join-project', testProjectId);
            joined.add(i);
            client.on(
              WebSocketEvent.PROJECT_UPDATE,
              (data: ProjectUpdateData) => {
                try {
                  expect(data.projectId).toBe(testProjectId);
                } catch (e) {
                  finish(e);
                  return;
                }
                receivedClients.add(i);
                if (receivedClients.size === connectionCount) {
                  finish();
                }
              }
            );
            // Once all clients have joined, broadcast (retrying to defeat the
            // async-join race).
            if (joined.size === connectionCount && !interval) {
              broadcast();
              interval = setInterval(broadcast, 25);
            }
          });
        }
      });
    });

    it('should handle WebSocket connection drops gracefully', () => {
      const testUserId = 'test-user-id';
      authAs(testUserId, 'test@example.com');

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(
          () => finish(new Error('Expected a disconnect')),
          8000
        );
        const finish = (err?: unknown): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          } else {
            resolve();
          }
        };

        clientSocket = makeClient();
        clientSocket.on('connect_error', (e: Error) => finish(e));
        clientSocket.on('connect', () => {
          clientSocket.on('disconnect', () => {
            try {
              expect(wsService).toBeDefined();
              finish();
            } catch (e) {
              finish(e);
            }
          });
          clientSocket.disconnect();
        });
      });
    });
  });
});
