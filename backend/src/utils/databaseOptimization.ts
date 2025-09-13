import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

/**
 * Database optimization utilities for performance tuning and query optimization
 */

export interface QueryOptimizationConfig {
  enableIndexOptimization: boolean;
  enableQueryAnalysis: boolean;
  slowQueryThreshold: number;
  maxConnectionPool: number;
}

export interface DatabasePerformanceMetrics {
  totalQueries: number;
  slowQueries: number;
  averageQueryTime: number;
  connectionPoolUsage: number;
  lastOptimizationRun: Date | null;
}

class DatabaseOptimization {
  private prisma: PrismaClient | null = null;
  private config: QueryOptimizationConfig;
  private metrics: DatabasePerformanceMetrics;
  private queryTimings: Map<string, number[]> = new Map();

  constructor() {
    this.config = {
      enableIndexOptimization: process.env.NODE_ENV === 'production',
      enableQueryAnalysis: true,
      slowQueryThreshold: 1000, // 1 second
      maxConnectionPool: parseInt(process.env.DATABASE_CONNECTION_LIMIT || '10', 10)
    };

    this.metrics = {
      totalQueries: 0,
      slowQueries: 0,
      averageQueryTime: 0,
      connectionPoolUsage: 0,
      lastOptimizationRun: null
    };
  }

  /**
   * Initialize database optimization with Prisma client
   */
  public initialize(prismaClient: PrismaClient): void {
    this.prisma = prismaClient;
    logger.info('Database optimization initialized', 'DatabaseOptimization');
  }

  /**
   * Track query performance
   */
  public trackQuery(queryName: string, duration: number): void {
    if (!this.config.enableQueryAnalysis) {return;}

    this.metrics.totalQueries++;
    
    if (duration > this.config.slowQueryThreshold) {
      this.metrics.slowQueries++;
      logger.warn(`Slow query detected: ${queryName} took ${duration}ms`, 'DatabaseOptimization');
    }

    // Track query timings for analysis
    if (!this.queryTimings.has(queryName)) {
      this.queryTimings.set(queryName, []);
    }
    
    const timings = this.queryTimings.get(queryName);
    if (!timings) {
      return;
    }
    timings.push(duration);
    
    // Keep only last 100 timings per query
    if (timings.length > 100) {
      timings.shift();
    }

    // Update average query time
    const totalTime = Array.from(this.queryTimings.values())
      .flat()
      .reduce((sum, time) => sum + time, 0);
    
    this.metrics.averageQueryTime = totalTime / this.metrics.totalQueries;
  }

  /**
   * Get performance metrics
   */
  public getMetrics(): DatabasePerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Get slow query analysis
   */
  public getSlowQueryAnalysis(): { queryName: string; averageTime: number; count: number }[] {
    const analysis: { queryName: string; averageTime: number; count: number }[] = [];

    this.queryTimings.forEach((timings, queryName) => {
      const slowTimings = timings.filter(time => time > this.config.slowQueryThreshold);
      if (slowTimings.length > 0) {
        const averageTime = slowTimings.reduce((sum, time) => sum + time, 0) / slowTimings.length;
        analysis.push({
          queryName,
          averageTime,
          count: slowTimings.length
        });
      }
    });

    return analysis.sort((a, b) => b.averageTime - a.averageTime);
  }

  /**
   * Run database optimization tasks
   */
  public async runOptimization(): Promise<void> {
    if (!this.prisma || !this.config.enableIndexOptimization) {
      return;
    }

    try {
      logger.info('Running database optimization tasks...', 'DatabaseOptimization');
      
      // Analyze table statistics (SQLite specific)
      if (process.env.DATABASE_URL?.includes('sqlite')) {
        await this.prisma.$executeRaw`ANALYZE`;
        logger.info('SQLite ANALYZE completed', 'DatabaseOptimization');
      }

      this.metrics.lastOptimizationRun = new Date();
      logger.info('Database optimization completed', 'DatabaseOptimization');
      
    } catch (error) {
      logger.error('Database optimization failed:', error as Error, 'DatabaseOptimization');
    }
  }

  /**
   * Get optimization recommendations
   */
  public getOptimizationRecommendations(): string[] {
    const recommendations: string[] = [];
    
    if (this.metrics.slowQueries > this.metrics.totalQueries * 0.1) {
      recommendations.push('High number of slow queries detected. Consider adding database indexes.');
    }

    if (this.metrics.averageQueryTime > 500) {
      recommendations.push('Average query time is high. Review query complexity and indexing strategy.');
    }

    const slowQueries = this.getSlowQueryAnalysis();
    if (slowQueries.length > 0) {
      const topSlow = slowQueries[0];
      recommendations.push(`Slowest query: ${topSlow.queryName} (avg: ${topSlow.averageTime.toFixed(2)}ms)`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Database performance is within acceptable parameters.');
    }

    return recommendations;
  }

  /**
   * Reset metrics (useful for testing or periodic resets)
   */
  public resetMetrics(): void {
    this.metrics = {
      totalQueries: 0,
      slowQueries: 0,
      averageQueryTime: 0,
      connectionPoolUsage: 0,
      lastOptimizationRun: null
    };
    this.queryTimings.clear();
    logger.info('Database optimization metrics reset', 'DatabaseOptimization');
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<QueryOptimizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Database optimization configuration updated', 'DatabaseOptimization', newConfig);
  }

  /**
   * Get current configuration
   */
  public getConfig(): QueryOptimizationConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const databaseOptimization = new DatabaseOptimization();

// Export default
export default databaseOptimization;