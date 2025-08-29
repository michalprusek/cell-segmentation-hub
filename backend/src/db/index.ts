import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { prismaPool } from './prismaPool';
import { databaseMetrics } from '../monitoring/databaseMetrics';
import { logDatabasePoolConfig } from '../config/database.ts';

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
  const maxRetries = 10;
  const retryDelay = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`🔌 Initializing database connection (attempt ${attempt}/${maxRetries})...`, 'Database');
      
      // Try simple connection first
      await prisma.$connect();
      
      // If successful, try to run migrations
      try {
        await prisma.$executeRaw`SELECT 1`;
        logger.info('✅ Database connection established', 'Database');
        
        // Try to count users (might fail if tables don't exist)
        try {
          const userCount = await prisma.user.count();
          logger.info(`Database has ${userCount} users`, 'Database');
        } catch (e) {
          logger.warn('Tables not yet created, run migrations', 'Database');
        }
        
        return prisma;
      } catch (queryError) {
        logger.warn('Database connected but query failed:', queryError);
        return prisma;
      }
      
    } catch (error) {
      logger.error(`Database connection attempt ${attempt}/${maxRetries} failed:`, error as Error, 'Database');
      
      if (attempt === maxRetries) {
        logger.error('❌ All database connection attempts failed', 'Database');
        // Don't throw - let the app run without database
        logger.warn('⚠️ Running without database connection - most features will not work!', 'Database');
        return prisma;
      }
      
      logger.info(`Retrying in ${retryDelay/1000} seconds...`, 'Database');
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  return prisma;
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
  } catch (error) {
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
export { databaseOptimization } from '../utils/databaseOptimization.ts';
export { 
  getDatabasePoolConfig,
  getRetryConfig,
  getHealthCheckConfig,
  getPerformanceBaselines
} from '../config/database.ts';

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
  operation: (prisma: any) => Promise<T>,
  operationName?: string
): Promise<T> => {
  return prismaPool.executeTransaction(operation, operationName);
};

export default prisma;