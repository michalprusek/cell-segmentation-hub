/**
 * WebSocket Service Cancel Integration Tests
 * Tests WebSocket event emission and handling for cancel operations
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import Client from 'socket.io-client';

// TODO: Create test utility files
// import { createWebSocketTestEnvironment as _createWebSocketTestEnvironment } from '@/test-utils/webSocketTestUtils';
// import { cancelTestUtils } from '@/test-utils/cancelTestHelpers';
// import {
//   uploadScenarios,
//   segmentationScenarios,
//   exportScenarios,
// } from '@/test-fixtures/cancelScenarios';

// Temporary mock fixtures until test utils are created
const uploadScenarios = {
  singleFileUpload: { operation: { id: 'upload-001', type: 'upload' as const } },
  multipleFileUpload: { operations: [{ operation: { id: 'upload-002', type: 'upload' as const } }] },
  largeFileUpload: { operation: { id: 'upload-003', type: 'upload' as const, metadata: { fileSize: 10485760, chunksTotal: 100 } } },
};

const segmentationScenarios = {
  singleImageSegmentation: { operation: { id: 'seg-001', type: 'segmentation' as const } },
  batchSegmentation: {
    operations: [
      { metadata: { imageId: 'img-001' } },
      { metadata: { imageId: 'img-002' } },
      { metadata: { imageId: 'img-003' } },
    ],
    queueStats: { completed: 3, total: 3 },
  },
  highVolumeSegmentation: { batchId: 'batch-high-volume', totalImages: 500 },
};

const exportScenarios = {
  cocoExport: { operation: { id: 'export-001', type: 'export' as const, metadata: { format: 'coco' } } },
  largeExport: { operation: { id: 'export-002', type: 'export' as const, metadata: { imageCount: 5000, exportSize: '2.5GB (estimated)' } } },
  parallelExports: {
    operations: [
      { id: 'export-003', metadata: { projectId: 'project-1', format: 'coco' } },
      { id: 'export-004', metadata: { projectId: 'project-2', format: 'yolo' } },
    ],
  },
};

const cancelTestUtils = {
  createTestDataFactories: () => ({
    uploadOperation: () => ({ id: 'upload-factory-001', type: 'upload' as const, progress: 50 }),
    segmentationOperation: () => ({ id: 'seg-factory-001', type: 'segmentation' as const, progress: 75 }),
    exportOperation: () => ({ id: 'export-factory-001', type: 'export' as const, progress: 25 }),
  }),
};

// Mock dependencies
jest.mock('@/db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
    },
  },
}));

/**
 * WebSocket Service Mock (TDD - to be implemented)
 * Handles real-time communication for cancel operations
 */
interface WebSocketServiceConfig {
  cors: {
    origin: string[];
    credentials: boolean;
  };
  transports: string[];
}

interface CancelEvent {
  operationId: string;
  operationType: 'upload' | 'segmentation' | 'export';
  reason?: string;
  timestamp: string;
  userId?: string;
  projectId?: string;
  metadata?: any;
}

class WebSocketService {
  private io: SocketIOServer;
  private userRooms: Map<string, Set<string>> = new Map();
  private projectRooms: Map<string, Set<string>> = new Map();

  constructor(server: any, config: WebSocketServiceConfig) {
    this.io = new SocketIOServer(server, {
      cors: config.cors,
      transports: config.transports as any,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.io.on('connection', socket => {
      console.info(`Client connected: ${socket.id}`);

      socket.on(
        'authenticate',
        async (data: { userId: string; token: string }) => {
          try {
            // Mock authentication
            if (data.token === 'valid-token') {
              socket.data.userId = data.userId;
              socket.join(`user:${data.userId}`);

              // Track user rooms
              if (!this.userRooms.has(data.userId)) {
                this.userRooms.set(data.userId, new Set());
              }
              this.userRooms.get(data.userId)!.add(socket.id);

              socket.emit('authenticated', {
                success: true,
                userId: data.userId,
              });
            } else {
              socket.emit('authError', { error: 'Invalid token' });
            }
          } catch (_error) {
            socket.emit('authError', { error: 'Authentication failed' });
          }
        }
      );

      socket.on('joinProject', (data: { projectId: string }) => {
        const roomName = `project:${data.projectId}`;
        socket.join(roomName);

        // Track project rooms
        if (!this.projectRooms.has(data.projectId)) {
          this.projectRooms.set(data.projectId, new Set());
        }
        this.projectRooms.get(data.projectId)!.add(socket.id);

        socket.emit('joinedProject', { projectId: data.projectId });
      });

      socket.on('leaveProject', (data: { projectId: string }) => {
        const roomName = `project:${data.projectId}`;
        socket.leave(roomName);

        // Remove from project rooms tracking
        const projectSockets = this.projectRooms.get(data.projectId);
        if (projectSockets) {
          projectSockets.delete(socket.id);
          if (projectSockets.size === 0) {
            this.projectRooms.delete(data.projectId);
          }
        }

        socket.emit('leftProject', { projectId: data.projectId });
      });

      socket.on('disconnect', () => {
        console.info(`Client disconnected: ${socket.id}`);

        // Cleanup tracking
        const userId = socket.data.userId;
        if (userId) {
          const userSockets = this.userRooms.get(userId);
          if (userSockets) {
            userSockets.delete(socket.id);
            if (userSockets.size === 0) {
              this.userRooms.delete(userId);
            }
          }
        }

        // Cleanup project rooms
        for (const [projectId, sockets] of this.projectRooms.entries()) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            this.projectRooms.delete(projectId);
          }
        }
      });
    });
  }

  // Cancel operation event emitters
  emitUploadCancelled(userId: string, data: CancelEvent) {
    this.io.to(`user:${userId}`).emit('uploadCancelled', data);
    if (data.projectId) {
      this.io.to(`project:${data.projectId}`).emit('uploadCancelled', data);
    }
  }

  emitSegmentationCancelled(
    userId: string,
    data: CancelEvent & { batchId?: string; imageIds?: string[] }
  ) {
    this.io.to(`user:${userId}`).emit('segmentationCancelled', data);
    if (data.projectId) {
      this.io.to(`project:${data.projectId}`).emit('batchCancelled', data);
    }
  }

  emitExportCancelled(userId: string, data: CancelEvent) {
    this.io.to(`user:${userId}`).emit('exportCancelled', data);
    if (data.projectId) {
      this.io.to(`project:${data.projectId}`).emit('exportCancelled', data);
    }
  }

  emitOperationCancelled(userId: string, data: CancelEvent) {
    this.io.to(`user:${userId}`).emit('operationCancelled', data);
    if (data.projectId) {
      this.io.to(`project:${data.projectId}`).emit('operationCancelled', data);
    }
  }

  // Queue statistics updates
  emitQueueStats(projectId: string, stats: any) {
    this.io.to(`project:${projectId}`).emit('queueStats', stats);
  }

  // Progress updates
  emitProgressUpdate(userId: string, data: any) {
    this.io.to(`user:${userId}`).emit('progressUpdate', data);
  }

  // Error notifications
  emitCancelError(
    userId: string,
    data: { operationId: string; error: string; timestamp: string }
  ) {
    this.io.to(`user:${userId}`).emit('cancelError', data);
  }

  // Utility methods
  getUserConnections(userId: string): number {
    return this.userRooms.get(userId)?.size || 0;
  }

  getProjectConnections(projectId: string): number {
    return this.projectRooms.get(projectId)?.size || 0;
  }

  async close() {
    this.io.close();
  }
}

describe('WebSocket Service Cancel Integration', () => {
  let server: any;
  let wsService: WebSocketService;
  let clientSocket: any;
  let serverAddress: string;

  beforeEach(async () => {
    // Create HTTP server
    server = createServer();

    // Create WebSocket service
    wsService = new WebSocketService(server, {
      cors: {
        origin: ['http://localhost:3000'],
        credentials: true,
      },
      transports: ['websocket'] as string[],
    });

    // Start server
    await new Promise<void>(resolve => {
      server.listen(() => {
        const port = (server.address() as any).port;
        serverAddress = `http://localhost:${port}`;
        resolve();
      });
    });

    // Create client connection
    clientSocket = Client(serverAddress, {
      transports: ['websocket'] as string[],
      autoConnect: false,
    });
  });

  afterEach(async () => {
    if (clientSocket.connected) {
      clientSocket.disconnect();
    }

    await wsService.close();
    server.close();
    jest.clearAllMocks();
  });

  describe('Connection and Authentication', () => {
    it('should handle client connection and authentication', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', (data: any) => {
        expect(data.success).toBe(true);
        expect(data.userId).toBe('user-789');
        done();
      });
    });

    it('should handle authentication errors', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'invalid-token',
        });
      });

      clientSocket.on('authError', (data: any) => {
        expect(data.error).toBe('Invalid token');
        done();
      });
    });

    it('should handle project room joining', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.emit('joinProject', { projectId: 'project-456' });
      });

      clientSocket.on('joinedProject', (data: any) => {
        expect(data.projectId).toBe('project-456');
        done();
      });
    });
  });

  describe('Upload Cancel Events', () => {
    beforeEach(done => {
      clientSocket.connect();
      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.emit('joinProject', { projectId: 'project-456' });
      });

      clientSocket.on('joinedProject', () => {
        done();
      });
    });

    it('should emit upload cancelled events', done => {
      const { operation } = uploadScenarios.singleFileUpload;

      clientSocket.on('uploadCancelled', (data: CancelEvent) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.operationType).toBe('upload');
        expect(data.reason).toBe('User cancelled');
        expect(data.timestamp).toBeDefined();
        done();
      });

      wsService.emitUploadCancelled('user-789', {
        operationId: operation.id,
        operationType: 'upload',
        reason: 'User cancelled',
        timestamp: new Date().toISOString(),
        projectId: 'project-456',
      });
    });

    it('should emit upload cancelled events to project room', done => {
      const { operation } = uploadScenarios.multipleFileUpload.operations[0];

      clientSocket.on('uploadCancelled', (data: CancelEvent) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.projectId).toBe('project-456');
        done();
      });

      wsService.emitUploadCancelled('user-789', {
        operationId: operation.id,
        operationType: 'upload',
        reason: 'Batch cancelled',
        timestamp: new Date().toISOString(),
        projectId: 'project-456',
        metadata: {
          fileName: 'batch_001.jpg',
          fileSize: 1536000,
          batchId: 'batch-upload-123',
        },
      });
    });

    it('should handle large file upload cancellation events', done => {
      const { operation } = uploadScenarios.largeFileUpload;

      clientSocket.on('uploadCancelled', (data: CancelEvent) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.metadata?.fileSize).toBe(operation.metadata.fileSize);
        expect(data.metadata?.chunksTotal).toBe(operation.metadata.chunksTotal);
        done();
      });

      wsService.emitUploadCancelled('user-789', {
        operationId: operation.id,
        operationType: 'upload',
        reason: 'User cancelled large file',
        timestamp: new Date().toISOString(),
        projectId: 'project-456',
        metadata: operation.metadata,
      });
    });
  });

  describe('Segmentation Cancel Events', () => {
    beforeEach(done => {
      clientSocket.connect();
      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.emit('joinProject', { projectId: 'project-456' });
      });

      clientSocket.on('joinedProject', () => {
        done();
      });
    });

    it('should emit segmentation cancelled events', done => {
      const { operation } = segmentationScenarios.singleImageSegmentation;

      clientSocket.on('segmentationCancelled', (data: any) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.operationType).toBe('segmentation');
        expect(data.reason).toBe('User cancelled');
        done();
      });

      wsService.emitSegmentationCancelled('user-789', {
        operationId: operation.id,
        operationType: 'segmentation',
        reason: 'User cancelled',
        timestamp: new Date().toISOString(),
        projectId: 'project-456',
      });
    });

    it('should emit batch cancellation events', done => {
      const { operations, queueStats: _queueStats } =
        segmentationScenarios.batchSegmentation;

      clientSocket.on('batchCancelled', (data: any) => {
        expect(data.operationType).toBe('segmentation');
        expect(data.batchId).toBe('batch-seg-789');
        expect(data.imageIds).toHaveLength(3);
        done();
      });

      wsService.emitSegmentationCancelled('user-789', {
        operationId: 'batch-seg-789',
        operationType: 'segmentation',
        reason: 'Batch cancelled by user',
        timestamp: new Date().toISOString(),
        projectId: 'project-456',
        batchId: 'batch-seg-789',
        imageIds: operations.map(op => op.metadata.imageId),
      });
    });

    it('should emit queue statistics updates after cancellation', done => {
      const { queueStats } = segmentationScenarios.batchSegmentation;

      clientSocket.on('queueStats', (data: any) => {
        expect(data.projectId).toBe('project-456');
        expect(data.queued).toBe(0);
        expect(data.processing).toBe(0);
        expect(data.completed).toBe(queueStats.completed);
        done();
      });

      wsService.emitQueueStats('project-456', {
        projectId: 'project-456',
        queued: 0,
        processing: 0,
        completed: queueStats.completed,
        total: queueStats.total,
      });
    });

    it('should handle high volume batch cancellation events', done => {
      const { totalImages, batchId } =
        segmentationScenarios.highVolumeSegmentation;

      clientSocket.on('batchCancelled', (data: any) => {
        expect(data.batchId).toBe(batchId);
        expect(data.metadata?.totalImages).toBe(totalImages);
        done();
      });

      wsService.emitSegmentationCancelled('user-789', {
        operationId: batchId,
        operationType: 'segmentation',
        reason: 'High volume batch cancelled',
        timestamp: new Date().toISOString(),
        projectId: 'project-high-volume',
        batchId,
        metadata: { totalImages },
      });
    });
  });

  describe('Export Cancel Events', () => {
    beforeEach(done => {
      clientSocket.connect();
      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.emit('joinProject', { projectId: 'project-456' });
      });

      clientSocket.on('joinedProject', () => {
        done();
      });
    });

    it('should emit export cancelled events', done => {
      const { operation } = exportScenarios.cocoExport;

      clientSocket.on('exportCancelled', (data: CancelEvent) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.operationType).toBe('export');
        expect(data.metadata?.format).toBe('coco');
        done();
      });

      wsService.emitExportCancelled('user-789', {
        operationId: operation.id,
        operationType: 'export',
        reason: 'Export cancelled by user',
        timestamp: new Date().toISOString(),
        projectId: 'project-456',
        metadata: operation.metadata,
      });
    });

    it('should emit large export cancellation events', done => {
      const { operation } = exportScenarios.largeExport;

      clientSocket.on('exportCancelled', (data: CancelEvent) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.metadata?.imageCount).toBe(5000);
        expect(data.metadata?.exportSize).toBe('2.5GB (estimated)');
        done();
      });

      wsService.emitExportCancelled('user-789', {
        operationId: operation.id,
        operationType: 'export',
        reason: 'Large export cancelled',
        timestamp: new Date().toISOString(),
        projectId: 'project-large-dataset',
        metadata: operation.metadata,
      });
    });

    it('should handle parallel export cancellations', done => {
      const { operations } = exportScenarios.parallelExports;
      let receivedEvents = 0;

      clientSocket.on('exportCancelled', (data: CancelEvent) => {
        receivedEvents++;
        expect(data.operationType).toBe('export');

        if (receivedEvents === operations.length) {
          done();
        }
      });

      // Emit cancellation for each parallel export
      operations.forEach(operation => {
        wsService.emitExportCancelled('user-789', {
          operationId: operation.id,
          operationType: 'export',
          reason: 'Parallel export cancelled',
          timestamp: new Date().toISOString(),
          projectId: operation.metadata.projectId,
          metadata: operation.metadata,
        });
      });
    });
  });

  describe('Universal Operation Cancel Events', () => {
    beforeEach(done => {
      clientSocket.connect();
      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.emit('joinProject', { projectId: 'project-456' });
      });

      clientSocket.on('joinedProject', () => {
        done();
      });
    });

    it('should emit universal operation cancelled events', done => {
      const operation = cancelTestUtils
        .createTestDataFactories()
        .uploadOperation();

      clientSocket.on('operationCancelled', (data: CancelEvent) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.operationType).toBe(operation.type);
        expect(data.reason).toBe('Universal cancel');
        done();
      });

      wsService.emitOperationCancelled('user-789', {
        operationId: operation.id,
        operationType: operation.type,
        reason: 'Universal cancel',
        timestamp: new Date().toISOString(),
        projectId: 'project-456',
      });
    });

    it('should emit progress updates during cancellation', done => {
      const operation = cancelTestUtils
        .createTestDataFactories()
        .segmentationOperation();

      clientSocket.on('progressUpdate', (data: any) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.status).toBe('cancelling');
        expect(data.progress).toBe(operation.progress);
        done();
      });

      wsService.emitProgressUpdate('user-789', {
        operationId: operation.id,
        status: 'cancelling',
        progress: operation.progress,
        timestamp: new Date().toISOString(),
      });
    });

    it('should emit cancel error events', done => {
      const operation = cancelTestUtils
        .createTestDataFactories()
        .exportOperation();

      clientSocket.on('cancelError', (data: any) => {
        expect(data.operationId).toBe(operation.id);
        expect(data.error).toBe('Network timeout during cancellation');
        done();
      });

      wsService.emitCancelError('user-789', {
        operationId: operation.id,
        error: 'Network timeout during cancellation',
        timestamp: new Date().toISOString(),
      });
    });
  });

  describe('Connection Management', () => {
    it('should track user connections', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        const connections = wsService.getUserConnections('user-789');
        expect(connections).toBe(1);
        done();
      });
    });

    it('should track project room connections', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.emit('joinProject', { projectId: 'project-456' });
      });

      clientSocket.on('joinedProject', () => {
        const connections = wsService.getProjectConnections('project-456');
        expect(connections).toBe(1);
        done();
      });
    });

    it('should handle client disconnection cleanup', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.emit('joinProject', { projectId: 'project-456' });
      });

      clientSocket.on('joinedProject', () => {
        clientSocket.disconnect();

        setTimeout(() => {
          const userConnections = wsService.getUserConnections('user-789');
          const projectConnections =
            wsService.getProjectConnections('project-456');

          expect(userConnections).toBe(0);
          expect(projectConnections).toBe(0);
          done();
        }, 100);
      });
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle connection errors gracefully', done => {
      clientSocket.connect();

      clientSocket.on('connect_error', (error: any) => {
        expect(error).toBeDefined();
        done();
      });

      // Force connection error by connecting to wrong port
      const wrongClient = Client('http://localhost:99999', {
        transports: ['websocket'] as string[],
        timeout: 1000,
      });

      wrongClient.connect();
    });

    it('should handle malformed event data', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        // Send malformed data
        clientSocket.emit('authenticate', { invalid: 'data' });

        // Should not crash the service
        setTimeout(() => {
          const connections = wsService.getUserConnections('user-789');
          expect(connections).toBe(1);
          done();
        }, 100);
      });
    });

    it('should handle rapid connection/disconnection cycles', done => {
      const clients: any[] = [];
      const connectionCount = 10;
      let completedConnections = 0;

      for (let i = 0; i < connectionCount; i++) {
        const client = Client(serverAddress, {
          transports: ['websocket'] as string[],
          autoConnect: false,
        });

        client.connect();

        client.on('connect', () => {
          client.emit('authenticate', {
            userId: `user-${i}`,
            token: 'valid-token',
          });
        });

        client.on('authenticated', () => {
          client.disconnect();
          completedConnections++;

          if (completedConnections === connectionCount) {
            // All connections should be cleaned up
            setTimeout(() => {
              expect(wsService.getUserConnections('user-0')).toBe(0);
              done();
            }, 100);
          }
        });

        clients.push(client);
      }
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle multiple concurrent cancel events efficiently', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.emit('joinProject', { projectId: 'project-456' });
      });

      clientSocket.on('joinedProject', () => {
        const eventCount = 100;
        let receivedEvents = 0;

        clientSocket.on('operationCancelled', (_data: CancelEvent) => {
          receivedEvents++;
          if (receivedEvents === eventCount) {
            done();
          }
        });

        // Emit many cancel events rapidly
        for (let i = 0; i < eventCount; i++) {
          wsService.emitOperationCancelled('user-789', {
            operationId: `operation-${i}`,
            operationType: 'upload',
            reason: 'Batch cancel test',
            timestamp: new Date().toISOString(),
            projectId: 'project-456',
          });
        }
      });
    });

    it('should handle large event payloads', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        clientSocket.on('batchCancelled', (data: any) => {
          expect(data.imageIds).toHaveLength(1000);
          expect(data.metadata.largeData).toHaveLength(1000);
          done();
        });

        // Create large payload
        const largeImageIds = Array.from(
          { length: 1000 },
          (_, i) => `img-${i}`
        );
        const largeMetadata = {
          largeData: Array.from({ length: 1000 }, (_, i) => ({
            id: i,
            data: `data-${i}`,
          })),
        };

        wsService.emitSegmentationCancelled('user-789', {
          operationId: 'large-batch',
          operationType: 'segmentation',
          reason: 'Large batch cancel',
          timestamp: new Date().toISOString(),
          projectId: 'project-456',
          batchId: 'large-batch',
          imageIds: largeImageIds,
          metadata: largeMetadata,
        });
      });
    });
  });

  describe('Event Sequencing and Timing', () => {
    it('should maintain event order for sequential cancellations', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        const receivedEvents: string[] = [];

        clientSocket.on('operationCancelled', (data: CancelEvent) => {
          receivedEvents.push(data.operationId);

          if (receivedEvents.length === 5) {
            expect(receivedEvents).toEqual([
              'operation-1',
              'operation-2',
              'operation-3',
              'operation-4',
              'operation-5',
            ]);
            done();
          }
        });

        // Emit events in sequence
        for (let i = 1; i <= 5; i++) {
          wsService.emitOperationCancelled('user-789', {
            operationId: `operation-${i}`,
            operationType: 'upload',
            reason: 'Sequential cancel',
            timestamp: new Date().toISOString(),
          });
        }
      });
    });

    it('should handle event timing with delays', done => {
      clientSocket.connect();

      clientSocket.on('connect', () => {
        clientSocket.emit('authenticate', {
          userId: 'user-789',
          token: 'valid-token',
        });
      });

      clientSocket.on('authenticated', () => {
        const _startTime = Date.now();

        clientSocket.on('operationCancelled', (data: CancelEvent) => {
          const eventTime = new Date(data.timestamp).getTime();
          const latency = Date.now() - eventTime;

          expect(latency).toBeLessThan(100); // Should be very fast locally
          done();
        });

        wsService.emitOperationCancelled('user-789', {
          operationId: 'timing-test',
          operationType: 'upload',
          reason: 'Timing test',
          timestamp: new Date().toISOString(),
        });
      });
    });
  });
});
