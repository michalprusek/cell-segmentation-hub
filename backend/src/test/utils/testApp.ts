import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { queueRoutes } from '../../api/routes/queueRoutes';
import { authenticate } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error';

/**
 * Creates a test Express app with minimal configuration for integration testing
 */
export async function createTestApp(): Promise<express.Express> {
  const app = express();

  // Basic middleware
  app.use(cors());
  app.use(express.json());

  // Test authentication middleware that accepts any valid JWT
  app.use('/api', authenticate);

  // API routes
  app.use('/api/queue', queueRoutes);

  // Error handling
  app.use(errorHandler);

  return app;
}

/**
 * Creates a test Prisma client for integration testing
 */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: process.env.TEST_DATABASE_URL || 'file:./test.db'
      }
    }
  });
}