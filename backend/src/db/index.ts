import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../utils/config';

// Create a global variable to store Prisma client
declare global {
  var __prisma: PrismaClient | undefined;
}

// Initialize Prisma client (legacy compatibility)
const createPrismaClient = (): PrismaClient => {
  return new PrismaClient();
};

// Simple Prisma client setup
let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = createPrismaClient();
} else {
  if (!global.__prisma) {
    global.__prisma = createPrismaClient();
  }
  prisma = global.__prisma;
}

/**
 * Initialize database connection
 */
export async function initializeDatabase(): Promise<PrismaClient> {
  try {
    logger.info('Initializing database connection...', 'Database');
    
    // Test basic connectivity
    await prisma.$connect();
    
    // Verify database is working with a simple query
    const userCount = await prisma.user.count();
    
    logger.info('✅ Database connection initialized', 'Database', {
      userCount,
      databaseUrl: config.DATABASE_URL.replace(/\/\/.*@/, '//***@'), // Hide credentials
    });
    
    return prisma;
    
  } catch (error) {
    logger.error('❌ Failed to initialize database connection', error instanceof Error ? error : new Error(String(error)), 'Database');
    throw error;
  }
}

/**
 * Get the Prisma client instance
 */
export function getPrismaClient(): PrismaClient {
  return prisma;
}

/**
 * Gracefully disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    logger.info('Disconnecting from database...', 'Database');
    
    await prisma.$disconnect();
    
    logger.info('✅ Database disconnected successfully', 'Database');
  } catch (error) {
    logger.error('❌ Error during database disconnect', error instanceof Error ? error : new Error(String(error)), 'Database');
  }
}

/**
 * Get database health status
 */
export async function getDatabaseHealth(): Promise<{ status: string; details?: unknown }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { 
      status: 'healthy',
      details: { connected: true }
    };
  } catch (error) {
    return { 
      status: 'unhealthy',
      details: { error: (error as Error).message }
    };
  }
}

/**
 * Execute operation in transaction (legacy compatibility)
 */
export async function executeInTransaction<T>(
  callback: (prisma: PrismaClient) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(callback);
}

// Legacy exports
export { prisma };
export default prisma;

// Simplified operation wrappers
export async function executeQuery<T>(operation: () => Promise<T>): Promise<T> {
  return operation();
}

export async function executeMutation<T>(operation: () => Promise<T>): Promise<T> {
  return operation();
}

export async function executeTransaction<T>(operation: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(operation);
}