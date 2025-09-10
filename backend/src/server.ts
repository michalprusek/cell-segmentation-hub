// Initialize OpenTelemetry BEFORE any other imports
// import { initializeTracing } from './config/tracing'; // Temporarily disabled - OpenTelemetry deps missing

// Initialize tracing first (must be before any instrumented modules)
// if (process.env.NODE_ENV !== 'test') {
//   try {
//     initializeTracing();
//   } catch (error) {
//     console.error('Failed to initialize OpenTelemetry tracing:', error);
//   }
// }

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, getOrigins } from './utils/config';
import { getUploadLimitsForEnvironment } from './config/uploadLimits';

// Get environment-specific upload limits
const uploadLimits = getUploadLimitsForEnvironment();
import { logger, createRequestLogger } from './utils/logger';
import { requireValidEnvironment } from './utils/envValidator';
import { errorHandler, notFoundHandler } from './middleware/error';
import { ResponseHelper } from './utils/response';
import { initializeDatabase, disconnectDatabase, checkDatabaseHealth } from './db';
import { setupSwagger } from './middleware/swagger';
import { setupRoutes, createEndpointTracker } from './api/routes';
import { createMonitoringMiddleware, getMetricsEndpoint, getMonitoringHealth, initializeMetricsCollection } from './middleware/monitoring';
import { WebSocketService } from './services/websocketService';
import { prisma } from './db';
import { initializeStorageDirectories } from './utils/initializeStorage';
import { initializeRedis, closeRedis, redisHealthCheck } from './config/redis';
import { sessionService } from './services/sessionService';
import { initializeRateLimitingSystem, cleanupRateLimitingSystem } from './monitoring/rateLimitingInitialization';
// import { 
//   createTracingMiddleware, 
//   createErrorTracingMiddleware, 
//   createPerformanceTracingMiddleware,
//   createContextPropagationMiddleware 
// } from './middleware/tracing'; // Temporarily disabled
// import { 
//   initializeTraceCorrelation, 
//   shutdownTraceCorrelation 
// } from './utils/traceCorrelation'; // Temporarily disabled
// import { shutdownTracing } from './config/tracing'; // Temporarily disabled

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
  },
  hsts: config.NODE_ENV === 'production' ? {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  } : false
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

// Body parsing middleware - increased limits for large uploads
app.use(express.json({ limit: uploadLimits.EXPRESS_JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: uploadLimits.EXPRESS_URL_ENCODED_LIMIT }));

// Distributed tracing middleware (MUST be early in the middleware stack)
// app.use(createContextPropagationMiddleware()); // Temporarily disabled
// app.use(createTracingMiddleware()); // Temporarily disabled
// app.use(createPerformanceTracingMiddleware()); // Temporarily disabled

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
  const redisHealth = await redisHealthCheck();
  const monitoringHealth = getMonitoringHealth();
  
  const isHealthy = dbHealth.healthy && monitoringHealth.healthy && 
    redisHealth.status === 'healthy';
  
  return ResponseHelper.success(res, {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: config.NODE_ENV,
    database: dbHealth,
    redis: redisHealth,
    monitoring: monitoringHealth
  }, isHealthy ? 'Server is healthy' : 'Server has issues');
});

// Prometheus metrics endpoint
app.get('/metrics', getMetricsEndpoint());

// Setup all API routes
setupRoutes(app);

// Serve static files (uploads)
app.use('/uploads', express.static(config.UPLOAD_DIR || './uploads'));

// 404 handler
app.use(notFoundHandler);

// Tracing error handler (must be before global error handler)
// app.use(createErrorTracingMiddleware()); // Temporarily disabled

// Global error handler
app.use(errorHandler);

// Start server
const startServer = async (): Promise<void> => {
  try {
    // Environment validation - MUST run first
    logger.info('Validating environment configuration...');
    requireValidEnvironment();
    
    // JWT Security validation - MUST run before any other initialization
    const jwtAccessSecret = process.env.JWT_ACCESS_SECRET || '';
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || '';
    
    // Check for valid JWT secrets (64 hex characters = 32 bytes)
    const isValidHexSecret = (secret: string): boolean => {
      return /^[0-9a-fA-F]{64}$/.test(secret);
    };
    
    const invalidPlaceholders = [
      'REPLACE_ME_GENERATE_64_HEX_WITH_OPENSSL_RAND',
      'INVALID_PLACEHOLDER_GENERATE_WITH_OPENSSL_RAND_HEX_32',
      'your-super-secret-jwt-key-here',
      'your-super-secret-refresh-key-here'
    ];
    
    if (!jwtAccessSecret || 
        !isValidHexSecret(jwtAccessSecret) || 
        invalidPlaceholders.some(p => jwtAccessSecret.includes(p))) {
      logger.error('SECURITY ERROR: Invalid JWT_ACCESS_SECRET detected');
      logger.error('JWT_ACCESS_SECRET must be a 64-character hexadecimal string (32 bytes)');
      logger.error('Generate a secure secret using: openssl rand -hex 32');
      process.exit(1);
    }
    
    if (!jwtRefreshSecret || 
        !isValidHexSecret(jwtRefreshSecret) || 
        invalidPlaceholders.some(p => jwtRefreshSecret.includes(p))) {
      logger.error('SECURITY ERROR: Invalid JWT_REFRESH_SECRET detected');
      logger.error('JWT_REFRESH_SECRET must be a 64-character hexadecimal string (32 bytes)');
      logger.error('Generate a secure secret using: openssl rand -hex 32');
      process.exit(1);
    }
    
    if (jwtAccessSecret === jwtRefreshSecret) {
      logger.error('SECURITY ERROR: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
      logger.error('Generate unique secrets for each using: openssl rand -hex 32');
      process.exit(1);
    }
    
    logger.info('✓ JWT secrets validation passed');
    
    // Security check: Prevent using placeholder values in production
    if (config.NODE_ENV === 'production' && process.env.ENABLE_GRAFANA === 'true') {
      const grafanaPassword = process.env.GF_SECURITY_ADMIN_PASSWORD;
      if (!grafanaPassword || 
          grafanaPassword.includes('__REPLACE_WITH') || 
          grafanaPassword === 'DO_NOT_USE_IN_PRODUCTION_CHANGE_ME_NOW' ||
          grafanaPassword === 'REQUIRED_CHANGE_ME_GENERATE_STRONG_PASSWORD' ||
          grafanaPassword === 'admin' || 
          grafanaPassword === 'password' || 
          grafanaPassword === 'changeme') {
        logger.error('SECURITY ERROR: Default or placeholder Grafana admin password detected in production');
        logger.error('Please set GF_SECURITY_ADMIN_PASSWORD to a secure password before restarting');
        process.exit(1);
      }
    } else if (config.NODE_ENV === 'production') {
      logger.info('Grafana password check skipped (ENABLE_GRAFANA not set to true)');
    }
    
    // Initialize database connection
    await initializeDatabase();
    
    // Initialize Redis connection
    try {
      await initializeRedis();
      logger.info('🔴 Redis connected successfully');
    } catch (error) {
      logger.warn('Redis initialization failed:', (error as Error).message);
      logger.warn('Application continuing without Redis caching');
    }
    
    // Initialize comprehensive rate limiting system
    try {
      await initializeRateLimitingSystem();
      logger.info('⚡ Comprehensive rate limiting system initialized');
    } catch (error) {
      logger.error('Failed to initialize rate limiting system:', error as Error);
      logger.warn('Application continuing with basic rate limiting');
    }
    
    // Initialize trace correlation system
    // try {
    //   initializeTraceCorrelation();
    //   logger.info('🔗 Trace correlation system initialized');
    // } catch (error) {
    //   logger.error('Failed to initialize trace correlation system:', error as Error);
    //   logger.warn('Application continuing without trace correlation');
    // } // Temporarily disabled
    
    // Initialize storage directories
    try {
      await initializeStorageDirectories();
      logger.info('📁 Storage directories initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize storage directories:', error as Error);
      process.exit(1); // Exit if we can't set up storage
    }
    
    // Initialize email service
    try {
      const { initializeEmailService } = await import('./services/emailService');
      await initializeEmailService();
      logger.info('📧 Email service initialization complete');
    } catch (error) {
      logger.error('Failed to initialize email service:', error as Error);
      // Don't exit - email service can fail gracefully
    }

    // Initialize business metrics collection
    try {
      initializeMetricsCollection();
      logger.info('📊 Business metrics collection initialized');
    } catch (error) {
      logger.error('Failed to initialize business metrics collection:', error as Error);
      // Don't exit - metrics collection can fail gracefully
    }
    
    // Initialize health check service
    try {
      const { healthCheckService } = await import('./services/healthCheckService');
      healthCheckService.startPeriodicChecks(30000); // Check every 30 seconds
      logger.info('🏥 Health check service initialized with 30s interval');
    } catch (error) {
      logger.error('Failed to initialize health check service:', error as Error);
      // Don't exit - health checks can fail gracefully
    }
    
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
      
      // Stop health check service
      try {
        const { healthCheckService } = await import('./services/healthCheckService');
        await healthCheckService.cleanup();
        logger.info('Health check service stopped');
      } catch (error) {
        logger.error('Error stopping health check service:', error as Error);
      }
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        // Cleanup rate limiting system
        try {
          await cleanupRateLimitingSystem();
          logger.info('Rate limiting system cleaned up');
        } catch (error) {
          logger.error('Error cleaning up rate limiting system:', error as Error);
        }
        
        // Close Redis connection
        try {
          await closeRedis();
          logger.info('Redis connection closed');
        } catch (error) {
          logger.error('Error closing Redis connection:', error as Error);
        }
        
        // Shutdown trace correlation system
        // try {
        //   shutdownTraceCorrelation();
        //   logger.info('Trace correlation system shutdown');
        // } catch (error) {
        //   logger.error('Error shutting down trace correlation:', error as Error);
        // } // Temporarily disabled
        
        // Shutdown OpenTelemetry tracing
        // try {
        //   await shutdownTracing();
        //   logger.info('OpenTelemetry tracing shutdown');
        // } catch (error) {
        //   logger.error('Error shutting down tracing:', error as Error);
        // } // Temporarily disabled
        
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