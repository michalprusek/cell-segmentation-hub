import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { prismaPool } from './prismaPool';
import { databaseMetrics } from '../monitoring/databaseMetrics';
import { logDatabasePoolConfig } from '../config/database';

// Create a global variable to store Prisma client
declare global {
  var __prisma: PrismaClient | undefined;
}

// Initialize Prisma client (legacy compatibility)
const createPrismaClient = (): PrismaClient => {
  return new PrismaClient();
};

// Use global variable in development to prevent multiple instances (legacy compatibility)
export const prisma = globalThis.__prisma ?? createPrismaClient();

if (config.NODE_ENV === 'development') {
  globalThis.__prisma = prisma;
}

// Initialize database connection with enhanced pooling
export const initializeDatabase = async (): Promise<PrismaClient> => {
  try {
    logger.info('🔌 Initializing enhanced database connection system...', 'Database');
    
    // Log database pool configuration
    logDatabasePoolConfig();
    
    // Initialize the connection pool
    await prismaPool.initialize();
    
    // Start database metrics collection
    databaseMetrics.start();
    
    // Test the connection through the pool
    const _result = await prismaPool.executeQuery(async () => {
      return await prismaPool.getPrismaClient().$connect();
    }, { operationType: 'query', operationName: 'connection-test' });
    
    // Run startup validation query
    const userCount = await prismaPool.executeQuery(async () => {
      return await prismaPool.getPrismaClient().user.count();
    }, { operationType: 'query', operationName: 'startup-validation' });
    
    logger.info('✅ Enhanced database connection system initialized', 'Database', {
      userCount,
      databaseUrl: config.DATABASE_URL.replace(/\/\/.*@/, '//***@'), // Hide credentials
      poolEnabled: true,
      metricsEnabled: true
    });
    
    // Return the pooled client for compatibility
    return prismaPool.getPrismaClient();
    
  } catch (error) {
    logger.error('❌ Failed to initialize enhanced database system:', error as Error, 'Database');
    
    // Fallback to basic connection if pool initialization fails
    logger.warn('🔄 Falling back to basic database connection...', 'Database');
    
    try {
      await prisma.$connect();
      const userCount = await prisma.user.count();
      
      logger.info('⚠️ Basic database connection established (without pooling)', 'Database', {
        userCount,
        databaseUrl: config.DATABASE_URL.replace(/\/\/.*@/, '//***@')
      });
      
      return prisma;
    } catch (fallbackError) {
      logger.error('❌ Even basic database connection failed:', fallbackError as Error, 'Database');
      throw error;
    }
  }
};

// Enhanced graceful shutdown
export const disconnectDatabase = async (): Promise<void> => {
  try {
    logger.info('🔌 Shutting down enhanced database connection system...', 'Database');
    
    // Stop metrics collection
    databaseMetrics.stop();
    
    // Shutdown connection pool
    await prismaPool.shutdown();
    
    // Disconnect legacy client as fallback
    await prisma.$disconnect();
    
    logger.info('✅ Database connection system shut down successfully', 'Database');
  } catch (error) {
    logger.error('❌ Error during database shutdown:', error as Error, 'Database');
  }
};

// Enhanced database health check
export const checkDatabaseHealth = async (): Promise<{healthy: boolean; message: string}> => {
  try {
    // Try to use the enhanced pool health check first
    const poolHealth = await prismaPool.healthCheck();
    
    return {
      healthy: poolHealth.healthy,
      message: poolHealth.healthy ? 'Database connection pool is healthy' : 'Database connection pool issues detected'
    };
  } catch {
    // Fallback to basic health check
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { healthy: true, message: 'Database is accessible (basic connection)' };
    } catch (fallbackError) {
      logger.error('Database health check failed:', fallbackError as Error, 'Database');
      return { healthy: false, message: 'Database is not accessible' };
    }
  }
};

// Enhanced helper function for transactions with pooling
export const transaction = async <T>(
  callback: (prisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
): Promise<T> => {
  try {
    // Use the enhanced transaction handling from the pool
    return await prismaPool.executeTransaction(callback, 'legacy-transaction-helper');
  } catch (error) {
    // Fallback to basic transaction if pool fails
    logger.warn('Transaction pool failed, falling back to basic transaction:', error);
    return await prisma.$transaction(callback);
  }
};

// Export enhanced database utilities
export { prismaPool } from './prismaPool';
export { databaseMetrics } from '../monitoring/databaseMetrics';
export { databaseOptimization } from '../utils/databaseOptimization';
export { 
  getDatabasePoolConfig,
  getRetryConfig,
  getHealthCheckConfig,
  getPerformanceBaselines
} from '../config/database';

// Enhanced transaction and query helpers
export const executeQuery = async <T>(
  operation: () => Promise<T>,
  operationName?: string
): Promise<T> => {
  return prismaPool.executeQuery(operation, {
    operationType: 'query',
    operationName
  });
};

export const executeMutation = async <T>(
  operation: () => Promise<T>,
  operationName?: string
): Promise<T> => {
  return prismaPool.executeMutation(operation, operationName);
};

export const executeTransaction = async <T>(
  operation: (prisma: PrismaClient) => Promise<T>,
  operationName?: string
): Promise<T> => {
  return prismaPool.executeTransaction(operation, operationName);
};

export default prisma;