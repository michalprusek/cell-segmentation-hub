import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from '../utils/logger';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

export interface SegmentationUpdate {
  imageId: string;
  projectId: string;
  status: string;
  queueId?: string;
  progress?: number;
  error?: string;
}

export interface QueueStatsUpdate {
  projectId: string;
  queued: number;
  processing: number;
  total: number;
}

export class WebSocketService {
  private static instance: WebSocketService;
  private io: SocketIOServer;
  private connectedUsers: Map<string, Set<string>> = new Map(); // userId -> socketIds

  constructor(server: HTTPServer, private prisma: PrismaClient) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: (origin, callback) => {
          // Environment-aware CORS origin validation
          if (process.env.NODE_ENV === 'development') {
            // Allow all localhost origins for development
            if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
              callback(null, true);
            } else {
              callback(new Error('Not allowed by CORS'));
            }
          } else {
            // Production: validate against allowlist
            const allowedOrigins = process.env.WS_ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];
            
            if (allowedOrigins.length === 0) {
              callback(new Error('Not allowed by CORS'));
              return;
            }
            
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              callback(new Error('Not allowed by CORS'));
            }
          }
        },
        methods: ["GET", "POST"],
        credentials: true
      },
      path: '/socket.io/',
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    
    logger.info('WebSocket service initialized', 'WebSocketService');
  }

  public static getInstance(server?: HTTPServer, prisma?: PrismaClient): WebSocketService {
    if (!WebSocketService.instance) {
      if (!server || !prisma) {
        throw new Error('Server and Prisma are required for first initialization');
      }
      WebSocketService.instance = new WebSocketService(server, prisma);
    }
    return WebSocketService.instance;
  }

  /**
   * Setup authentication middleware
   */
  private setupMiddleware(): void {
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        logger.info('WebSocket connection attempt', 'WebSocketService', {
          socketId: socket.id,
          origin: socket.handshake.headers.origin
        });
        
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          logger.warn('WebSocket connection attempted without token', 'WebSocketService');
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token - use JWT_ACCESS_SECRET
        const jwtSecret = process.env.JWT_ACCESS_SECRET;
        if (!jwtSecret) {
          logger.error('JWT_ACCESS_SECRET not configured', new Error('JWT_ACCESS_SECRET not configured'), 'WebSocketService');
          return next(new Error('Server configuration error'));
        }

        const decoded = jwt.verify(token, jwtSecret) as { userId: string; email: string; emailVerified?: boolean };
        
        // Verify user exists in database
        const user = await this.prisma.user.findUnique({
          where: { id: decoded.userId }
        });

        if (!user) {
          logger.warn('WebSocket authentication failed - user not found', 'WebSocketService', {
            userId: decoded.userId
          });
          return next(new Error('Invalid authentication token'));
        }

        socket.userId = user.id;
        socket.userEmail = user.email;
        
        logger.info('WebSocket authentication successful', 'WebSocketService', {
          userId: user.id,
          email: user.email,
          socketId: socket.id
        });

        next();
      } catch (error) {
        logger.error('WebSocket authentication error', error instanceof Error ? error : undefined, 'WebSocketService');
        next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      logger.info('User connected via WebSocket', 'WebSocketService', {
        userId: socket.userId,
        socketId: socket.id
      });

      // Track connected user
      if (socket.userId) {
        if (!this.connectedUsers.has(socket.userId)) {
          this.connectedUsers.set(socket.userId, new Set());
        }
        this.connectedUsers.get(socket.userId)!.add(socket.id);
      }

      // Join user to their personal room
      if (socket.userId) {
        socket.join(`user:${socket.userId}`);
      }

      // Handle project room joining
      socket.on('join-project', async (projectId: string) => {
        if (!socket.userId) {
          logger.warn('Unauthenticated socket attempted to join project room', 'WebSocketService', {
            projectId,
            socketId: socket.id
          });
          socket.emit('unauthorized', { message: 'Authentication required to join project room' });
          return;
        }
        
        if (await this.isValidProjectAccess(socket.userId, projectId)) {
          socket.join(`project:${projectId}`);
          logger.info('User joined project room', 'WebSocketService', {
            userId: socket.userId,
            projectId,
            socketId: socket.id
          });
        }
      });

      // Handle project room leaving
      socket.on('leave-project', (projectId: string) => {
        socket.leave(`project:${projectId}`);
        logger.info('User left project room', 'WebSocketService', {
          userId: socket.userId,
          projectId,
          socketId: socket.id
        });
      });

      // Handle queue stats request
      socket.on('request-queue-stats', async (projectId: string) => {
        try {
          if (socket.userId && await this.isValidProjectAccess(socket.userId, projectId)) {
            // This would be called from QueueService
            // For now, just acknowledge the request
            socket.emit('queue-stats-requested', { projectId });
          }
        } catch (error) {
          logger.error('Error handling queue stats request', error instanceof Error ? error : undefined, 'WebSocketService');
        }
      });

      // Handle disconnection
      socket.on('disconnect', (reason: string) => {
        logger.info('User disconnected from WebSocket', 'WebSocketService', {
          userId: socket.userId,
          socketId: socket.id,
          reason
        });

        // Clean up user tracking
        if (socket.userId && this.connectedUsers.has(socket.userId)) {
          const userSockets = this.connectedUsers.get(socket.userId)!;
          userSockets.delete(socket.id);
          
          if (userSockets.size === 0) {
            this.connectedUsers.delete(socket.userId);
          }
        }
      });

      // Handle errors
      socket.on('error', (error: Error) => {
        logger.error('WebSocket error', error, 'WebSocketService', {
          userId: socket.userId,
          socketId: socket.id
        });
      });
    });
  }

  /**
   * Check if user has access to project
   */
  private async isValidProjectAccess(userId: string, projectId: string): Promise<boolean> {
    try {
      const project = await this.prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        }
      });
      
      return !!project;
    } catch (error) {
      logger.error('Error checking project access', error instanceof Error ? error : undefined, 'WebSocketService', {
        userId,
        projectId
      });
      return false;
    }
  }

  /**
   * Emit segmentation status update to specific user
   */
  public emitSegmentationUpdate(userId: string, update: SegmentationUpdate): void {
    try {
      // Only emit to user room to avoid duplicates (user is already in project room)
      this.io.to(`user:${userId}`).emit('segmentation-update', update);

      logger.debug('Segmentation update emitted', 'WebSocketService', {
        userId,
        imageId: update.imageId,
        status: update.status
      });
    } catch (error) {
      logger.error('Error emitting segmentation update', error instanceof Error ? error : undefined, 'WebSocketService', {
        userId,
        update
      });
    }
  }

  /**
   * Emit queue statistics update to project subscribers
   */
  public emitQueueStatsUpdate(projectId: string, stats: QueueStatsUpdate): void {
    try {
      this.io.to(`project:${projectId}`).emit('queue-stats-update', stats);
      
      logger.debug('Queue stats update emitted', 'WebSocketService', {
        projectId,
        stats
      });
    } catch (error) {
      logger.error('Error emitting queue stats update', error instanceof Error ? error : undefined, 'WebSocketService', {
        projectId,
        stats
      });
    }
  }

  /**
   * Emit segmentation completion notification
   */
  public emitSegmentationComplete(userId: string, imageId: string, projectId: string, polygonCount: number): void {
    try {
      const notification = {
        type: 'segmentation-complete',
        imageId,
        projectId,
        polygonCount,
        timestamp: new Date().toISOString()
      };

      this.io.to(`user:${userId}`).emit('notification', notification);
      
      logger.info('Segmentation completion notification sent', 'WebSocketService', {
        userId,
        imageId,
        polygonCount
      });
    } catch (error) {
      logger.error('Error emitting segmentation completion', error instanceof Error ? error : undefined, 'WebSocketService', {
        userId,
        imageId
      });
    }
  }

  /**
   * Get connected users count
   */
  public getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  /**
   * Get connected sockets count for a user
   */
  public getUserSocketsCount(userId: string): number {
    return this.connectedUsers.get(userId)?.size || 0;
  }

  /**
   * Check if user is connected
   */
  public isUserConnected(userId: string): boolean {
    return this.connectedUsers.has(userId) && this.connectedUsers.get(userId)!.size > 0;
  }

  /**
   * Broadcast system message to all connected users
   */
  public broadcastSystemMessage(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
    try {
      this.io.emit('system-message', {
        type,
        message,
        timestamp: new Date().toISOString()
      });

      logger.info('System message broadcasted', 'WebSocketService', {
        type,
        message,
        connectedUsers: this.getConnectedUsersCount()
      });
    } catch (error) {
      logger.error('Error broadcasting system message', error instanceof Error ? error : undefined, 'WebSocketService');
    }
  }

  /**
   * Gracefully shutdown WebSocket service
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket service...', 'WebSocketService');
    
    // Notify all connected clients
    this.broadcastSystemMessage('Server is shutting down', 'warning');
    
    // Wait a moment for messages to be sent
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Close all connections
    this.io.close();
    
    // Clear tracking data
    this.connectedUsers.clear();
    
    logger.info('WebSocket service shut down', 'WebSocketService');
  }
}