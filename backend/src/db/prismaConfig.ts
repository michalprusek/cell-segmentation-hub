import { Prisma } from '@prisma/client';
import { config } from '../utils/config';

/**
 * Get Prisma client configuration
 */
export function getPrismaConfig(): Prisma.PrismaClientOptions {
  const isProd = config.NODE_ENV === 'production';

  return {
    datasources: {
      db: {
        url: config.DATABASE_URL
      }
    },
    log: isProd ? ['error'] : ['error', 'warn'],
    errorFormat: isProd ? 'minimal' : 'pretty'
  };
}