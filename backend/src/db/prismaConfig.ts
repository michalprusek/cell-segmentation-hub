import { PrismaClientOptions } from '@prisma/client/runtime/library';

export function getPrismaConfig(): PrismaClientOptions | undefined {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!isProduction) {
    return {
      log: ['query', 'info', 'warn', 'error'],
    };
  }
  
  return {
    log: ['warn', 'error'],
  };
}