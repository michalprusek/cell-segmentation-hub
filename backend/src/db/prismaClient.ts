/**
 * Shared PrismaClient singleton.
 *
 * Several services (imageService, queueService, exportService, …) instantiate
 * their own ``new PrismaClient()`` historically.  New code added in this PR
 * (video + tracking + kymograph) should reuse a single instance to avoid
 * widening the database connection pool footprint and to match the DI shape
 * the tests already assume.
 *
 * Hot-reload safety: ``globalThis.__prismaClient`` keeps the singleton across
 * ``tsx watch`` restarts so we don't leak connections during development.
 */

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prismaClient ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prismaClient = prisma;
}
