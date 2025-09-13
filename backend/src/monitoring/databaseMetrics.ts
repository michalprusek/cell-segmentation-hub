import client from 'prom-client';
import { logger } from '../utils/logger';

// Database metrics registry
const dbMetricsRegistry = new client.Registry();

// Database connection pool metrics
export const dbConnectionPoolSize = new client.Gauge({
  name: 'db_connection_pool_size',
  help: 'Database connection pool size',
  labelNames: ['state'],
  registers: [dbMetricsRegistry],
});

export const dbConnectionPoolWaitCount = new client.Gauge({
  name: 'db_connection_pool_wait_count',
  help: 'Number of requests waiting for a connection',
  registers: [dbMetricsRegistry],
});

// Database query metrics
export const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query execution time',
  labelNames: ['operation', 'model', 'status'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
  registers: [dbMetricsRegistry],
});

export const dbQueryTotal = new client.Counter({
  name: 'db_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'model', 'status'],
  registers: [dbMetricsRegistry],
});

export const dbTransactionDuration = new client.Histogram({
  name: 'db_transaction_duration_seconds',
  help: 'Database transaction execution time',
  labelNames: ['status'],
  buckets: [0.01, 0.1, 0.5, 1, 2, 5, 10],
  registers: [dbMetricsRegistry],
});

export const dbConnectionErrors = new client.Counter({
  name: 'db_connection_errors_total',
  help: 'Total number of database connection errors',
  labelNames: ['error_type'],
  registers: [dbMetricsRegistry],
});

// Slow query tracking
export const dbSlowQueries = new client.Counter({
  name: 'db_slow_queries_total',
  help: 'Total number of slow queries (>1s)',
  labelNames: ['operation', 'model'],
  registers: [dbMetricsRegistry],
});

// Database size metrics
export const dbTableSize = new client.Gauge({
  name: 'db_table_size_bytes',
  help: 'Size of database tables in bytes',
  labelNames: ['table_name'],
  registers: [dbMetricsRegistry],
});

export const dbIndexSize = new client.Gauge({
  name: 'db_index_size_bytes',
  help: 'Size of database indexes in bytes',
  labelNames: ['index_name'],
  registers: [dbMetricsRegistry],
});

/**
 * Track database query
 */
export function trackDatabaseQuery(
  operation: string,
  model: string,
  duration: number,
  success: boolean
): void {
  try {
    const status = success ? 'success' : 'failure';
    
    dbQueryTotal.inc({
      operation,
      model,
      status,
    });
    
    dbQueryDuration.observe(
      { operation, model, status },
      duration / 1000 // Convert ms to seconds
    );
    
    // Track slow queries
    if (duration > 1000) {
      dbSlowQueries.inc({ operation, model });
      logger.warn(`Slow query detected: ${operation} on ${model} took ${duration}ms`);
    }
  } catch (error) {
    logger.error('Failed to track database query metric:', error);
  }
}

/**
 * Track database transaction
 */
export function trackDatabaseTransaction(duration: number, success: boolean): void {
  try {
    const status = success ? 'success' : 'failure';
    
    dbTransactionDuration.observe(
      { status },
      duration / 1000 // Convert ms to seconds
    );
  } catch (error) {
    logger.error('Failed to track database transaction metric:', error);
  }
}

/**
 * Track connection error
 */
export function trackConnectionError(errorType: string): void {
  try {
    dbConnectionErrors.inc({ error_type: errorType });
  } catch (error) {
    logger.error('Failed to track connection error metric:', error);
  }
}

/**
 * Update connection pool metrics
 */
export function updateConnectionPoolMetrics(
  active: number,
  idle: number,
  waiting: number
): void {
  try {
    dbConnectionPoolSize.set({ state: 'active' }, active);
    dbConnectionPoolSize.set({ state: 'idle' }, idle);
    dbConnectionPoolSize.set({ state: 'total' }, active + idle);
    dbConnectionPoolWaitCount.set(waiting);
  } catch (error) {
    logger.error('Failed to update connection pool metrics:', error);
  }
}

/**
 * Update database size metrics
 */
export function updateDatabaseSizeMetrics(
  tables: Array<{ name: string; size: number }>,
  indexes: Array<{ name: string; size: number }>
): void {
  try {
    for (const table of tables) {
      dbTableSize.set({ table_name: table.name }, table.size);
    }
    
    for (const index of indexes) {
      dbIndexSize.set({ index_name: index.name }, index.size);
    }
  } catch (error) {
    logger.error('Failed to update database size metrics:', error);
  }
}

/**
 * Initialize database metrics collection
 */
export function initializeDatabaseMetrics(): void {
  try {
    logger.info('Initializing database metrics collection...');
    
    // Set initial values
    updateConnectionPoolMetrics(0, 0, 0);
    
    // Initialize table size metrics with placeholder values
    updateDatabaseSizeMetrics(
      [
        { name: 'User', size: 0 },
        { name: 'Project', size: 0 },
        { name: 'ProjectImage', size: 0 },
        { name: 'SegmentationResult', size: 0 },
        { name: 'QueueItem', size: 0 },
      ],
      [
        { name: 'User_email_idx', size: 0 },
        { name: 'Project_userId_idx', size: 0 },
        { name: 'ProjectImage_projectId_idx', size: 0 },
      ]
    );
    
    logger.info('✅ Database metrics collection initialized');
  } catch (error) {
    logger.error('Failed to initialize database metrics collection:', error);
  }
}

/**
 * Get database metrics summary
 */
export async function getDatabaseMetricsSummary(): Promise<{
  totalQueries: number;
  totalSlowQueries: number;
  totalErrors: number;
  avgQueryTime: number;
  connectionPoolSize: number;
}> {
  try {
    const metrics = await dbMetricsRegistry.getMetricsAsJSON();
    
    const getMetricValue = (name: string): number => {
      const metric = metrics.find(m => m.name === name);
      if (!metric || !metric.values) {return 0;}
      
      return metric.values.reduce((sum, v) => sum + (v.value || 0), 0);
    };
    
    const getMetricAverage = (name: string): number => {
      const metric = metrics.find(m => m.name === name);
      if (!metric || !metric.values) {return 0;}
      
      const values = metric.values.filter(v => v.value);
      if (values.length === 0) {return 0;}
      
      const sum = values.reduce((acc, v) => acc + (v.value || 0), 0);
      return sum / values.length;
    };
    
    return {
      totalQueries: getMetricValue('db_queries_total'),
      totalSlowQueries: getMetricValue('db_slow_queries_total'),
      totalErrors: getMetricValue('db_connection_errors_total'),
      avgQueryTime: getMetricAverage('db_query_duration_seconds'),
      connectionPoolSize: getMetricValue('db_connection_pool_size'),
    };
  } catch (error) {
    logger.error('Failed to get database metrics summary:', error);
    return {
      totalQueries: 0,
      totalSlowQueries: 0,
      totalErrors: 0,
      avgQueryTime: 0,
      connectionPoolSize: 0,
    };
  }
}

/**
 * Database metrics service for managing database performance tracking
 */
class DatabaseMetricsService {
  private isStarted = false;
  
  /**
   * Start database metrics collection
   */
  public start(): void {
    if (this.isStarted) {return;}
    
    try {
      initializeDatabaseMetrics();
      this.isStarted = true;
      logger.info('Database metrics service started');
    } catch (error) {
      logger.error('Failed to start database metrics service:', error);
    }
  }
  
  /**
   * Stop database metrics collection
   */
  public stop(): void {
    if (!this.isStarted) {return;}
    
    try {
      // Reset all metrics
      dbQueryTotal.reset();
      dbQueryDuration.reset();
      dbTransactionDuration.reset();
      dbConnectionErrors.reset();
      dbSlowQueries.reset();
      dbConnectionPoolSize.reset();
      dbConnectionPoolWaitCount.reset();
      dbTableSize.reset();
      dbIndexSize.reset();
      
      this.isStarted = false;
      logger.info('Database metrics service stopped');
    } catch (error) {
      logger.error('Failed to stop database metrics service:', error);
    }
  }
  
  /**
   * Track a database query
   */
  public trackQuery(operation: string, model: string, duration: number, success: boolean): void {
    trackDatabaseQuery(operation, model, duration, success);
  }
  
  /**
   * Track a database transaction
   */
  public trackTransaction(duration: number, success: boolean): void {
    trackDatabaseTransaction(duration, success);
  }
  
  /**
   * Track a connection error
   */
  public trackConnectionError(errorType: string): void {
    trackConnectionError(errorType);
  }
  
  /**
   * Update connection pool metrics
   */
  public updateConnectionPool(active: number, idle: number, waiting: number): void {
    updateConnectionPoolMetrics(active, idle, waiting);
  }
  
  /**
   * Get metrics summary
   */
  public async getMetricsSummary() {
    return await getDatabaseMetricsSummary();
  }
}

// Create and export singleton instance
export const databaseMetrics = new DatabaseMetricsService();

// Export registry for merging with main registry
export { dbMetricsRegistry };