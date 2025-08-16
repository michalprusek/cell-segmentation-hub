import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../utils/config';

// Create a global variable to store Prisma client
declare global {
  var __prisma: PrismaClient | undefined;
}

// Initialize Prisma client
const createPrismaClient = () => {
  return new PrismaClient();
};

// Use global variable in development to prevent multiple instances
export const prisma = globalThis.__prisma ?? createPrismaClient();

if (config.NODE_ENV === 'development') {
  globalThis.__prisma = prisma;
}

// Set up basic logging
// Note: Commenting out detailed Prisma logging to avoid TypeScript conflicts

// Initialize database connection
export const initializeDatabase = async () => {
  try {
    logger.info('Initializing database connection...', 'Database');
    
    // Test the connection
    await prisma.$connect();
    
    // Run any startup queries if needed
    const userCount = await prisma.user.count();
    
    logger.info('Database connection established', 'Database', {
      userCount,
      databaseUrl: config.DATABASE_URL
    });
    
    return prisma;
  } catch (error) {
    logger.error('Failed to initialize database:', error as Error, 'Database');
    throw error;
  }
};

// Graceful shutdown
export const disconnectDatabase = async () => {
  try {
    logger.info('Disconnecting from database...', 'Database');
    await prisma.$disconnect();
    logger.info('Database disconnected', 'Database');
  } catch (error) {
    logger.error('Error disconnecting from database:', error as Error, 'Database');
  }
};

// Database health check
export const checkDatabaseHealth = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true, message: 'Database is accessible' };
  } catch (error) {
    logger.error('Database health check failed:', error as Error, 'Database');
    return { healthy: false, message: 'Database is not accessible' };
  }
};

// Helper function for transactions
export const transaction = async <T>(
  callback: (prisma: any) => Promise<T>
): Promise<T> => {
  return await prisma.$transaction(callback);
};

export default prisma;