import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { Server as HTTPServer, createServer } from 'http';
// import { Server as SocketIOServer } from 'socket.io';
import Client from 'socket.io-client';
import express from 'express';

// Mock Prisma client with comprehensive methods
type MockPrismaClient = {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  project: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  image: {
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  segmentation: {
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

// `vi.hoisted` so the object exists before the hoisted `vi.mock('../../db')`
// factory runs (userService imports `../db` at module top).
const prismaMock: MockPrismaClient = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  project: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    // isValidProjectAccess() (gating join-project) queries findFirst.
    findFirst: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  image: {
    create: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  segmentation: {
    create: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

// Mock authentication middleware
const mockAuthMiddleware = vi.hoisted(() =>
  vi.fn((req: any, res: any, next: any) => {
    req.user = { id: 'test-user-id', email: 'test@example.com' };
    next();
  })
);

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
vi.mock('../../middleware/auth', () => ({
  requireAuth: mockAuthMiddleware,
}));
vi.mock('jsonwebtoken', () => ({
  verify: vi.fn(),
  sign: vi.fn(),
  default: {
    verify: vi.fn(),
    sign: vi.fn(),
  },
}));
// websocketService imports authCookies → config, whose real parser
// process.exit's on a missing test env. Stub it.
vi.mock('../../utils/config', () => ({
  config: { UPLOAD_DIR: '/tmp/test-uploads', NODE_ENV: 'test' },
}));
// getProjectStats() gates on SharingService.hasProjectAccess(); grant access.
vi.mock('../../services/sharingService', () => ({
  hasProjectAccess: vi.fn().mockResolvedValue({ hasAccess: true }),
}));

/**
 * Adapts a jest-style `done` callback test/hook to vitest v4 (which dropped the
 * `done` parameter). The body is unchanged: it still calls `done()` on success
 * or `done(err)` on failure. A timeout backstop rejects fast instead of hanging
 * for the full test timeout if an awaited event never fires.
 */
function wsTest(
  fn: (done: (err?: unknown) => void) => void,
  timeoutMs = 10000
): () => Promise<void> {
  return () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`wsTest timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      let settled = false;
      const done = (err?: unknown): void => {
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
      try {
        fn(done);
      } catch (err) {
        done(err);
      }
    });
}

/**
 * Resolve once `socket` has actually joined the project room. The service emits
 * no join ack, but socket.io processes a socket's events FIFO, so a follow-up
 * `request-queue-stats` — which the server answers with `queue-stats-error`
 * because no QueueService is attached in these tests — confirms the earlier
 * `join-project` has been processed. This removes the race where an
 * HTTP-triggered project broadcast outruns the async room join.
 */
function joinProject(socket: any, projectId: string): Promise<void> {
  return new Promise(resolve => {
    socket.once('queue-stats-error', () => resolve());
    socket.emit('join-project', projectId);
    socket.emit('request-queue-stats', projectId);
  });
}

// Import after mocking
import { WebSocketService } from '../../services/websocketService';
import { getUserStats } from '../../services/userService';
import { getProjectStats } from '../../services/projectService';
import * as sharingService from '../../services/sharingService';
import {
  WebSocketEvent,
  ProjectUpdateData,
  SegmentationUpdateData,
} from '../../types/websocket';
import jwt from 'jsonwebtoken';

describe('Dashboard Metrics Integration Tests', () => {
  let httpServer: HTTPServer;
  let wsService: WebSocketService;
  let app: express.Application;
  let clientSocket: any;
  let port: number;

  const testUserId = 'test-user-id';
  const testProjectId = 'test-project-id';
  const testImageId = 'test-image-id';
  const mockToken = 'valid-jwt-token';

  beforeEach(wsTest(done => {
    // Clear any leftover mockResolvedValueOnce queues from a prior test
    // (clearMocks/restoreMocks do not drain the "once" queue, so a leftover
    // value would bleed into the next test's getUserStats() call sequence).
    vi.resetAllMocks();
    mockAuthMiddleware.mockImplementation((req: any, res: any, next: any) => {
      req.user = { id: testUserId, email: 'test@example.com' };
      next();
    });
    (sharingService.hasProjectAccess as Mock).mockResolvedValue({
      hasAccess: true,
    } as never);

    // Grant project-room access so `join-project` succeeds (isValidProjectAccess
    // queries findFirst). Returning a truthy row = access granted.
    prismaMock.project.findFirst.mockResolvedValue({
      id: testProjectId,
      userId: testUserId,
    } as never);

    // Create Express app with routes
    app = express();
    app.use(express.json());

    // Dashboard metrics endpoint
    app.get(
      '/api/dashboard/metrics',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const userId = req.user.id;
          const stats = await getUserStats(userId);
          res.json({
            success: true,
            data: {
              ...stats,
              efficiency:
                stats.totalImages > 0
                  ? Math.round(
                      (stats.processedImages / stats.totalImages) * 100
                    )
                  : 0,
              lastUpdated: new Date().toISOString(),
            },
          });
        } catch (_error) {
          res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard metrics',
          });
        }
      }
    );

    // Project stats endpoint
    app.get(
      '/api/projects/:projectId/stats',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const userId = req.user.id;
          const projectId = req.params.projectId;
          const stats = await getProjectStats(projectId, userId);
          if (!stats) {
            return res.status(404).json({
              success: false,
              error: 'Project not found',
            });
          }
          res.json({ success: true, data: stats });
        } catch (_error) {
          res.status(500).json({
            success: false,
            error: 'Failed to fetch project statistics',
          });
        }
      }
    );

    // Image upload simulation endpoint
    app.post(
      '/api/projects/:projectId/images',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const projectId = req.params.projectId;
          const userId = req.user.id;

          // Simulate image upload
          const newImage = {
            id: `img-${Date.now()}`,
            name: req.body.name || 'test-image.jpg',
            projectId,
            createdAt: new Date(),
            segmentationStatus: 'pending',
          };

          prismaMock.image.create.mockResolvedValueOnce(newImage);

          // Emit WebSocket update
          const updateData: ProjectUpdateData = {
            projectId,
            userId,
            operation: 'updated',
            updates: {
              imageCount: req.body.newImageCount || 1,
              segmentedCount: req.body.newSegmentedCount || 0,
            },
            timestamp: new Date(),
          };

          wsService.broadcastProjectUpdate(projectId, updateData);

          res.json({
            success: true,
            data: newImage,
          });
        } catch (_error) {
          res.status(500).json({
            success: false,
            error: 'Upload failed',
          });
        }
      }
    );

    // Image deletion simulation endpoint
    app.delete(
      '/api/images/:imageId',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const imageId = req.params.imageId;
          const userId = req.user.id;

          // Simulate image deletion
          prismaMock.image.delete.mockResolvedValueOnce({ id: imageId });

          // Emit WebSocket update
          const updateData: ProjectUpdateData = {
            projectId: testProjectId,
            userId,
            operation: 'updated',
            updates: {
              imageCount: req.body.newImageCount || 0,
              segmentedCount: req.body.newSegmentedCount || 0,
            },
            timestamp: new Date(),
          };

          wsService.broadcastProjectUpdate(testProjectId, updateData);

          res.json({
            success: true,
            data: { id: imageId },
          });
        } catch (_error) {
          res.status(500).json({
            success: false,
            error: 'Deletion failed',
          });
        }
      }
    );

    // Segmentation completion simulation endpoint
    app.post(
      '/api/images/:imageId/segmentation/complete',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const imageId = req.params.imageId;
          const userId = req.user.id;

          // Update image status
          prismaMock.image.update.mockResolvedValueOnce({
            id: imageId,
            segmentationStatus: 'completed',
          });

          // Create segmentation record
          const segmentation = {
            id: `seg-${Date.now()}`,
            imageId,
            polygonCount: req.body.polygonCount || 5,
            createdAt: new Date(),
          };
          prismaMock.segmentation.create.mockResolvedValueOnce(segmentation);

          // Emit segmentation completion
          const segmentationUpdate: SegmentationUpdateData = {
            imageId,
            projectId: testProjectId,
            status: 'completed',
            polygonCount: segmentation.polygonCount,
          };

          wsService.emitSegmentationUpdate(userId, segmentationUpdate);

          // Emit project update
          const projectUpdate: ProjectUpdateData = {
            projectId: testProjectId,
            userId,
            operation: 'updated',
            updates: {
              segmentedCount: req.body.newSegmentedCount || 1,
            },
            timestamp: new Date(),
          };

          wsService.broadcastProjectUpdate(testProjectId, projectUpdate);

          res.json({
            success: true,
            data: segmentation,
          });
        } catch (_error) {
          res.status(500).json({
            success: false,
            error: 'Segmentation completion failed',
          });
        }
      }
    );

    // Create HTTP server
    httpServer = createServer(app);
    wsService = new WebSocketService(httpServer, prismaMock as any);

    httpServer.listen(() => {
      const address = httpServer.address();
      if (address && typeof address === 'object') {
        port = address.port;
      } else {
        port = 3001;
      }
      done();
    });
  }));

  afterEach(wsTest(done => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
    httpServer.close(done);
  }));

  describe('Complete Image Upload → Statistics Update → WebSocket Event Flow', () => {
    it('should update metrics and emit events when image is uploaded', wsTest(done => {
      // Mock initial state
      prismaMock.project.count.mockResolvedValue(2);
      prismaMock.image.count
        .mockResolvedValueOnce(0) // Initial total images
        .mockResolvedValueOnce(0) // Initial processed images
        .mockResolvedValueOnce(0) // Initial today images
        .mockResolvedValueOnce(1) // After upload total images
        .mockResolvedValueOnce(0) // After upload processed images
        .mockResolvedValueOnce(1); // After upload today images
      prismaMock.segmentation.count.mockResolvedValue(0);
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: 1024 * 1024 }, // 1MB
      });

      // Mock JWT verification
      (jwt.verify as Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        extraHeaders: { cookie: `access_token=${mockToken}` },
      });

      clientSocket.on('connect', async () => {
        // Join project room
        await joinProject(clientSocket, testProjectId);

        let projectUpdateReceived = false;
        let metricsBeforeUpload: any;
        let metricsAfterUpload: any;

        // Listen for PROJECT_UPDATE events
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');
            expect(data.updates?.imageCount).toBe(1);
            projectUpdateReceived = true;

            // Get updated metrics after WebSocket event
            request(app)
              .get('/api/dashboard/metrics')
              .expect(200)
              .then(response => {
                metricsAfterUpload = response.body.data;

                // Verify metrics were updated
                expect(metricsAfterUpload.totalImages).toBeGreaterThan(
                  metricsBeforeUpload.totalImages
                );
                expect(metricsAfterUpload.imagesUploadedToday).toBeGreaterThan(
                  metricsBeforeUpload.imagesUploadedToday
                );
                expect(projectUpdateReceived).toBe(true);

                done();
              })
              .catch(done);
          }
        );

        // Get initial metrics
        request(app)
          .get('/api/dashboard/metrics')
          .expect(200)
          .then(response => {
            metricsBeforeUpload = response.body.data;

            // Simulate image upload
            return request(app)
              .post(`/api/projects/${testProjectId}/images`)
              .send({
                name: 'test-upload.jpg',
                newImageCount: 1,
                newSegmentedCount: 0,
              })
              .expect(200);
          })
          .catch(done);
      });
    }));

    it('should handle segmentation completion flow with accurate statistics', wsTest(done => {
      // Mock state with one image pending segmentation
      prismaMock.project.count.mockResolvedValue(1);
      // The flow fetches dashboard metrics (getUserStats) then project stats
      // (getProjectStats) exactly once each, in that order.
      prismaMock.image.count
        .mockResolvedValueOnce(1) // getUserStats: total images
        .mockResolvedValueOnce(1) // getUserStats: processed images
        .mockResolvedValueOnce(0) // getUserStats: images uploaded today
        .mockResolvedValueOnce(1); // getProjectStats: project total images
      prismaMock.segmentation.count
        .mockResolvedValueOnce(1) // getUserStats: total segmentations
        .mockResolvedValueOnce(1); // getProjectStats: project segmentations
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: 2 * 1024 * 1024 }, // 2MB
      });

      // Mock project stats query
      prismaMock.project.findUnique.mockResolvedValue({
        id: testProjectId,
        title: 'Test Project',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prismaMock.image.groupBy.mockResolvedValue([
        { segmentationStatus: 'completed', _count: { id: 1 } },
      ]);

      // Mock JWT
      (jwt.verify as Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        extraHeaders: { cookie: `access_token=${mockToken}` },
      });

      clientSocket.on('connect', async () => {
        await joinProject(clientSocket, testProjectId);

        let segmentationEventReceived = false;
        let projectUpdateReceived = false;

        // Listen for segmentation completion
        clientSocket.on(
          WebSocketEvent.SEGMENTATION_UPDATE,
          (data: SegmentationUpdateData) => {
            expect(data.imageId).toBe(testImageId);
            expect(data.status).toBe('completed');
            expect(data.polygonCount).toBe(8);
            segmentationEventReceived = true;

            checkCompletion();
          }
        );

        // Listen for project update
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.updates?.segmentedCount).toBe(1);
            projectUpdateReceived = true;

            checkCompletion();
          }
        );

        function checkCompletion() {
          if (segmentationEventReceived && projectUpdateReceived) {
            // Verify dashboard metrics reflect the changes
            request(app)
              .get('/api/dashboard/metrics')
              .expect(200)
              .then(response => {
                const metrics = response.body.data;
                expect(metrics.processedImages).toBe(1);
                expect(metrics.totalSegmentations).toBe(1);
                expect(metrics.efficiency).toBe(100); // 1/1 * 100

                // Verify project stats
                return request(app)
                  .get(`/api/projects/${testProjectId}/stats`)
                  .expect(200);
              })
              .then(response => {
                const projectStats = response.body.data;
                expect(projectStats.progress.completionPercentage).toBe(100);
                expect(projectStats.progress.completedImages).toBe(1);
                expect(projectStats.images.byStatus.completed).toBe(1);

                done();
              })
              .catch(done);
          }
        }

        // Trigger segmentation completion
        request(app)
          .post(`/api/images/${testImageId}/segmentation/complete`)
          .send({
            polygonCount: 8,
            newSegmentedCount: 1,
          })
          .expect(200)
          .catch(done);
      });
    }));

    it('should handle image deletion with accurate count updates', wsTest(done => {
      // Mock state with images to delete
      prismaMock.project.count.mockResolvedValue(1);
      prismaMock.image.count
        // Only dashboard metrics are fetched (getUserStats once): total,
        // processed, today.
        .mockResolvedValueOnce(2) // total images (after deletion)
        .mockResolvedValueOnce(1) // processed images
        .mockResolvedValueOnce(1); // images uploaded today
      prismaMock.segmentation.count.mockResolvedValueOnce(1); // total segmentations
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: 1.5 * 1024 * 1024 }, // 1.5MB after deletion
      });

      // Mock JWT
      (jwt.verify as Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        extraHeaders: { cookie: `access_token=${mockToken}` },
      });

      clientSocket.on('connect', async () => {
        await joinProject(clientSocket, testProjectId);

        let projectUpdateReceived = false;

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');
            expect(data.updates?.imageCount).toBe(2); // Decreased after deletion
            projectUpdateReceived = true;

            // Verify metrics after deletion
            request(app)
              .get('/api/dashboard/metrics')
              .expect(200)
              .then(response => {
                const metrics = response.body.data;
                expect(metrics.totalImages).toBe(2); // Decreased
                expect(metrics.processedImages).toBe(1); // Decreased
                expect(metrics.totalSegmentations).toBe(1); // Decreased
                expect(metrics.efficiency).toBe(50); // 1/2 * 100

                done();
              })
              .catch(done);
          }
        );

        // Trigger image deletion
        request(app)
          .delete(`/api/images/${testImageId}`)
          .send({
            newImageCount: 2,
            newSegmentedCount: 1,
          })
          .expect(200)
          .catch(done);
      });
    }));
  });

  describe('Dashboard Metrics Accuracy with Real Database Data', () => {
    it('should provide accurate metrics with complex project scenarios', wsTest(done => {
      // Mock complex scenario: 3 projects, mixed segmentation statuses
      const mockComplexData = {
        projects: 3,
        totalImages: 25,
        processedImages: 18,
        todayImages: 5,
        totalSegmentations: 22,
        storageBytes: 50 * 1024 * 1024, // 50MB
      };

      prismaMock.project.count.mockResolvedValue(mockComplexData.projects);
      prismaMock.image.count
        .mockResolvedValueOnce(mockComplexData.totalImages)
        .mockResolvedValueOnce(mockComplexData.processedImages)
        .mockResolvedValueOnce(mockComplexData.todayImages);
      prismaMock.segmentation.count.mockResolvedValue(
        mockComplexData.totalSegmentations
      );
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: mockComplexData.storageBytes },
      });

      request(app)
        .get('/api/dashboard/metrics')
        .expect(200)
        .then(response => {
          const metrics = response.body.data;

          // Verify all calculations are accurate
          expect(metrics.totalProjects).toBe(mockComplexData.projects);
          expect(metrics.totalImages).toBe(mockComplexData.totalImages);
          expect(metrics.processedImages).toBe(mockComplexData.processedImages);
          expect(metrics.imagesUploadedToday).toBe(mockComplexData.todayImages);
          expect(metrics.totalSegmentations).toBe(
            mockComplexData.totalSegmentations
          );

          // Verify efficiency calculation
          const expectedEfficiency = Math.round(
            (mockComplexData.processedImages / mockComplexData.totalImages) *
              100
          );
          expect(metrics.efficiency).toBe(expectedEfficiency);

          // Verify storage formatting
          expect(metrics.storageUsedBytes).toBeGreaterThan(0);
          expect(metrics.storageUsed).toMatch(/MB|GB/);

          // Verify timestamp
          expect(metrics.lastUpdated).toBeDefined();
          expect(new Date(metrics.lastUpdated)).toBeInstanceOf(Date);

          done();
        })
        .catch(done);
    }));

    it('should handle edge cases in metrics calculation', wsTest(done => {
      // Test edge case: no data
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.image.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prismaMock.segmentation.count.mockResolvedValue(0);
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: null },
      });

      request(app)
        .get('/api/dashboard/metrics')
        .expect(200)
        .then(response => {
          const metrics = response.body.data;

          expect(metrics.totalProjects).toBe(0);
          expect(metrics.totalImages).toBe(0);
          expect(metrics.processedImages).toBe(0);
          expect(metrics.imagesUploadedToday).toBe(0);
          expect(metrics.totalSegmentations).toBe(0);
          expect(metrics.efficiency).toBe(0); // Should handle division by zero
          expect(metrics.storageUsedBytes).toBe(0);
          expect(metrics.storageUsed).toBe('0 B');

          done();
        })
        .catch(done);
    }));
  });

  describe('Project Card Data Consistency', () => {
    it('should ensure project card statistics match dashboard metrics', wsTest(done => {
      // Mock consistent data across endpoints
      const _consistentData = {
        projectCount: 2,
        totalImages: 15,
        completedImages: 12,
        totalSegmentations: 14,
      };

      // Mock project stats
      prismaMock.project.findUnique.mockResolvedValue({
        id: testProjectId,
        title: 'Test Project',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prismaMock.image.groupBy.mockResolvedValue([
        { segmentationStatus: 'completed', _count: { id: 12 } },
        { segmentationStatus: 'pending', _count: { id: 3 } },
      ]);

      prismaMock.image.count.mockResolvedValue(15);
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: 30 * 1024 * 1024 },
      });
      prismaMock.segmentation.count.mockResolvedValue(14);

      // Dashboard metrics mocks
      prismaMock.project.count.mockResolvedValue(2);

      Promise.all([
        request(app).get('/api/dashboard/metrics'),
        request(app).get(`/api/projects/${testProjectId}/stats`),
      ])
        .then(([dashboardResponse, projectResponse]) => {
          const dashboardMetrics = dashboardResponse.body.data;
          const projectStats = projectResponse.body.data;

          // Verify consistency between endpoints
          expect(dashboardMetrics.totalProjects).toBe(2);
          expect(projectStats.images.total).toBe(15);
          expect(projectStats.images.byStatus.completed).toBe(12);
          expect(projectStats.segmentations.total).toBe(14);

          // Verify project completion percentage
          expect(projectStats.progress.completionPercentage).toBe(80); // 12/15 * 100

          done();
        })
        .catch(done);
    }));
  });

  describe('Performance Tests', () => {
    it('should handle concurrent requests efficiently', wsTest(done => {
      // Mock data for performance test
      prismaMock.project.count.mockResolvedValue(10);
      prismaMock.image.count.mockResolvedValue(100);
      prismaMock.segmentation.count.mockResolvedValue(80);
      prismaMock.image.aggregate.mockResolvedValue({
        _sum: { fileSize: 100 * 1024 * 1024 },
      });

      const requestCount = 10;
      const startTime = Date.now();

      const promises = Array(requestCount)
        .fill(null)
        .map(() => request(app).get('/api/dashboard/metrics').expect(200));

      Promise.all(promises)
        .then(responses => {
          const endTime = Date.now();
          const duration = endTime - startTime;

          // Verify all requests succeeded
          responses.forEach(response => {
            expect(response.body.success).toBe(true);
            expect(response.body.data.totalProjects).toBe(10);
          });

          // Verify reasonable performance (should complete in under 5 seconds)
          expect(duration).toBeLessThan(5000);

          done();
        })
        .catch(done);
    }));
  });
});
