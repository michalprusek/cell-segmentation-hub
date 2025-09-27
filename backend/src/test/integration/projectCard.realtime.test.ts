import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import request from 'supertest';
import { Server as HTTPServer, createServer } from 'http';
import Client from 'socket.io-client';
import express from 'express';

// Mock Prisma client for project card testing
type MockPrismaClient = {
  user: {
    findUnique: ReturnType<typeof jest.fn>;
  };
  project: {
    findMany: ReturnType<typeof jest.fn>;
    findUnique: ReturnType<typeof jest.fn>;
    count: ReturnType<typeof jest.fn>;
    groupBy: ReturnType<typeof jest.fn>;
    create: ReturnType<typeof jest.fn>;
    update: ReturnType<typeof jest.fn>;
  };
  image: {
    create: ReturnType<typeof jest.fn>;
    delete: ReturnType<typeof jest.fn>;
    count: ReturnType<typeof jest.fn>;
    aggregate: ReturnType<typeof jest.fn>;
    groupBy: ReturnType<typeof jest.fn>;
    update: ReturnType<typeof jest.fn>;
    findMany: ReturnType<typeof jest.fn>;
  };
  segmentation: {
    create: ReturnType<typeof jest.fn>;
    count: ReturnType<typeof jest.fn>;
  };
  shares: {
    findMany: ReturnType<typeof jest.fn>;
  };
};

const prismaMock: MockPrismaClient = {
  user: {
    findUnique: jest.fn(),
  },
  project: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  image: {
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  segmentation: {
    create: jest.fn(),
    count: jest.fn(),
  },
  shares: {
    findMany: jest.fn(),
  },
};

// Mock authentication middleware
const mockAuthMiddleware = jest.fn((req: any, res: any, next: any) => {
  req.user = { id: 'test-user-id', email: 'test@example.com' };
  next();
});

// Mock dependencies
jest.mock('../../db', () => ({
  prisma: prismaMock,
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../middleware/auth', () => ({
  requireAuth: mockAuthMiddleware,
}));
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(),
  default: {
    verify: jest.fn(),
    sign: jest.fn(),
  },
}));

// Mock sharing service
jest.mock('../../services/sharingService', () => ({
  hasProjectAccess: jest.fn().mockResolvedValue({ hasAccess: true }),
}));

// Import after mocking
import { WebSocketService } from '../../services/websocketService';
import { getUserProjects } from '../../services/projectService';
import {
  WebSocketEvent,
  ProjectUpdateData,
  SegmentationUpdateData,
  // getProjectRoom,
  // getUserRoom
} from '../../types/websocket';
import jwt from 'jsonwebtoken';

describe('Project Card Real-time Updates', () => {
  let httpServer: HTTPServer;
  let wsService: WebSocketService;
  let app: express.Application;
  let clientSocket: any;
  let port: number;

  const testUserId = 'test-user-id';
  const testProjectId = 'test-project-id';
  const testImageId = 'test-image-id';
  const mockToken = 'valid-jwt-token';

  beforeEach(done => {
    // Create Express app with project card endpoints
    app = express();
    app.use(express.json());

    // Projects list endpoint (for project cards)
    app.get('/api/projects', mockAuthMiddleware, async (req: any, res: any) => {
      try {
        const userId = req.user.id;
        const options = {
          page: parseInt(req.query.page) || 1,
          limit: parseInt(req.query.limit) || 10,
          search: req.query.search || '',
          sortBy: req.query.sortBy || 'updatedAt',
          sortOrder: req.query.sortOrder || 'desc',
        };

        const result = await getUserProjects(userId, options);
        res.json({
          success: true,
          data: result,
        });
      } catch (_error) {
        res.status(500).json({
          success: false,
          error: 'Failed to fetch projects',
        });
      }
    });

    // Single project endpoint with enhanced metadata
    app.get(
      '/api/projects/:projectId',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const projectId = req.params.projectId;
          const userId = req.user.id;

          // Mock project with enhanced project card data
          const project = {
            id: projectId,
            title: 'Test Project',
            description: 'Test Description',
            userId,
            createdAt: new Date(),
            updatedAt: new Date(),
            imageCount: 15,
            segmentedCount: 12,
            processingCount: 2,
            pendingCount: 1,
            failedCount: 0,
            completionPercentage: 80,
            thumbnailUrl: `/api/images/${testImageId}/display`,
            lastActivity: new Date(),
            isOwned: true,
            isShared: false,
            owner: {
              id: userId,
              email: 'test@example.com',
            },
          };

          res.json({
            success: true,
            data: project,
          });
        } catch (_error) {
          res.status(500).json({
            success: false,
            error: 'Failed to fetch project',
          });
        }
      }
    );

    // Image upload endpoint that triggers project card updates
    app.post(
      '/api/projects/:projectId/images',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const projectId = req.params.projectId;
          const userId = req.user.id;

          // Create new image
          const newImage = {
            id: `img-${Date.now()}`,
            name: req.body.name || 'test-image.jpg',
            projectId,
            segmentationStatus: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            thumbnailPath: `/uploads/thumbnails/thumb-${Date.now()}.jpg`,
          };

          prismaMock.image.create.mockResolvedValueOnce(newImage);

          // Calculate new project stats
          const newImageCount = req.body.newImageCount || 1;
          const newSegmentedCount = req.body.newSegmentedCount || 0;
          const newCompletionPercentage =
            newImageCount > 0
              ? Math.round((newSegmentedCount / newImageCount) * 100)
              : 0;

          // Emit project update with enhanced metadata
          const updateData: ProjectUpdateData = {
            projectId,
            userId,
            operation: 'updated',
            updates: {
              imageCount: newImageCount,
              segmentedCount: newSegmentedCount,
              completionPercentage: newCompletionPercentage,
              lastActivity: new Date().toISOString(),
              thumbnailUrl: newImage.thumbnailPath,
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
            error: 'Image upload failed',
          });
        }
      }
    );

    // Segmentation completion endpoint
    app.post(
      '/api/images/:imageId/segmentation/complete',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const imageId = req.params.imageId;
          const userId = req.user.id;
          const projectId = req.body.projectId || testProjectId;

          // Create segmentation
          const segmentation = {
            id: `seg-${Date.now()}`,
            imageId,
            polygonCount: req.body.polygonCount || 5,
            model: req.body.model || 'hrnet',
            threshold: req.body.threshold || 0.5,
            detectHoles: req.body.detectHoles || false,
            createdAt: new Date(),
          };

          prismaMock.segmentation.create.mockResolvedValueOnce(segmentation);

          // Update image status
          prismaMock.image.update.mockResolvedValueOnce({
            id: imageId,
            segmentationStatus: 'completed',
            updatedAt: new Date(),
          });

          // Emit segmentation completion
          const segmentationUpdate: SegmentationUpdateData = {
            imageId,
            projectId,
            status: 'completed',
            polygonCount: segmentation.polygonCount,
          };

          wsService.emitSegmentationUpdate(userId, segmentationUpdate);

          // Calculate updated project stats
          const newSegmentedCount = req.body.newSegmentedCount || 1;
          const totalImages = req.body.totalImages || 1;
          const newCompletionPercentage = Math.round(
            (newSegmentedCount / totalImages) * 100
          );

          // Emit project update
          const projectUpdate: ProjectUpdateData = {
            projectId,
            userId,
            operation: 'updated',
            updates: {
              segmentedCount: newSegmentedCount,
              completionPercentage: newCompletionPercentage,
              lastActivity: new Date().toISOString(),
            },
            timestamp: new Date(),
          };

          wsService.broadcastProjectUpdate(projectId, projectUpdate);

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

    // Image deletion endpoint
    app.delete(
      '/api/images/:imageId',
      mockAuthMiddleware,
      async (req: any, res: any) => {
        try {
          const imageId = req.params.imageId;
          const userId = req.user.id;
          const projectId = req.body.projectId || testProjectId;

          prismaMock.image.delete.mockResolvedValueOnce({ id: imageId });

          // Calculate updated project stats after deletion
          const newImageCount = req.body.newImageCount || 0;
          const newSegmentedCount = req.body.newSegmentedCount || 0;
          const newCompletionPercentage =
            newImageCount > 0
              ? Math.round((newSegmentedCount / newImageCount) * 100)
              : 0;

          // Emit project update
          const updateData: ProjectUpdateData = {
            projectId,
            userId,
            operation: 'updated',
            updates: {
              imageCount: newImageCount,
              segmentedCount: newSegmentedCount,
              completionPercentage: newCompletionPercentage,
              lastActivity: new Date().toISOString(),
            },
            timestamp: new Date(),
          };

          wsService.broadcastProjectUpdate(projectId, updateData);

          res.json({
            success: true,
            data: { id: imageId },
          });
        } catch (_error) {
          res.status(500).json({
            success: false,
            error: 'Image deletion failed',
          });
        }
      }
    );

    // Create HTTP server and WebSocket service
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
  });

  afterEach(done => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
    httpServer.close(done);
  });

  describe('Project Card Real-time Statistics Updates', () => {
    it('should update project card statistics when image is uploaded', done => {
      // Mock initial project data
      const _initialProject = {
        id: testProjectId,
        title: 'Test Project',
        imageCount: 5,
        segmentedCount: 3,
        completionPercentage: 60,
        lastActivity: new Date(),
      };

      // Mock JWT verification
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        // Join project room for updates
        clientSocket.emit('join-project', testProjectId);

        let projectUpdateReceived = false;

        // Listen for PROJECT_UPDATE events
        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');
            expect(data.updates?.imageCount).toBe(6); // Increased from 5 to 6
            expect(data.updates?.segmentedCount).toBe(3); // Unchanged
            expect(data.updates?.completionPercentage).toBe(50); // 3/6 * 100 = 50%
            expect(data.updates?.lastActivity).toBeDefined();
            expect(data.updates?.thumbnailUrl).toBeDefined();

            projectUpdateReceived = true;

            // Verify project card data is updated
            request(app)
              .get(`/api/projects/${testProjectId}`)
              .expect(200)
              .then(response => {
                const project = response.body.data;
                expect(project.imageCount).toBe(6);
                expect(project.completionPercentage).toBe(50);
                expect(projectUpdateReceived).toBe(true);
                done();
              })
              .catch(done);
          }
        );

        // Trigger image upload
        request(app)
          .post(`/api/projects/${testProjectId}/images`)
          .send({
            name: 'new-test-image.jpg',
            newImageCount: 6,
            newSegmentedCount: 3,
          })
          .expect(200)
          .catch(done);
      });
    });

    it('should update completion percentage when segmentation completes', done => {
      // Mock JWT
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join-project', testProjectId);

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
            expect(data.updates?.segmentedCount).toBe(4); // Increased
            expect(data.updates?.completionPercentage).toBe(80); // 4/5 * 100
            expect(data.updates?.lastActivity).toBeDefined();
            projectUpdateReceived = true;
            checkCompletion();
          }
        );

        function checkCompletion() {
          if (segmentationEventReceived && projectUpdateReceived) {
            // Verify project card reflects the completion
            request(app)
              .get(`/api/projects/${testProjectId}`)
              .expect(200)
              .then(response => {
                const project = response.body.data;
                expect(project.segmentedCount).toBe(4);
                expect(project.completionPercentage).toBe(80);
                done();
              })
              .catch(done);
          }
        }

        // Trigger segmentation completion
        request(app)
          .post(`/api/images/${testImageId}/segmentation/complete`)
          .send({
            projectId: testProjectId,
            polygonCount: 8,
            model: 'hrnet',
            newSegmentedCount: 4,
            totalImages: 5,
          })
          .expect(200)
          .catch(done);
      });
    });

    it('should update project card after image deletion', done => {
      // Mock JWT
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join-project', testProjectId);

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');
            expect(data.updates?.imageCount).toBe(4); // Decreased from 5 to 4
            expect(data.updates?.segmentedCount).toBe(3); // Decreased from 4 to 3
            expect(data.updates?.completionPercentage).toBe(75); // 3/4 * 100
            expect(data.updates?.lastActivity).toBeDefined();

            // Verify project card data
            request(app)
              .get(`/api/projects/${testProjectId}`)
              .expect(200)
              .then(response => {
                const project = response.body.data;
                expect(project.imageCount).toBe(4);
                expect(project.segmentedCount).toBe(3);
                expect(project.completionPercentage).toBe(75);
                done();
              })
              .catch(done);
          }
        );

        // Trigger image deletion
        request(app)
          .delete(`/api/images/${testImageId}`)
          .send({
            projectId: testProjectId,
            newImageCount: 4,
            newSegmentedCount: 3,
          })
          .expect(200)
          .catch(done);
      });
    });
  });

  describe('Project Card Thumbnail URL Generation', () => {
    it('should update thumbnail URL when new image is uploaded', done => {
      // Mock JWT
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join-project', testProjectId);

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.updates?.thumbnailUrl).toBeDefined();
            expect(data.updates?.thumbnailUrl).toMatch(
              /\/uploads\/thumbnails\/thumb-\d+\.jpg/
            );

            // Verify project card has updated thumbnail
            request(app)
              .get(`/api/projects/${testProjectId}`)
              .expect(200)
              .then(response => {
                const project = response.body.data;
                expect(project.thumbnailUrl).toMatch(
                  /\/api\/images\/.*\/display/
                );
                done();
              })
              .catch(done);
          }
        );

        // Upload image with specific thumbnail
        request(app)
          .post(`/api/projects/${testProjectId}/images`)
          .send({
            name: 'new-image-with-thumb.jpg',
            newImageCount: 1,
            newSegmentedCount: 0,
          })
          .expect(200)
          .catch(done);
      });
    });

    it('should generate fallback thumbnail URL when needed', done => {
      // Test project card thumbnail URL generation
      request(app)
        .get(`/api/projects/${testProjectId}`)
        .expect(200)
        .then(response => {
          const project = response.body.data;

          // Should have a valid thumbnail URL (either from path or display endpoint)
          expect(project.thumbnailUrl).toBeDefined();
          expect(project.thumbnailUrl).toMatch(
            /\/api\/images\/.*\/display|\/uploads\//
          );

          done();
        })
        .catch(done);
    });
  });

  describe('Project Card Last Activity Tracking', () => {
    it('should update lastActivity timestamp on operations', done => {
      // Mock JWT
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join-project', testProjectId);

        const beforeTime = new Date();

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.updates?.lastActivity).toBeDefined();

            const lastActivity = new Date(data.updates!.lastActivity!);
            expect(lastActivity.getTime()).toBeGreaterThanOrEqual(
              beforeTime.getTime()
            );

            done();
          }
        );

        // Trigger any operation that should update lastActivity
        setTimeout(() => {
          request(app)
            .post(`/api/projects/${testProjectId}/images`)
            .send({
              name: 'activity-test.jpg',
              newImageCount: 1,
              newSegmentedCount: 0,
            })
            .expect(200)
            .catch(done);
        }, 10); // Small delay to ensure timestamp difference
      });
    });
  });

  describe('Shared Project Card Updates', () => {
    it('should broadcast updates to shared project collaborators', done => {
      const ownerId = 'project-owner-id';
      const sharedUserId = 'shared-user-id';

      // Mock two different users
      let ownerSocketConnected = false;
      let sharedUserSocketConnected = false;
      let ownerUpdateReceived = false;
      let sharedUserUpdateReceived = false;

      // Owner socket
      (jwt.verify as jest.Mock).mockReturnValueOnce({
        userId: ownerId,
        email: 'owner@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: ownerId,
        email: 'owner@example.com',
      });

      const ownerSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      ownerSocket.on('connect', () => {
        ownerSocketConnected = true;
        ownerSocket.emit('join-project', testProjectId);

        ownerSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.userId).toBe(ownerId);
            ownerUpdateReceived = true;
            checkCompletion();
          }
        );

        checkBothConnected();
      });

      // Shared user socket
      (jwt.verify as jest.Mock).mockReturnValueOnce({
        userId: sharedUserId,
        email: 'shared@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: sharedUserId,
        email: 'shared@example.com',
      });

      const sharedUserSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      sharedUserSocket.on('connect', () => {
        sharedUserSocketConnected = true;
        sharedUserSocket.emit('join-project', testProjectId);

        sharedUserSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            expect(data.projectId).toBe(testProjectId);
            expect(data.userId).toBe(ownerId); // Owner made the change
            sharedUserUpdateReceived = true;
            checkCompletion();
          }
        );

        checkBothConnected();
      });

      function checkBothConnected() {
        if (ownerSocketConnected && sharedUserSocketConnected) {
          // Override auth middleware to simulate owner making change
          mockAuthMiddleware.mockImplementationOnce(
            (req: any, res: any, next: any) => {
              req.user = { id: ownerId, email: 'owner@example.com' };
              next();
            }
          );

          // Owner uploads image
          request(app)
            .post(`/api/projects/${testProjectId}/images`)
            .send({
              name: 'shared-project-image.jpg',
              newImageCount: 1,
              newSegmentedCount: 0,
            })
            .expect(200)
            .catch(done);
        }
      }

      function checkCompletion() {
        if (ownerUpdateReceived && sharedUserUpdateReceived) {
          ownerSocket.disconnect();
          sharedUserSocket.disconnect();
          done();
        }
      }
    });
  });

  describe('Project Card Performance with Multiple Updates', () => {
    it('should handle rapid successive project updates efficiently', done => {
      // Mock JWT
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join-project', testProjectId);

        let updateCount = 0;
        const expectedUpdates = 5;
        const updateTimestamps: Date[] = [];

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            updateCount++;
            updateTimestamps.push(new Date());

            expect(data.projectId).toBe(testProjectId);
            expect(data.operation).toBe('updated');

            if (updateCount === expectedUpdates) {
              // Verify all updates were received
              expect(updateTimestamps).toHaveLength(expectedUpdates);

              // Verify rapid updates were handled (all within reasonable time)
              const totalTime =
                updateTimestamps[expectedUpdates - 1].getTime() -
                updateTimestamps[0].getTime();
              expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds

              done();
            }
          }
        );

        // Send multiple rapid updates
        for (let i = 1; i <= expectedUpdates; i++) {
          setTimeout(() => {
            request(app)
              .post(`/api/projects/${testProjectId}/images`)
              .send({
                name: `rapid-update-${i}.jpg`,
                newImageCount: i,
                newSegmentedCount: Math.floor(i / 2),
              })
              .expect(200)
              .catch(done);
          }, i * 100); // Stagger requests by 100ms
        }
      });
    });

    it('should maintain data consistency across multiple concurrent updates', done => {
      // Mock JWT
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: testUserId,
        email: 'test@example.com',
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: testUserId,
        email: 'test@example.com',
      });

      clientSocket = Client(`http://localhost:${port}`, {
        auth: { token: mockToken },
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join-project', testProjectId);

        let _finalUpdate = false;

        clientSocket.on(
          WebSocketEvent.PROJECT_UPDATE,
          (data: ProjectUpdateData) => {
            // Check for the final update (imageCount = 3)
            if (data.updates?.imageCount === 3) {
              _finalUpdate = true;

              // Verify final state consistency
              expect(data.updates.segmentedCount).toBe(2);
              expect(data.updates.completionPercentage).toBe(
                Math.round((2 / 3) * 100)
              );

              // Verify project card data matches WebSocket update
              request(app)
                .get(`/api/projects/${testProjectId}`)
                .expect(200)
                .then(response => {
                  const project = response.body.data;
                  expect(project.imageCount).toBe(3);
                  expect(project.segmentedCount).toBe(2);
                  expect(project.completionPercentage).toBe(
                    Math.round((2 / 3) * 100)
                  );
                  done();
                })
                .catch(done);
            }
          }
        );

        // Simulate concurrent operations
        Promise.all([
          request(app).post(`/api/projects/${testProjectId}/images`).send({
            name: 'concurrent-1.jpg',
            newImageCount: 1,
            newSegmentedCount: 0,
          }),
          request(app).post(`/api/projects/${testProjectId}/images`).send({
            name: 'concurrent-2.jpg',
            newImageCount: 2,
            newSegmentedCount: 1,
          }),
          request(app).post(`/api/projects/${testProjectId}/images`).send({
            name: 'concurrent-3.jpg',
            newImageCount: 3,
            newSegmentedCount: 2,
          }),
        ]).catch(done);
      });
    });
  });
});
