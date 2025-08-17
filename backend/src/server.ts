import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, getOrigins } from './utils/config';
import { logger, createRequestLogger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { ResponseHelper } from './utils/response';
import { initializeDatabase, disconnectDatabase, checkDatabaseHealth } from './db';
import { setupSwagger } from './middleware/swagger';
import { setupRoutes, createEndpointTracker } from './api/routes';
import { createMonitoringMiddleware, getMetricsEndpoint, getMonitoringHealth } from './middleware/monitoring';
import { WebSocketService } from './services/websocketService';
import { prisma } from './db';

const app = express();

// Trust proxy (important for rate limiting and logging real IPs)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https:", "data:"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: getOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count']
}));

// Rate limiting - more lenient for development
if (config.RATE_LIMIT_ENABLED) {
  const limiter = rateLimit({
    windowMs: config.NODE_ENV === 'development' ? 60000 : config.RATE_LIMIT_WINDOW_MS, // 1 minute in dev
    max: config.NODE_ENV === 'development' ? 10000 : config.RATE_LIMIT_MAX, // 10000 requests per minute in dev
    message: {
      success: false,
      error: 'Příliš mnoho požadavků, zkuste to později'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks and metrics in development
      if (config.NODE_ENV === 'development') {
        return req.path === '/health' || req.path === '/metrics' || req.path === '/api/health';
      }
      return false;
    },
    handler: (req, res) => {
      return ResponseHelper.rateLimit(res, 'Příliš mnoho požadavků, zkuste to později');
    }
  });

  app.use(limiter);
  logger.info(`⚡ Rate limiting enabled: ${config.RATE_LIMIT_MAX} requests per ${config.RATE_LIMIT_WINDOW_MS}ms`);
} else {
  logger.warn('⚠️  Rate limiting is disabled');
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(createRequestLogger('API'));

// Endpoint tracking middleware
app.use(createEndpointTracker());

// Prometheus monitoring middleware
app.use(createMonitoringMiddleware());

// Setup Swagger documentation
setupSwagger(app);

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbHealth = await checkDatabaseHealth();
  const monitoringHealth = getMonitoringHealth();
  
  return ResponseHelper.success(res, {
    status: dbHealth.healthy && monitoringHealth.healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: config.NODE_ENV,
    database: dbHealth,
    monitoring: monitoringHealth
  }, dbHealth.healthy ? 'Server is healthy' : 'Server has issues');
});

// Prometheus metrics endpoint
app.get('/metrics', getMetricsEndpoint());

// Setup all API routes
setupRoutes(app);

// Serve static files (uploads)
app.use('/uploads', express.static(config.UPLOAD_DIR || './uploads'));

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server
const startServer = async (): Promise<void> => {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    // Create HTTP server
    const server = createServer(app);
    
    // Initialize WebSocket service
    const websocketService = WebSocketService.getInstance(server, prisma);
    
    // Connect WebSocket service to QueueService and ExportService
    try {
      const { QueueService } = await import('./services/queueService');
      const { SegmentationService } = await import('./services/segmentationService');
      const { ImageService } = await import('./services/imageService');
      const { ExportService } = await import('./services/exportService');
      const { QueueWorker } = await import('./workers/queueWorker');
      
      const imageService = new ImageService(prisma);
      const segmentationService = new SegmentationService(prisma, imageService);
      const queueService = QueueService.getInstance(prisma, segmentationService, imageService);
      queueService.setWebSocketService(websocketService);
      websocketService.setQueueService(queueService);
      
      // Connect ExportService to WebSocketService
      const exportService = ExportService.getInstance();
      exportService.setWebSocketService(websocketService);
      
      logger.info('🔗 WebSocket service connected to QueueService and ExportService');
      
      // Start queue worker
      const queueWorker = QueueWorker.getInstance(prisma);
      queueWorker.start();
      logger.info('🏃 Queue worker started');
    } catch (error) {
      logger.error('Failed to initialize critical services:', error as Error);
      logger.error('Server cannot start without required services. Exiting...');
      process.exit(1);
    }
    
    // Start HTTP server
    server.listen(config.PORT, config.HOST, () => {
      logger.info(`🚀 Server running on http://${config.HOST}:${config.PORT}`);
      logger.info(`📝 Environment: ${config.NODE_ENV}`);
      logger.info(`🔒 CORS origins: ${getOrigins().join(', ')}`);
      logger.info(`📊 Health check: http://${config.HOST}:${config.PORT}/health`);
      logger.info(`🔌 WebSocket service initialized`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received, shutting down gracefully`);
      
      // Shutdown WebSocket service first
      await websocketService.shutdown();
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        // Close database connections, queues, etc.
        await disconnectDatabase();
        
        process.exit(0);
      });
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', reason as Error, 'Promise', { promise: String(promise) });
      process.exit(1);
    });

  } catch (error) {
    logger.error('Failed to start server:', error as Error);
    process.exit(1);
  }
};

// Start the server
startServer();

export default app;