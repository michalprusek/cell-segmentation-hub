import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { getPrismaConfig } from './prismaConfig';

/**
 * Connection pool configuration for Prisma
 */
interface PoolConfig {
  connectionLimit: number;
  maxIdleTime: number;
  queueLimit: number;
  enablePoolLogging: boolean;
}

/**
 * Pool statistics
 */
interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  errors: number;
  lastError?: string;
  uptime: number;
  startTime: Date;
}

class PrismaPool {
  private clients: PrismaClient[] = [];
  private activeClients: Set<PrismaClient> = new Set();
  private idleClients: PrismaClient[] = [];
  private waitQueue: Array<(client: PrismaClient) => void> = [];
  private config: PoolConfig;
  private stats: PoolStats;
  private isShuttingDown = false;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config?: Partial<PoolConfig>) {
    this.config = {
      connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || '15'),
      maxIdleTime: 30000, // 30 seconds
      queueLimit: 100,
      enablePoolLogging: process.env.NODE_ENV === 'development',
      ...config,
    };

    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      errors: 0,
      uptime: 0,
      startTime: new Date(),
    };

    // Don't call initialize in constructor - it should be called explicitly
  }

  /**
   * Initialize the connection pool
   */
  public async initialize(): Promise<void> {
    const maxRetries = 5;
    const retryDelay = 5000; // 5 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `Initializing Prisma connection pool (attempt ${attempt}/${maxRetries})`
        );

        // Create initial connections
        const initialConnections = Math.min(5, this.config.connectionLimit);
        for (let i = 0; i < initialConnections; i++) {
          await this.createConnection();
        }

        // Start health check interval
        this.startHealthCheck();

        logger.info(
          `✅ Prisma pool initialized with ${this.clients.length} connections`
        );
        return; // Success
      } catch (error) {
        logger.error(
          `Failed to initialize Prisma pool (attempt ${attempt}/${maxRetries}):`,
          error
        );

        if (attempt === maxRetries) {
          throw error;
        }

        logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  /**
   * Create a new database connection
   */
  private async createConnection(): Promise<PrismaClient> {
    if (this.clients.length >= this.config.connectionLimit) {
      throw new Error('Connection limit reached');
    }

    const clientConfig = getPrismaConfig() || {};
    // Override log level based on pool config
    if (this.config.enablePoolLogging) {
      clientConfig.log = ['query', 'info', 'warn', 'error'];
    }
     
    const client = new PrismaClient(clientConfig as any);

    try {
      // Test the connection
      await client.$connect();

      this.clients.push(client);
      this.idleClients.push(client);
      this.stats.totalConnections++;
      this.stats.idleConnections++;

      if (this.config.enablePoolLogging) {
        logger.debug(
          `Created new database connection (total: ${this.clients.length})`
        );
      }

      return client;
    } catch (error) {
      logger.error('Failed to create database connection:', error);
      this.stats.errors++;
      this.stats.lastError =
        error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PrismaClient> {
    if (this.isShuttingDown) {
      throw new Error('Pool is shutting down');
    }

    // Try to get an idle connection
    if (this.idleClients.length > 0) {
      const client = this.idleClients.pop();
      if (client) {
        this.activeClients.add(client);
        this.stats.idleConnections--;
        this.stats.activeConnections++;
        return client;
      }
    }

    // Create a new connection if under limit
    if (this.clients.length < this.config.connectionLimit) {
      try {
        const client = await this.createConnection();
        this.idleClients.pop(); // Remove from idle
        this.activeClients.add(client);
        this.stats.idleConnections--;
        this.stats.activeConnections++;
        return client;
      } catch (error) {
        logger.error('Failed to create new connection:', error);
        throw error;
      }
    }

    // Wait for a connection to become available
    if (this.waitQueue.length >= this.config.queueLimit) {
      throw new Error('Connection queue limit reached');
    }

    return new Promise((resolve, reject) => {
      this.stats.waitingRequests++;

      const timeout = setTimeout(() => {
        const index = this.waitQueue.indexOf(resolve);
        if (index > -1) {
          this.waitQueue.splice(index, 1);
          this.stats.waitingRequests--;
        }
        reject(new Error('Connection acquisition timeout'));
      }, 30000); // 30 second timeout

      const wrappedResolve = (client: PrismaClient): void => {
        clearTimeout(timeout);
        this.stats.waitingRequests--;
        resolve(client);
      };

      this.waitQueue.push(wrappedResolve);
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(client: PrismaClient): void {
    if (!this.activeClients.has(client)) {
      logger.warn('Attempted to release a client that is not active');
      return;
    }

    this.activeClients.delete(client);
    this.stats.activeConnections--;

    if (this.isShuttingDown) {
      // If shutting down, disconnect the client
      client.$disconnect().catch(error => {
        logger.error('Error disconnecting client during shutdown:', error);
      });
      return;
    }

    // Give the connection to a waiting request or return to idle pool
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift();
      if (resolve) {
        this.activeClients.add(client);
        this.stats.activeConnections++;
        resolve(client);
      }
    } else {
      this.idleClients.push(client);
      this.stats.idleConnections++;
    }
  }

  /**
   * Execute a function with a pooled connection
   */
  async execute<T>(fn: (client: PrismaClient) => Promise<T>): Promise<T> {
    const client = await this.acquire();
    try {
      return await fn(client);
    } finally {
      this.release(client);
    }
  }

  /**
   * Execute a query with a pooled connection
   */
  async executeQuery<T>(
    operation: () => Promise<T>,
    _options?: { operationType?: string; operationName?: string }
  ): Promise<T> {
    const client = await this.acquire();
    try {
      return await operation();
    } finally {
      this.release(client);
    }
  }

  /**
   * Execute a mutation with a pooled connection
   */
  async executeMutation<T>(
    operation: () => Promise<T>,
    _operationName?: string
  ): Promise<T> {
    const client = await this.acquire();
    try {
      return await operation();
    } finally {
      this.release(client);
    }
  }

  /**
   * Execute a transaction with a pooled connection
   */
  async executeTransaction<T>(
    operation: (
      prisma: Omit<
        PrismaClient,
        | '$connect'
        | '$disconnect'
        | '$on'
        | '$transaction'
        | '$use'
        | '$extends'
      >
    ) => Promise<T>,
    _operationName?: string
  ): Promise<T> {
    const client = await this.acquire();
    try {
      return await client.$transaction(operation);
    } finally {
      this.release(client);
    }
  }

  /**
   * Get a Prisma client from the pool
   */
  getPrismaClient(): PrismaClient {
    // Return the first available client for compatibility
    // In production, this should be used carefully
    if (this.idleClients.length > 0) {
      return this.idleClients[0];
    } else if (this.clients.length > 0) {
      return this.clients[0];
    }
    throw new Error('No Prisma clients available in pool');
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime.getTime(),
    };
  }

  /**
   * Get pool configuration
   */
  getConfig(): PoolConfig {
    return { ...this.config };
  }

  /**
   * Public health check method
   */
  public async healthCheck(): Promise<{
    healthy: boolean;
    message: string;
    stats: PoolStats;
  }> {
    try {
      await this.internalHealthCheck();
      return {
        healthy: this.isHealthy(),
        message: 'Pool is healthy',
        stats: this.getStats(),
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Health check failed',
        stats: this.getStats(),
      };
    }
  }

  /**
   * Internal health check for all connections
   */
  private async internalHealthCheck(): Promise<void> {
    const unhealthyClients: PrismaClient[] = [];

    for (const client of this.idleClients) {
      try {
        await client.$queryRaw`SELECT 1`;
      } catch (error) {
        logger.warn('Unhealthy connection detected:', error);
        unhealthyClients.push(client);
        this.stats.errors++;
      }
    }

    // Remove unhealthy connections
    for (const client of unhealthyClients) {
      const index = this.idleClients.indexOf(client);
      if (index > -1) {
        this.idleClients.splice(index, 1);
        this.stats.idleConnections--;
      }

      const clientIndex = this.clients.indexOf(client);
      if (clientIndex > -1) {
        this.clients.splice(clientIndex, 1);
        this.stats.totalConnections--;
      }

      // Disconnect the unhealthy client
      client.$disconnect().catch(error => {
        logger.error('Error disconnecting unhealthy client:', error);
      });
    }

    // Replenish connections if needed
    const minConnections = Math.min(5, this.config.connectionLimit);
    while (this.clients.length < minConnections && !this.isShuttingDown) {
      try {
        await this.createConnection();
      } catch (error) {
        logger.error('Failed to replenish connection:', error);
        break;
      }
    }
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.internalHealthCheck().catch(error => {
        logger.error('Health check failed:', error);
      });
    }, 60000); // Check every minute
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Prisma connection pool...');
    this.isShuttingDown = true;

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Reject all waiting requests
    for (const resolve of this.waitQueue) {
      resolve(null as unknown as PrismaClient); // Will be caught by error handling
    }
    this.waitQueue = [];

    // Wait for active connections to be released (with timeout)
    const timeout = Date.now() + 10000; // 10 second timeout
    while (this.activeClients.size > 0 && Date.now() < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Disconnect all clients
    const disconnectPromises = this.clients.map(client =>
      client.$disconnect().catch(error => {
        logger.error('Error disconnecting client:', error);
      })
    );

    await Promise.all(disconnectPromises);

    this.clients = [];
    this.activeClients.clear();
    this.idleClients = [];

    logger.info('✅ Prisma connection pool shut down successfully');
  }

  /**
   * Check if pool is healthy
   */
  isHealthy(): boolean {
    return (
      !this.isShuttingDown && this.clients.length > 0 && this.stats.errors < 10
    ); // Threshold for errors
  }
}

// Create singleton instance
export const prismaPool = new PrismaPool();

// Export for testing
export { PrismaPool };
