import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

let redisClient: RedisClientType | null = null;
let isRedisConnected = false;

/**
 * Redis configuration
 */
const redisConfig = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries: number) => {
      if (retries > 10) {
        logger.error('Redis: Maximum reconnection attempts reached');
        return new Error('Maximum reconnection attempts reached');
      }
      const delay = Math.min(retries * 100, 3000);
      logger.info(`Redis: Reconnecting attempt ${retries}, delay: ${delay}ms`);
      return delay;
    },
    connectTimeout: 10000,
  },
  lazyConnect: false,
};

/**
 * Initialize Redis connection
 */
export async function initializeRedis(): Promise<void> {
  try {
    if (redisClient) {
      logger.warn('Redis client already initialized');
      return;
    }

    logger.info('Initializing Redis connection...');
    
    redisClient = createClient(redisConfig);

    // Set up event handlers
    redisClient.on('error', (error: Error) => {
      logger.error('Redis Client Error:', error);
      isRedisConnected = false;
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
      isRedisConnected = true;
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
      isRedisConnected = true;
    });

    redisClient.on('end', () => {
      logger.info('Redis client connection closed');
      isRedisConnected = false;
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
      isRedisConnected = false;
    });

    // Connect to Redis
    await redisClient.connect();
    
    // Test the connection
    await redisClient.ping();
    
    logger.info('✅ Redis connection established successfully');
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    // Don't throw - allow app to run without Redis if needed
    isRedisConnected = false;
  }
}

/**
 * Get Redis client instance
 */
export function getRedisClient(): RedisClientType | null {
  if (!redisClient) {
    logger.warn('Redis client not initialized');
    return null;
  }
  
  if (!isRedisConnected) {
    logger.warn('Redis client not connected');
    return null;
  }
  
  return redisClient;
}

/**
 * Check Redis health
 */
export async function redisHealthCheck(): Promise<{
  status: 'healthy' | 'unhealthy';
  message: string;
  details?: Record<string, unknown>;
}> {
  try {
    if (!redisClient) {
      return {
        status: 'unhealthy',
        message: 'Redis client not initialized',
      };
    }

    if (!isRedisConnected) {
      return {
        status: 'unhealthy',
        message: 'Redis client not connected',
      };
    }

    // Perform a simple ping
    const pingResult = await redisClient.ping();
    
    // Get some basic info
    const _info = await redisClient.info('server');
    const memoryInfo = await redisClient.info('memory');
    
    // Parse memory usage
    const usedMemoryMatch = memoryInfo.match(/used_memory_human:([^\r\n]+)/);
    const usedMemory = usedMemoryMatch ? usedMemoryMatch[1] : 'unknown';
    
    return {
      status: 'healthy',
      message: 'Redis is operational',
      details: {
        ping: pingResult,
        connected: isRedisConnected,
        usedMemory,
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      },
    };
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return {
      status: 'unhealthy',
      message: 'Redis health check failed',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  try {
    if (redisClient) {
      logger.info('Closing Redis connection...');
      await redisClient.quit();
      redisClient = null;
      isRedisConnected = false;
      logger.info('Redis connection closed successfully');
    }
  } catch (error) {
    logger.error('Error closing Redis connection:', error);
    // Force disconnect if quit fails
    if (redisClient) {
      await redisClient.disconnect();
      redisClient = null;
      isRedisConnected = false;
    }
  }
}

/**
 * Check if Redis is connected
 */
export function isRedisHealthy(): boolean {
  return isRedisConnected && redisClient !== null;
}

/**
 * Execute a Redis command with error handling
 */
export async function executeRedisCommand<T>(
  command: (client: RedisClientType) => Promise<T>,
  fallback?: T
): Promise<T | undefined> {
  const client = getRedisClient();
  
  if (!client) {
    logger.warn('Redis command skipped - client not available');
    return fallback;
  }
  
  try {
    return await command(client);
  } catch (error) {
    logger.error('Redis command failed:', error);
    return fallback;
  }
}

// Export for testing
export { redisClient, isRedisConnected };