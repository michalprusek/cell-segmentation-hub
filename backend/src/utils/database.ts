import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

// Type for transaction client
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'
>;

interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

/**
 * Execute an operation within a database transaction with automatic retry logic
 * 
 * Provides ACID guarantees with automatic retry on deadlock/timeout errors.
 * Uses optimistic locking to handle concurrent modifications gracefully.
 * 
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Function} operation - The operation to execute within the transaction
 * @param {TransactionOptions} options - Transaction configuration options
 * @param {number} options.maxWait - Max time to wait for transaction slot (ms)
 * @param {number} options.timeout - Max transaction duration (ms)
 * @param {string} options.isolationLevel - Transaction isolation level
 * @param {number} retries - Number of retry attempts for deadlock situations
 * 
 * @returns {Promise<T>} The result of the operation
 * 
 * @throws {Error} When transaction fails after all retry attempts
 * @throws {Error} When operation throws non-retryable error
 * 
 * @example
 * // Simple user creation with transaction
 * const user = await withTransaction(prisma, async (tx) => {
 *   const newUser = await tx.user.create({ data: userData });
 *   await tx.profile.create({ data: { userId: newUser.id } });
 *   return newUser;
 * });
 * 
 * @example
 * // Complex operation with custom options
 * const result = await withTransaction(
 *   prisma,
 *   async (tx) => {
 *     const order = await tx.order.create({ data: orderData });
 *     await tx.inventory.updateMany({
 *       where: { id: { in: itemIds } },
 *       data: { quantity: { decrement: 1 } }
 *     });
 *     await tx.payment.create({ data: { orderId: order.id } });
 *     return order;
 *   },
 *   { timeout: 30000, isolationLevel: 'Serializable' },
 *   5 // More retries for critical operations
 * );
 */
export async function withTransaction<T>(
  prisma: PrismaClient,
  operation: (tx: PrismaTransactionClient) => Promise<T>,
  options: TransactionOptions = {},
  retries = 3
): Promise<T> {
  const defaultOptions: TransactionOptions = {
    maxWait: 5000,
    timeout: 10000,
    isolationLevel: 'Serializable',
    ...options
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          logger.debug(`Starting transaction (attempt ${attempt}/${retries})`, 'Database');
          return await operation(tx as PrismaTransactionClient);
        },
        defaultOptions as Record<string, unknown>
      );
      
      logger.debug('Transaction completed successfully', 'Database');
      return result;
    } catch (error: unknown) {
      logger.error(`Transaction failed (attempt ${attempt}/${retries})`, error instanceof Error ? error : new Error(String(error)), 'Database');

      // Check if it's a deadlock or timeout error that we should retry
      const errorObj = error as { code?: string; message?: string };
      const isRetryableError =
        errorObj.code === 'P2034' || // Transaction failed due to concurrent update
        errorObj.code === 'P2024' || // Timed out fetching a new connection from the pool
        errorObj.message?.includes('deadlock') ||
        errorObj.message?.includes('timeout');
      
      if (!isRetryableError || attempt === retries) {
        throw error;
      }
      
      // Wait before retrying with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      logger.info(`Retrying transaction in ${delay}ms...`, 'Database');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This should never be reached due to the throw in the catch block
  throw new Error('Transaction failed after all retry attempts');
}

/**
 * Batch operations for better performance
 */
export async function batchOperation<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  batchSize = 10
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(operation));
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Clean up orphaned records (useful for maintaining data integrity)
 */
export async function cleanupOrphanedRecords(
  prisma: PrismaClient
): Promise<void> {
  await withTransaction(prisma, async (tx) => {
    // Clean up orphaned profile records
    // Delete orphaned profiles where userId doesn't match any existing user
    await tx.$executeRaw`
      DELETE FROM "Profile" 
      WHERE "userId" NOT IN (SELECT "id" FROM "User")
    `;
    
    // Clean up orphaned segmentation results
    await tx.segmentation.deleteMany({
      where: {
        image: {
          is: null
        }
      }
    });
    
    // Clean up orphaned queue items
    await tx.segmentationQueue.deleteMany({
      where: {
        AND: [
          { status: { in: ['completed', 'failed'] } },
          { completedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } // Older than 7 days
        ]
      }
    });
    
    logger.info('Orphaned records cleanup completed', 'Database');
  });
}