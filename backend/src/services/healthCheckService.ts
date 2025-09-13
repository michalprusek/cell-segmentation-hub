/**
 * Centralized Health Check Service
 * Provides comprehensive health monitoring for all services
 */

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  checks: {
    [key: string]: ComponentHealth;
  };
  metrics?: SystemMetrics;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  responseTime?: number;
  details?: Record<string, unknown>;
  lastCheck: Date;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  requestsPerMinute?: number;
  activeConnections?: number;
  queueLength?: number;
}

export class HealthCheckService {
  private prisma: PrismaClient;
  private redis: Redis | null = null;
  private mlServiceUrl: string;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastHealthStatus: HealthStatus | null = null;
  private healthHistory: HealthStatus[] = [];
  private maxHistorySize = 100;

  constructor() {
    this.prisma = new PrismaClient();
    this.mlServiceUrl = process.env.ML_SERVICE_URL || 'http://blue-ml:8000';
    this.initializeRedis();
  }

  private initializeRedis() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://redis-blue:6379';
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 50, 2000),
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.redis.on('error', (err) => {
        logger.warn('Redis health check connection error:', err);
      });
    } catch (_error) {
      logger.warn('Redis initialization failed for health checks');
    }
  }

  /**
   * Perform comprehensive health check
   */
  async checkHealth(): Promise<HealthStatus> {
    const startTime = Date.now();
    const checks: { [key: string]: ComponentHealth } = {};

    // Check database
    checks.database = await this.checkDatabase();

    // Check Redis
    checks.redis = await this.checkRedis();

    // Check ML Service
    checks.mlService = await this.checkMLService();

    // Check file system
    checks.fileSystem = await this.checkFileSystem();

    // Check WebSocket
    checks.webSocket = await this.checkWebSocket();

    // Check email service
    checks.emailService = await this.checkEmailService();

    // Check monitoring services
    checks.monitoring = await this.checkMonitoring();

    // Calculate overall status
    const overallStatus = this.calculateOverallStatus(checks);

    // Get system metrics
    const metrics = this.getSystemMetrics();

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'production',
      checks,
      metrics,
    };

    // Store health status
    this.lastHealthStatus = healthStatus;
    this.addToHistory(healthStatus);

    // Store in Redis for distributed access
    if (this.redis) {
      try {
        await this.redis.setex(
          'health:current',
          60,
          JSON.stringify(healthStatus)
        );
      } catch (_error) {
        logger.warn('Failed to store health status in Redis');
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info(`Health check completed in ${totalTime}ms`, { status: overallStatus });

    return healthStatus;
  }

  /**
   * Check database health
   */
  private async checkDatabase(): Promise<ComponentHealth> {
    const startTime = Date.now();
    try {
      // Test connection with timeout
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database timeout')), 5000)
        ),
      ]);

      // Check connection pool
      const poolMetrics = await this.prisma.$metrics.json();
      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        message: 'Database connection is healthy',
        responseTime,
        details: {
          poolSize: poolMetrics?.counters?.find(
            (c: Record<string, unknown>) => c.key === 'prisma_pool_connections_open'
          )?.value,
        },
        lastCheck: new Date(),
      };
    } catch (error: unknown) {
      return {
        status: 'unhealthy',
        message: `Database error: ${error.message}`,
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check Redis health
   */
  private async checkRedis(): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    if (!this.redis) {
      return {
        status: 'degraded',
        message: 'Redis not configured',
        lastCheck: new Date(),
      };
    }

    try {
      const pong = await this.redis.ping();
      const info = await this.redis.info('memory');
      const responseTime = Date.now() - startTime;

      // Parse memory usage
      const usedMemoryMatch = info.match(/used_memory_human:(.+)/);
      const usedMemory = usedMemoryMatch ? usedMemoryMatch[1].trim() : 'unknown';

      return {
        status: 'healthy',
        message: 'Redis is operational',
        responseTime,
        details: {
          ping: pong,
          usedMemory,
          connected: this.redis.status === 'ready',
        },
        lastCheck: new Date(),
      };
    } catch (error: unknown) {
      return {
        status: 'unhealthy',
        message: `Redis error: ${error.message}`,
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check ML Service health
   */
  private async checkMLService(): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(`${this.mlServiceUrl}/api/v1/health`, {
        timeout: 5000,
      });

      const responseTime = Date.now() - startTime;

      return {
        status: response.data.status === 'healthy' ? 'healthy' : 'degraded',
        message: 'ML service is operational',
        responseTime,
        details: {
          modelsLoaded: response.data.models_loaded,
          gpuAvailable: response.data.gpu_available,
        },
        lastCheck: new Date(),
      };
    } catch (error: unknown) {
      return {
        status: 'unhealthy',
        message: `ML service error: ${error.message}`,
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check file system health
   */
  private async checkFileSystem(): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    try {
      const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
      
      // Check if upload directory exists and is writable
      await fs.access(uploadDir, fs.constants.W_OK | fs.constants.R_OK);
      
      // Check required subdirectories
      const requiredDirs = ['images', 'thumbnails', 'temp'];
      const missingDirs = [];
      
      for (const dir of requiredDirs) {
        const dirPath = path.join(uploadDir, dir);
        try {
          await fs.access(dirPath);
        } catch {
          missingDirs.push(dir);
        }
      }

      // Get disk usage
      const _stats = await fs.stat(uploadDir);
      const responseTime = Date.now() - startTime;

      return {
        status: missingDirs.length === 0 ? 'healthy' : 'degraded',
        message: missingDirs.length === 0 
          ? 'File system is accessible' 
          : `Missing directories: ${missingDirs.join(', ')}`,
        responseTime,
        details: {
          uploadDir,
          missingDirs,
          accessible: true,
        },
        lastCheck: new Date(),
      };
    } catch (error: unknown) {
      return {
        status: 'unhealthy',
        message: `File system error: ${error.message}`,
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check WebSocket health
   */
  private async checkWebSocket(): Promise<ComponentHealth> {
    // Check if WebSocket server is running
    const io = (global as any).io;
    
    if (!io) {
      return {
        status: 'unhealthy',
        message: 'WebSocket server not initialized',
        lastCheck: new Date(),
      };
    }

    try {
      const sockets = await io.fetchSockets();
      
      return {
        status: 'healthy',
        message: 'WebSocket server is operational',
        details: {
          connectedClients: sockets.length,
        },
        lastCheck: new Date(),
      };
    } catch (_error: unknown) {
      return {
        status: 'degraded',
        message: 'WebSocket status unknown',
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check email service health
   */
  private async checkEmailService(): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    try {
      // Import email service dynamically to avoid circular dependencies
      const { testConnection, _config } = await import('./emailService');
      
      // Check if email service is configured
      if (!process.env.SMTP_HOST && !process.env.SENDGRID_API_KEY) {
        return {
          status: 'degraded',
          message: 'Email service not configured',
          responseTime: Date.now() - startTime,
          details: {
            configured: false,
            reason: 'No SMTP or SendGrid configuration found'
          },
          lastCheck: new Date(),
        };
      }
      
      // Skip email connectivity test in test environments
      if (process.env.NODE_ENV === 'test' || process.env.SKIP_EMAIL_SEND === 'true') {
        return {
          status: 'healthy',
          message: 'Email service configured (test mode)',
          responseTime: Date.now() - startTime,
          details: {
            configured: true,
            testMode: true,
            smtpHost: process.env.SMTP_HOST,
            service: process.env.EMAIL_SERVICE || 'smtp'
          },
          lastCheck: new Date(),
        };
      }
      
      // Test email service connection
      const isConnected = await testConnection();
      const responseTime = Date.now() - startTime;
      
      if (isConnected) {
        return {
          status: 'healthy',
          message: 'Email service is operational',
          responseTime,
          details: {
            configured: true,
            connected: true,
            smtpHost: process.env.SMTP_HOST,
            service: process.env.EMAIL_SERVICE || 'smtp',
            fromEmail: process.env.FROM_EMAIL,
            authEnabled: process.env.SMTP_AUTH !== 'false'
          },
          lastCheck: new Date(),
        };
      } else {
        return {
          status: 'unhealthy',
          message: 'Email service connection failed',
          responseTime,
          details: {
            configured: true,
            connected: false,
            smtpHost: process.env.SMTP_HOST,
            service: process.env.EMAIL_SERVICE || 'smtp'
          },
          lastCheck: new Date(),
        };
      }
    } catch (error: unknown) {
      return {
        status: 'unhealthy',
        message: `Email service error: ${error.message}`,
        responseTime: Date.now() - startTime,
        details: {
          error: error.message,
          configured: !!(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY)
        },
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check monitoring services
   */
  private async checkMonitoring(): Promise<ComponentHealth> {
    const startTime = Date.now();
    const checks = {
      prometheus: false,
      grafana: false,
    };

    // Check Prometheus
    try {
      await axios.get('http://prometheus:9090/-/healthy', { timeout: 2000 });
      checks.prometheus = true;
    } catch {
      // Prometheus not available
    }

    // Check Grafana
    try {
      await axios.get('http://grafana:3000/api/health', { timeout: 2000 });
      checks.grafana = true;
    } catch {
      // Grafana not available
    }

    const allHealthy = Object.values(checks).every(v => v);
    const someHealthy = Object.values(checks).some(v => v);

    return {
      status: allHealthy ? 'healthy' : someHealthy ? 'degraded' : 'unhealthy',
      message: `Monitoring services: Prometheus ${checks.prometheus ? '✓' : '✗'}, Grafana ${checks.grafana ? '✓' : '✗'}`,
      responseTime: Date.now() - startTime,
      details: checks,
      lastCheck: new Date(),
    };
  }

  /**
   * Calculate overall health status
   */
  private calculateOverallStatus(checks: { [key: string]: ComponentHealth }): 'healthy' | 'degraded' | 'unhealthy' {
    const statuses = Object.values(checks).map(c => c.status);
    
    if (statuses.every(s => s === 'healthy')) {
      return 'healthy';
    }
    
    if (statuses.some(s => s === 'unhealthy')) {
      // Critical services that must be healthy
      const criticalServices = ['database', 'fileSystem'];
      const criticalUnhealthy = criticalServices.some(
        service => checks[service]?.status === 'unhealthy'
      );
      
      return criticalUnhealthy ? 'unhealthy' : 'degraded';
    }
    
    return 'degraded';
  }

  /**
   * Get system metrics
   */
  private getSystemMetrics(): SystemMetrics {
    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      requestsPerMinute: this.getRequestRate(),
      activeConnections: this.getActiveConnections(),
      queueLength: this.getQueueLength(),
    };
  }

  /**
   * Get request rate (placeholder - integrate with your metrics)
   */
  private getRequestRate(): number {
    // This should integrate with your actual metrics collection
    return 0;
  }

  /**
   * Get active connections (placeholder)
   */
  private getActiveConnections(): number {
    const io = (global as any).io;
    return io ? io.engine.clientsCount : 0;
  }

  /**
   * Get queue length (placeholder)
   */
  private getQueueLength(): number {
    // This should query your actual queue service
    return 0;
  }

  /**
   * Add health status to history
   */
  private addToHistory(status: HealthStatus) {
    this.healthHistory.push(status);
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory.shift();
    }
  }

  /**
   * Get health history
   */
  getHealthHistory(): HealthStatus[] {
    return this.healthHistory;
  }

  /**
   * Get last health status
   */
  getLastHealthStatus(): HealthStatus | null {
    return this.lastHealthStatus;
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(intervalMs = 30000) {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // Initial check
    this.checkHealth().catch(err => 
      logger.error('Health check failed:', err)
    );

    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.checkHealth().catch(err => 
        logger.error('Health check failed:', err)
      );
    }, intervalMs);

    logger.info(`Health check service started with ${intervalMs}ms interval`);
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Health check service stopped');
    }
  }

  /**
   * Check if system is ready for deployment
   */
  async isReadyForDeployment(): Promise<{ ready: boolean; issues: string[] }> {
    const issues: string[] = [];
    const health = await this.checkHealth();

    // Check critical services
    if (health.checks.database?.status !== 'healthy') {
      issues.push('Database is not healthy');
    }

    if (health.checks.fileSystem?.status !== 'healthy') {
      issues.push('File system is not accessible');
    }

    // Check memory usage
    const memoryUsage = health.metrics?.memoryUsage;
    if (memoryUsage) {
      const usedMemoryPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      if (usedMemoryPercent > 90) {
        issues.push(`High memory usage: ${usedMemoryPercent.toFixed(1)}%`);
      }
    }

    return {
      ready: issues.length === 0,
      issues,
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.stopPeriodicChecks();
    
    if (this.redis) {
      await this.redis.quit();
    }
    
    await this.prisma.$disconnect();
  }
}

// Export singleton instance
export const healthCheckService = new HealthCheckService();