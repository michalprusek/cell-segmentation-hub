# API Monitoring and Observability

This guide covers the comprehensive monitoring and observability system for the Cell Segmentation Hub API, including health checks, metrics collection, performance monitoring, and alerting strategies.

## Overview

The monitoring system provides multiple layers of observability:

- **Health Checks**: Application and service health monitoring
- **Metrics Collection**: Prometheus-compatible metrics for performance tracking
- **Endpoint Monitoring**: Individual API endpoint health and usage statistics
- **Error Tracking**: Comprehensive error logging and monitoring
- **Performance Monitoring**: Response times, throughput, and resource utilization

## Health Check System

### Main Health Endpoint

The primary health check endpoint provides comprehensive system status:

**Endpoint**: `GET /health`

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "version": "1.0.0",
    "environment": "production",
    "database": {
      "healthy": true,
      "connectionCount": 5,
      "responseTime": 12
    },
    "monitoring": {
      "healthy": true,
      "metricsCollected": 1547,
      "lastMetricTime": "2024-01-15T10:29:58.000Z"
    }
  },
  "message": "Server is healthy"
}
```

### Database Health Monitoring

```typescript
export async function checkDatabaseHealth() {
  try {
    const startTime = Date.now();

    // Test database connection with simple query
    await prisma.$queryRaw`SELECT 1`;

    const responseTime = Date.now() - startTime;
    const connectionCount = await prisma.$metrics.get().then(m => m.pool.size);

    return {
      healthy: true,
      responseTime,
      connectionCount,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date().toISOString(),
    };
  }
}
```

### Endpoint-Specific Health Checks

Individual endpoint health monitoring via `/api/health/endpoints`:

```json
{
  "success": true,
  "data": {
    "summary": {
      "total": 19,
      "healthy": 17,
      "unhealthy": 1,
      "errors": 1,
      "avgResponseTime": 45.2,
      "successRate": 0.947
    },
    "endpoints": [
      {
        "endpoint": "/api/auth/login",
        "method": "POST",
        "status": "healthy",
        "authenticated": false,
        "description": "Přihlášení uživatele",
        "lastChecked": "2024-01-15T10:30:00.000Z",
        "responseTime": 45,
        "successRate": 0.98,
        "totalCalls": 1247,
        "errorCount": 25
      }
    ],
    "lastUpdated": "2024-01-15T10:30:00.000Z"
  }
}
```

## Prometheus Metrics

### Metrics Endpoint

The API exposes Prometheus-compatible metrics at `/metrics`:

```
# HELP api_endpoint_calls_total Total number of API endpoint calls
# TYPE api_endpoint_calls_total counter
api_endpoint_calls_total{endpoint="/api/auth/login",method="POST",status="200"} 1205
api_endpoint_calls_total{endpoint="/api/auth/login",method="POST",status="401"} 42

# HELP api_endpoint_duration_seconds API endpoint response time
# TYPE api_endpoint_duration_seconds histogram
api_endpoint_duration_seconds_bucket{endpoint="/api/auth/login",method="POST",le="0.1"} 950
api_endpoint_duration_seconds_bucket{endpoint="/api/auth/login",method="POST",le="0.5"} 1200
api_endpoint_duration_seconds_bucket{endpoint="/api/auth/login",method="POST",le="1.0"} 1245

# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 45.67

# HELP process_resident_memory_bytes Resident memory size in bytes
# TYPE process_resident_memory_bytes gauge
process_resident_memory_bytes 157286400

# HELP nodejs_heap_size_used_bytes Process heap size used in bytes
# TYPE nodejs_heap_size_used_bytes gauge
nodejs_heap_size_used_bytes 87654320
```

### Metrics Collection Setup

```typescript
import promClient from 'prom-client';

// Default Node.js metrics
promClient.collectDefaultMetrics();

// Custom API metrics
const apiCallsCounter = new promClient.Counter({
  name: 'api_endpoint_calls_total',
  help: 'Total number of API endpoint calls',
  labelNames: ['endpoint', 'method', 'status'],
});

const apiDurationHistogram = new promClient.Histogram({
  name: 'api_endpoint_duration_seconds',
  help: 'API endpoint response time in seconds',
  labelNames: ['endpoint', 'method'],
  buckets: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
});

const activeConnectionsGauge = new promClient.Gauge({
  name: 'api_active_connections',
  help: 'Number of active API connections',
});

export function getMetricsEndpoint() {
  return async (req: Request, res: Response) => {
    try {
      res.set('Content-Type', promClient.register.contentType);
      res.end(await promClient.register.metrics());
    } catch (error) {
      res.status(500).end(error);
    }
  };
}
```

### Middleware for Metrics Collection

```typescript
export function createMonitoringMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = process.hrtime.bigint();
    const endpoint = req.route?.path || req.path;
    const method = req.method;

    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1e9; // Convert to seconds

      // Record metrics
      apiCallsCounter.labels(endpoint, method, res.statusCode.toString()).inc();

      apiDurationHistogram.labels(endpoint, method).observe(duration);
    });

    next();
  };
}
```

## Grafana Dashboard Configuration

### Dashboard Setup

Create comprehensive dashboards for API monitoring:

#### 1. API Overview Dashboard

```json
{
  "dashboard": {
    "title": "Cell Segmentation Hub - API Overview",
    "panels": [
      {
        "title": "API Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(api_endpoint_calls_total[5m])",
            "legendFormat": "{{endpoint}} {{method}}"
          }
        ]
      },
      {
        "title": "Response Time Percentiles",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.50, rate(api_endpoint_duration_seconds_bucket[5m]))",
            "legendFormat": "p50"
          },
          {
            "expr": "histogram_quantile(0.95, rate(api_endpoint_duration_seconds_bucket[5m]))",
            "legendFormat": "p95"
          },
          {
            "expr": "histogram_quantile(0.99, rate(api_endpoint_duration_seconds_bucket[5m]))",
            "legendFormat": "p99"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(api_endpoint_calls_total{status=~\"4..|5..\"}[5m]) / rate(api_endpoint_calls_total[5m])",
            "legendFormat": "Error Rate"
          }
        ]
      }
    ]
  }
}
```

#### 2. Health Dashboard

```json
{
  "dashboard": {
    "title": "Cell Segmentation Hub - Health Monitoring",
    "panels": [
      {
        "title": "Service Health Status",
        "type": "stat",
        "targets": [
          {
            "expr": "up{job=\"cell-segmentation-api\"}",
            "legendFormat": "API Service"
          }
        ]
      },
      {
        "title": "Database Health",
        "type": "stat",
        "targets": [
          {
            "expr": "database_health_status",
            "legendFormat": "Database"
          }
        ]
      },
      {
        "title": "Active Connections",
        "type": "graph",
        "targets": [
          {
            "expr": "api_active_connections",
            "legendFormat": "Active Connections"
          }
        ]
      }
    ]
  }
}
```

### Alert Rules

Configure Prometheus alerting rules:

```yaml
# alerts.yml
groups:
  - name: cell-segmentation-api
    rules:
      - alert: HighErrorRate
        expr: rate(api_endpoint_calls_total{status=~"5.."}[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: 'High error rate detected'
          description: 'Error rate is {{ $value }} for endpoint {{ $labels.endpoint }}'

      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(api_endpoint_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'High response time detected'
          description: '95th percentile response time is {{ $value }}s'

      - alert: DatabaseDown
        expr: database_health_status == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'Database is down'
          description: 'Database health check failed'

      - alert: APIServiceDown
        expr: up{job="cell-segmentation-api"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'API service is down'
          description: 'API service is not responding'
```

## Docker Compose Monitoring Stack

### Complete Monitoring Setup

```yaml
# docker-compose.monitoring.yml
version: '3.8'

services:
  # Main application
  api:
    build: .
    ports:
      - '3001:3001'
    environment:
      - NODE_ENV=production
    networks:
      - monitoring

  # Prometheus
  prometheus:
    image: prom/prometheus:latest
    ports:
      - '9090:9090'
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./monitoring/alerts.yml:/etc/prometheus/alerts.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
      - '--web.enable-lifecycle'
      - '--web.enable-admin-api'
    networks:
      - monitoring

  # Grafana
  grafana:
    image: grafana/grafana:latest
    ports:
      - '3000:3000'
    volumes:
      - grafana-data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    networks:
      - monitoring

  # AlertManager
  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - '9093:9093'
    volumes:
      - ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml
      - alertmanager-data:/alertmanager
    networks:
      - monitoring

  # Node Exporter (for system metrics)
  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - '9100:9100'
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.ignored-mount-points=^/(sys|proc|dev|host|etc)($$|/)'
    networks:
      - monitoring

volumes:
  prometheus-data:
  grafana-data:
  alertmanager-data:

networks:
  monitoring:
    driver: bridge
```

### Prometheus Configuration

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - 'alerts.yml'

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager:9093

scrape_configs:
  - job_name: 'cell-segmentation-api'
    static_configs:
      - targets: ['api:3001']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'prometheus'
    static_configs:
      - targets: ['prometheus:9090']
```

## Log Management

### Structured Logging

```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'cell-segmentation-api' },
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Request logging middleware
export function createRequestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;

      logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        userId: req.user?.id,
      });
    });

    next();
  };
}
```

### ELK Stack Integration

```yaml
# docker-compose.logging.yml
version: '3.8'

services:
  elasticsearch:
    image: elasticsearch:7.14.0
    environment:
      - discovery.type=single-node
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports:
      - '9200:9200'
    volumes:
      - elasticsearch-data:/usr/share/elasticsearch/data

  kibana:
    image: kibana:7.14.0
    ports:
      - '5601:5601'
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      - elasticsearch

  logstash:
    image: logstash:7.14.0
    volumes:
      - ./monitoring/logstash.conf:/usr/share/logstash/pipeline/logstash.conf
      - ./logs:/logs:ro
    depends_on:
      - elasticsearch

volumes:
  elasticsearch-data:
```

## Performance Monitoring

### Application Performance Monitoring (APM)

```typescript
// APM integration example with Elastic APM
import apm from 'elastic-apm-node';

// Initialize APM
apm.start({
  serviceName: 'cell-segmentation-hub',
  secretToken: process.env.ELASTIC_APM_SECRET_TOKEN,
  serverUrl: process.env.ELASTIC_APM_SERVER_URL,
  environment: process.env.NODE_ENV,
  captureBody: 'all',
  captureHeaders: true,
});

// Custom transaction tracking
export function trackTransaction(name: string, type: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const transaction = apm.startTransaction(name, type);

    res.on('finish', () => {
      transaction?.setOutcome(res.statusCode < 400 ? 'success' : 'failure');
      transaction?.end();
    });

    next();
  };
}
```

### Memory Monitoring

```typescript
// Memory usage monitoring
export function monitorMemory() {
  const memoryUsageGauge = new promClient.Gauge({
    name: 'nodejs_memory_usage_bytes',
    help: 'Node.js memory usage by type',
    labelNames: ['type'],
  });

  setInterval(() => {
    const memUsage = process.memoryUsage();

    memoryUsageGauge.labels('rss').set(memUsage.rss);
    memoryUsageGauge.labels('heapTotal').set(memUsage.heapTotal);
    memoryUsageGauge.labels('heapUsed').set(memUsage.heapUsed);
    memoryUsageGauge.labels('external').set(memUsage.external);

    // Log memory warnings
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    if (heapUsedMB > 500) {
      logger.warn('High memory usage detected', {
        heapUsedMB,
        heapTotalMB: memUsage.heapTotal / 1024 / 1024,
      });
    }
  }, 10000); // Every 10 seconds
}
```

## Alerting and Notifications

### Slack Integration

```typescript
// Slack webhook for alerts
export async function sendSlackAlert(
  message: string,
  severity: 'info' | 'warning' | 'critical'
) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const colors = {
    info: '#36a64f',
    warning: '#ff9800',
    critical: '#ff5722',
  };

  const payload = {
    attachments: [
      {
        color: colors[severity],
        title: `Cell Segmentation Hub Alert - ${severity.toUpperCase()}`,
        text: message,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logger.error('Failed to send Slack alert', error);
  }
}

// Health check with alerting
export async function performHealthCheckWithAlerting() {
  const health = await checkDatabaseHealth();

  if (!health.healthy) {
    await sendSlackAlert(
      `Database health check failed: ${health.error}`,
      'critical'
    );
  }

  return health;
}
```

### Email Notifications

```typescript
import nodemailer from 'nodemailer';

export async function sendEmailAlert(subject: string, message: string) {
  const transporter = nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.ALERT_FROM_EMAIL,
    to: process.env.ALERT_TO_EMAIL,
    subject: `[Cell Segmentation Hub] ${subject}`,
    text: message,
    html: `<p>${message}</p>`,
  });
}
```

## Production Monitoring Checklist

### Essential Monitors

- [ ] **API Health**: Main `/health` endpoint monitoring
- [ ] **Database Health**: Connection and query performance
- [ ] **Response Times**: p50, p95, p99 percentiles
- [ ] **Error Rates**: 4xx and 5xx responses
- [ ] **Throughput**: Requests per second
- [ ] **Memory Usage**: Heap and RSS memory
- [ ] **CPU Usage**: Process and system CPU
- [ ] **Disk Space**: Available storage
- [ ] **Network**: Connection counts and bandwidth

### Alert Thresholds

| Metric              | Warning | Critical | Action                             |
| ------------------- | ------- | -------- | ---------------------------------- |
| Error Rate          | > 5%    | > 10%    | Check logs, investigate errors     |
| Response Time (p95) | > 1s    | > 3s     | Optimize slow endpoints            |
| Memory Usage        | > 80%   | > 95%    | Restart service, investigate leaks |
| CPU Usage           | > 80%   | > 95%    | Scale horizontally                 |
| Database Response   | > 100ms | > 500ms  | Check queries, connections         |
| Disk Space          | < 20%   | < 10%    | Clean logs, add storage            |

### Monitoring Automation

```bash
#!/bin/bash
# health-check.sh - Automated health monitoring script

API_URL="http://localhost:3001"
ALERT_EMAIL="alerts@yourdomain.com"

# Check API health
response=$(curl -s -o /dev/null -w "%{http_code}" $API_URL/health)

if [ $response -ne 200 ]; then
    echo "API health check failed with status: $response" | \
    mail -s "API Health Alert" $ALERT_EMAIL
fi

# Check endpoint health
endpoint_health=$(curl -s $API_URL/api/health/endpoints | jq '.data.summary.healthy')
total_endpoints=$(curl -s $API_URL/api/health/endpoints | jq '.data.summary.total')

if [ $endpoint_health -lt $total_endpoints ]; then
    echo "Some endpoints are unhealthy: $endpoint_health/$total_endpoints" | \
    mail -s "Endpoint Health Alert" $ALERT_EMAIL
fi
```

This comprehensive monitoring system provides complete visibility into the Cell Segmentation Hub API's health, performance, and reliability, enabling proactive issue detection and resolution.
