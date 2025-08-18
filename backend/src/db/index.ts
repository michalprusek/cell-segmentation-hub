import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../utils/config';

// Create a global variable to store Prisma client
declare global {
  var __prisma: PrismaClient | undefined;
}

// Initialize Prisma client
const createPrismaClient = (): PrismaClient => {
  return new PrismaClient();
};

// Use global variable in development to prevent multiple instances
export const prisma = globalThis.__prisma ?? createPrismaClient();

if (config.NODE_ENV === 'development') {
  globalThis.__prisma = prisma;
}

// Set up basic logging
// Note: Commenting out detailed Prisma logging to avoid TypeScript conflicts

// Initialize database connection with retry logic
export const initializeDatabase = async (): Promise<PrismaClient> => {
  let retries = 10;
  const delay = 3000; // 3 seconds
  
  while (retries > 0) {
    try {
      logger.info(`Initializing database connection... (attempt ${11 - retries}/10)`, 'Database');
      logger.info(`DATABASE_URL: ${config.DATABASE_URL?.replace(/:[^@]+@/, ':****@')}`, 'Database');
      
      // Test the connection
      await prisma.$connect();
      
      // Run any startup queries if needed
      const userCount = await prisma.user.count();
      
      logger.info('Database connection established', 'Database', {
        userCount,
        databaseUrl: config.DATABASE_URL?.replace(/:[^@]+@/, ':****@')
      });
      
      return prisma;
    } catch (error) {
      retries--;
      if (retries === 0) {
        logger.error('Failed to initialize database after 10 attempts:', error as Error, 'Database');
        throw error;
      }
      logger.warn(`Database connection failed, retrying in ${delay/1000}s... (${retries} attempts left)`, 'Database');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This should never be reached due to the logic above, but TypeScript requires it
  throw new Error('Failed to initialize database: maximum retries exceeded');
};

// Graceful shutdown
export const disconnectDatabase = async (): Promise<void> => {
  try {
    logger.info('Disconnecting from database...', 'Database');
    await prisma.$disconnect();
    logger.info('Database disconnected', 'Database');
  } catch (error) {
    logger.error('Error disconnecting from database:', error as Error, 'Database');
  }
};

// Database health check
export const checkDatabaseHealth = async (): Promise<{healthy: boolean; message: string}> => {
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
  callback: (prisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
): Promise<T> => {
  return await prisma.$transaction(callback);
};

export default prisma;