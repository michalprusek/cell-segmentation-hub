import { logger } from '../utils/logger';

/**
 * Database configuration
 */
export interface DatabaseConfig {
  connectionString: string;
  poolSize: number;
  maxPoolSize: number;
  idleTimeout: number;
  connectionTimeout: number;
  statementTimeout: number;
  queryTimeout: number;
  ssl: boolean;
  retryAttempts: number;
  retryDelay: number;
  enableLogging: boolean;
  slowQueryThreshold: number;
}

/**
 * Get database configuration from environment
 */
export function getDatabaseConfig(): DatabaseConfig {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/spheroseg',
    poolSize: parseInt(process.env.DB_POOL_SIZE || '5'),
    maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '15'),
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'), // 30 seconds
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000'), // 10 seconds
    statementTimeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000'), // 30 seconds
    queryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000'), // 30 seconds
    ssl: process.env.DB_SSL === 'true' || isProduction,
    retryAttempts: parseInt(process.env.DB_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.DB_RETRY_DELAY || '1000'), // 1 second
    enableLogging: process.env.DB_ENABLE_LOGGING === 'true' || isDevelopment,
    slowQueryThreshold: parseInt(process.env.DB_SLOW_QUERY_THRESHOLD || '1000'), // 1 second
  };
}

/**
 * Parse database URL into components
 */
export function parseDatabaseUrl(url: string): {
  protocol: string;
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
} | null {
  try {
    const urlPattern = /^(postgresql|postgres):\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(.+)$/;
    const match = url.match(urlPattern);
    
    if (!match) {
      logger.error('Invalid database URL format');
      return null;
    }
    
    return {
      protocol: match[1],
      username: match[2],
      password: match[3],
      host: match[4],
      port: parseInt(match[5]),
      database: match[6],
    };
  } catch (error) {
    logger.error('Failed to parse database URL:', error);
    return null;
  }
}

/**
 * Get connection pool configuration for Prisma
 */
export function getPrismaPoolConfig(): {
  connection_limit: number;
  pool_timeout: number;
  statement_timeout: number;
  connect_timeout: number;
} {
  const config = getDatabaseConfig();
  
  return {
    connection_limit: config.maxPoolSize,
    pool_timeout: config.idleTimeout / 1000, // Convert to seconds
    statement_timeout: config.statementTimeout / 1000, // Convert to seconds
    connect_timeout: config.connectionTimeout / 1000, // Convert to seconds
  };
}

/**
 * Get database connection string with pool parameters
 */
export function getConnectionStringWithPool(): string {
  const config = getDatabaseConfig();
  const poolConfig = getPrismaPoolConfig();
  
  let connectionString = config.connectionString;
  
  // Add pool parameters to connection string
  const separator = connectionString.includes('?') ? '&' : '?';
  connectionString += `${separator}connection_limit=${poolConfig.connection_limit}`;
  connectionString += `&pool_timeout=${poolConfig.pool_timeout}`;
  connectionString += `&statement_timeout=${poolConfig.statement_timeout}`;
  connectionString += `&connect_timeout=${poolConfig.connect_timeout}`;
  
  return connectionString;
}

/**
 * Validate database configuration
 */
export function validateDatabaseConfig(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const config = getDatabaseConfig();
  
  if (!config.connectionString) {
    errors.push('DATABASE_URL is not set');
  }
  
  if (config.poolSize <= 0) {
    errors.push('Pool size must be greater than 0');
  }
  
  if (config.maxPoolSize < config.poolSize) {
    errors.push('Max pool size must be greater than or equal to pool size');
  }
  
  if (config.connectionTimeout <= 0) {
    errors.push('Connection timeout must be greater than 0');
  }
  
  if (config.slowQueryThreshold <= 0) {
    errors.push('Slow query threshold must be greater than 0');
  }
  
  // Parse and validate connection string
  const parsed = parseDatabaseUrl(config.connectionString);
  if (!parsed) {
    errors.push('Invalid database connection string format');
  } else {
    if (!parsed.host) {
      errors.push('Database host is missing');
    }
    if (!parsed.database) {
      errors.push('Database name is missing');
    }
    if (!parsed.username) {
      errors.push('Database username is missing');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get database pool configuration
 */
export function getDatabasePoolConfig(): {
  minConnections: number;
  maxConnections: number;
  acquireTimeout: number;
  createTimeout: number;
} {
  const config = getDatabaseConfig();
  
  return {
    minConnections: config.poolSize,
    maxConnections: config.maxPoolSize,
    acquireTimeout: config.connectionTimeout,
    createTimeout: config.connectionTimeout,
  };
}

/**
 * Get retry configuration
 */
export function getRetryConfig(): {
  attempts: number;
  delay: number;
  backoffMultiplier: number;
} {
  const config = getDatabaseConfig();
  
  return {
    attempts: config.retryAttempts,
    delay: config.retryDelay,
    backoffMultiplier: 2, // Double delay on each retry
  };
}

/**
 * Get health check configuration
 */
export function getHealthCheckConfig(): {
  enabled: boolean;
  interval: number;
  timeout: number;
} {
  return {
    enabled: process.env.DB_HEALTH_CHECK_ENABLED !== 'false',
    interval: parseInt(process.env.DB_HEALTH_CHECK_INTERVAL || '30000'), // 30 seconds
    timeout: parseInt(process.env.DB_HEALTH_CHECK_TIMEOUT || '5000'), // 5 seconds
  };
}

/**
 * Get performance baselines
 */
export function getPerformanceBaselines(): {
  slowQueryThreshold: number;
  connectionPoolWarning: number;
  memoryWarning: number;
} {
  const config = getDatabaseConfig();
  
  return {
    slowQueryThreshold: config.slowQueryThreshold,
    connectionPoolWarning: Math.floor(config.maxPoolSize * 0.8), // 80% usage warning
    memoryWarning: parseInt(process.env.DB_MEMORY_WARNING_MB || '512'), // 512MB warning
  };
}

/**
 * Log database pool configuration (alias for compatibility)
 */
export function logDatabasePoolConfig(): void {
  logDatabaseConfig();
}

/**
 * Log database configuration (masks sensitive data)
 */
export function logDatabaseConfig(): void {
  const config = getDatabaseConfig();
  const parsed = parseDatabaseUrl(config.connectionString);
  
  logger.info('Database configuration:', 'DatabaseConfig', {
    host: parsed?.host || 'unknown',
    port: parsed?.port || 'unknown',
    database: parsed?.database || 'unknown',
    username: parsed?.username || 'unknown',
    poolSize: config.poolSize,
    maxPoolSize: config.maxPoolSize,
    ssl: config.ssl,
    enableLogging: config.enableLogging,
    slowQueryThreshold: `${config.slowQueryThreshold}ms`,
  });
}

// Export configuration
export const databaseConfig = getDatabaseConfig();