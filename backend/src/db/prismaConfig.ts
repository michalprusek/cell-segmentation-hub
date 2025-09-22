import type { PrismaClientOptions } from '@prisma/client/runtime/library';

export function getPrismaConfig(): PrismaClientOptions | undefined {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    return {
      log: ['query', 'info', 'warn', 'error'],
    } as PrismaClientOptions;
  }

  return {
    log: ['warn', 'error'],
  } as PrismaClientOptions;
}