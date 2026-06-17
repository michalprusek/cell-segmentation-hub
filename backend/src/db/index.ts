import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { databaseMetrics } from '../monitoring/databaseMetrics';
import { getPrismaConfig } from './prismaConfig';

// Create a global variable to store Prisma client
declare global {
  var __prisma: PrismaClient | undefined;
}

// Initialize Prisma client (legacy compatibility)
const createPrismaClient = (): PrismaClient => {
  const config = getPrismaConfig();
  return config ? new PrismaClient(config as any) : new PrismaClient();
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
      logger.info(
        `🔌 Initializing database connection (attempt ${attempt}/${maxRetries})...`,
        'Database'
      );

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
        } catch {
          logger.warn('Tables not yet created, run migrations', 'Database');
        }

        return prisma;
      } catch (queryError) {
        logger.warn('Database connected but query failed:', queryError);
        return prisma;
      }
    } catch (error) {
      logger.error(
        `Database connection attempt ${attempt}/${maxRetries} failed:`,
        error as Error,
        'Database'
      );

      if (attempt === maxRetries) {
        logger.error(
          '❌ All database connection attempts failed',
          undefined,
          'Database'
        );
        // Don't throw - let the app run without database
        logger.warn(
          '⚠️ Running without database connection - most features will not work!',
          'Database'
        );
        return prisma;
      }

      logger.info(`Retrying in ${retryDelay / 1000} seconds...`, 'Database');
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  return prisma;
};

// Enhanced graceful shutdown
export const disconnectDatabase = async (): Promise<void> => {
  try {
    logger.info(
      '🔌 Shutting down enhanced database connection system...',
      'Database'
    );

    // Stop metrics collection
    databaseMetrics.stop();

    // Disconnect the Prisma client
    await prisma.$disconnect();

    logger.info(
      '✅ Database connection system shut down successfully',
      'Database'
    );
  } catch (error) {
    logger.error(
      '❌ Error during database shutdown:',
      error as Error,
      'Database'
    );
  }
};

// Database health check
export const checkDatabaseHealth = async (): Promise<{
  healthy: boolean;
  message: string;
}> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      healthy: true,
      message: 'Database is accessible',
    };
  } catch (error) {
    logger.error('Database health check failed:', error as Error, 'Database');
    return { healthy: false, message: 'Database is not accessible' };
  }
};

export default prisma;
