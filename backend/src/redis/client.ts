import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export class RedisClient {
  private client: RedisClientType | null = null;
  private connected = false;

  constructor() {
    // Redis is optional - if not configured, operations will be no-ops
    if (process.env.REDIS_URL) {
      this.client = createClient({
        url: process.env.REDIS_URL
      });
      
      this.client.on('error', (err: Error) => {
        logger.error('Redis Client Error', err);
      });
      
      this.connect();
    }
  }

  private async connect(): Promise<void> {
    if (!this.client) {
      return;
    }
    
    try {
      await this.client.connect();
      this.connected = true;
      logger.info('Redis connected');
    } catch (error) {
      logger.warn('Redis connection failed, continuing without cache:', 'RedisClient', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.connected || !this.client) {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error('Redis get error:', error instanceof Error ? error : new Error(String(error)), 'RedisClient');
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }
    try {
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error('Redis set error:', error instanceof Error ? error : new Error(String(error)), 'RedisClient');
    }
  }

  async del(key: string): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error('Redis delete error:', error instanceof Error ? error : new Error(String(error)), 'RedisClient');
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected && this.client) {
      await this.client.disconnect();
      this.connected = false;
    }
  }
}

export const redisClient = new RedisClient();