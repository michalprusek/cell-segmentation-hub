import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import * as http from 'http';
import express from 'express';
import { setupWebSocket } from '../src/websocket/websocket';

describe('WebSocket Integration Tests', () => {
  let httpServer: http.Server;
  let ioServer: Server;
  let clientSocket: ClientSocket;
  let serverPort: number;

  beforeAll(async () => {
    return new Promise<void>((resolve) => {
      // Create Express app and HTTP server
      const app = express();
      httpServer = http.createServer(app);
      
      // Setup WebSocket server
      ioServer = setupWebSocket(httpServer);
      
      // Start server on random port
      httpServer.listen(() => {
        const address = httpServer.address();
        serverPort = typeof address === 'object' ? address?.port || 3002 : 3002;
        resolve();
      });
    });
  });

  afterAll(async () => {
    return new Promise<void>((resolve) => {
      ioServer.close();
      httpServer.close(() => resolve());
    });
  });

  beforeEach(async () => {
    return new Promise<void>((resolve) => {
      // Create client socket
      clientSocket = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        reconnection: false,
      });
      
      clientSocket.on('connect', () => resolve());
    });
  });

  afterEach(() => {
    if (clientSocket.connected) {
      clientSocket.disconnect();
    }
  });

  describe('Connection Management', () => {
    it('should establish WebSocket connection', async () => {
      expect(clientSocket.connected).toBe(true);
    });

    it('should handle client disconnect gracefully', async () => {
      return new Promise<void>((resolve) => {
        clientSocket.on('disconnect', () => {
          expect(clientSocket.connected).toBe(false);
          resolve();
        });
        
        clientSocket.disconnect();
      });
    });

    it('should handle multiple concurrent connections', async () => {
      const clients: ClientSocket[] = [];
      
      // Create 3 concurrent connections (reduced for test reliability)
      const connectionPromises = Array.from({ length: 3 }, () => {
        return new Promise<ClientSocket>((resolve) => {
          const client = ioClient(`http://localhost:${serverPort}`, {
            transports: ['websocket'],
            reconnection: false,
          });
          
          client.on('connect', () => {
            clients.push(client);
            resolve(client);
          });
        });
      });

      await Promise.all(connectionPromises);
      expect(clients.length).toBe(3);
      
      // Cleanup
      clients.forEach(c => c.disconnect());
    });
  });

  describe('Room Management', () => {
    it('should join and leave project rooms', async () => {
      const projectId = 'test-project-rooms';
      
      // Join room
      const joinResult = await new Promise<any>((resolve) => {
        clientSocket.emit('joinProject', projectId, (response: any) => {
          resolve(response);
        });
      });
      
      expect(joinResult?.success).toBe(true);
      
      // Leave room
      const leaveResult = await new Promise<any>((resolve) => {
        clientSocket.emit('leaveProject', projectId, (response: any) => {
          resolve(response);
        });
      });
      
      expect(leaveResult?.success).toBe(true);
    });

    it('should receive events only for joined projects', async () => {
      const project1 = 'project-1';
      const project2 = 'project-2';
      
      return new Promise<void>((resolve) => {
        let receivedCount = 0;

        clientSocket.on('segmentationStatus', (data) => {
          receivedCount++;
          expect(data.projectId).toBe(project1); // Should only receive project1 events
          
          if (receivedCount === 2) {
            resolve();
          }
        });

        // Join only project1
        clientSocket.emit('joinProject', project1);
        
        setTimeout(() => {
          // Emit to both projects
          ioServer.to(`project:${project1}`).emit('segmentationStatus', { projectId: project1, status: 'processing' });
          ioServer.to(`project:${project2}`).emit('segmentationStatus', { projectId: project2, status: 'processing' });
          
          // Emit another to project1
          setTimeout(() => {
            ioServer.to(`project:${project1}`).emit('segmentationStatus', { projectId: project1, status: 'completed' });
          }, 100);
        }, 100);
      });
    });
  });

  describe('Segmentation Status Events', () => {
    it('should emit segmentationStatus event on status change', async () => {
      const testData = {
        projectId: 'test-project-123',
        imageId: 'test-image-456',
        status: 'processing',
        progress: 50,
      };

      return new Promise<void>((resolve) => {
        clientSocket.on('segmentationStatus', (data) => {
          expect(data).toEqual(testData);
          resolve();
        });

        // Join project room first
        clientSocket.emit('joinProject', testData.projectId);
        
        // Simulate server emitting status update
        setTimeout(() => {
          ioServer.to(`project:${testData.projectId}`).emit('segmentationStatus', testData);
        }, 100);
      });
    });

    it('should handle segmentationCompleted event with polygon count', async () => {
      const completedData = {
        projectId: 'test-project-789',
        imageId: 'test-image-101',
        status: 'completed',
        polygonCount: 15,
        processingTime: 3.5,
      };

      return new Promise<void>((resolve) => {
        clientSocket.on('segmentationCompleted', (data) => {
          expect(data.status).toBe('completed');
          expect(data.polygonCount).toBe(15);
          expect(data.processingTime).toBe(3.5);
          resolve();
        });

        clientSocket.emit('joinProject', completedData.projectId);
        
        setTimeout(() => {
          ioServer.to(`project:${completedData.projectId}`).emit('segmentationCompleted', completedData);
        }, 100);
      });
    });
  });

  describe('Queue Management Events', () => {
    it('should emit queue statistics updates', async () => {
      const queueStats = {
        position: 3,
        total: 10,
        estimatedTime: 45,
        projectId: 'test-project-queue',
      };

      return new Promise<void>((resolve) => {
        clientSocket.on('queueStats', (data) => {
          expect(data.position).toBe(3);
          expect(data.total).toBe(10);
          expect(data.estimatedTime).toBe(45);
          resolve();
        });

        clientSocket.emit('joinProject', queueStats.projectId);
        
        setTimeout(() => {
          ioServer.to(`project:${queueStats.projectId}`).emit('queueStats', queueStats);
        }, 100);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid project ID gracefully', async () => {
      const result = await new Promise<any>((resolve) => {
        clientSocket.emit('joinProject', null, (response: any) => {
          resolve(response);
        });
      });
      
      expect(result?.success).toBe(false);
      expect(result?.error).toContain('Invalid');
    });

    it('should handle connection errors', async () => {
      return new Promise<void>((resolve) => {
        const errorSocket = ioClient('http://localhost:99999', {
          transports: ['websocket'],
          reconnection: false,
          timeout: 1000,
        });

        errorSocket.on('connect_error', (error) => {
          expect(error).toBeDefined();
          errorSocket.close();
          resolve();
        });
      });
    });
  });
});

describe('WebSocket Message Validation', () => {
  it('should validate segmentation status message format', () => {
    const validMessage = {
      projectId: 'proj-123',
      imageId: 'img-456',
      status: 'processing',
      progress: 75,
    };

    const invalidMessages = [
      { projectId: 123, imageId: 'img-456', status: 'processing' }, // Wrong type
      { imageId: 'img-456', status: 'processing' }, // Missing field
      { projectId: 'proj-123', imageId: 'img-456', status: 'invalid' }, // Invalid status
    ];

    // Validation function
    const isValidSegmentationStatus = (msg: any): boolean => {
      return (
        typeof msg.projectId === 'string' &&
        typeof msg.imageId === 'string' &&
        ['queued', 'processing', 'completed', 'failed'].includes(msg.status) &&
        (msg.progress === undefined || typeof msg.progress === 'number')
      );
    };

    expect(isValidSegmentationStatus(validMessage)).toBe(true);
    invalidMessages.forEach(msg => {
      expect(isValidSegmentationStatus(msg)).toBe(false);
    });
  });
});