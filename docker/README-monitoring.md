# SpheroSeg Monitoring and Log Rotation Configuration

This directory contains comprehensive monitoring and log rotation configurations for the Cell Segmentation Hub application.

## Overview

The monitoring setup includes:
- **Grafana Alerting**: 7 alert rules for critical system and application metrics
- **Log Rotation**: Automated log management with 30-day retention
- **Enhanced Monitoring**: Node Exporter, cAdvisor, and Alertmanager integration
- **Docker Integration**: Container-based log rotation and monitoring services

## Directory Structure

```
docker/
├── grafana/
│   ├── alerting/
│   │   ├── rules.yml                    # Grafana alert rules
│   │   └── notification-policies.yml    # Alert notification configuration
│   └── dashboards/                      # Existing dashboard configurations
├── prometheus/
│   ├── prometheus.yml                   # Updated Prometheus configuration
│   └── alerts.yml                       # Prometheus alerting rules
├── alertmanager/
│   └── alertmanager.yml                 # Alertmanager configuration
├── logrotate/
│   ├── Dockerfile.logrotate             # Docker image for log rotation
│   ├── logrotate.conf                   # Main logrotate configuration
│   ├── spheroseg-*.conf                 # Service-specific log rotation
│   ├── setup-log-rotation.sh            # Setup script
│   └── docker-entrypoint.sh             # Container entrypoint
└── nginx/                               # Enhanced nginx configuration
```

## Alert Rules Implemented

### 1. High CPU Usage Alert
- **Threshold**: >80% for 2 minutes
- **Severity**: Warning
- **Description**: Monitors CPU usage across all instances

### 2. High Memory Usage Alert
- **Threshold**: >90% for 2 minutes
- **Severity**: Critical
- **Description**: Monitors memory consumption

### 3. High API Response Time Alert
- **Threshold**: >2 seconds (95th percentile) for 1 minute
- **Severity**: Warning
- **Description**: Monitors backend API performance

### 4. High Error Rate Alert
- **Threshold**: >5% error rate for 1 minute
- **Severity**: Critical
- **Description**: Monitors 5xx HTTP errors from backend

### 5. Service Down Alert
- **Threshold**: Service unavailable for 30 seconds
- **Severity**: Critical
- **Description**: Monitors backend and ML service availability

### 6. Low Disk Space Alert
- **Threshold**: >90% disk usage for 1 minute
- **Severity**: Warning
- **Description**: Monitors filesystem usage

### 7. Database Connection Failures Alert
- **Threshold**: >5 connection errors in 5 minutes
- **Severity**: Critical
- **Description**: Monitors database connectivity issues

## Log Rotation Configuration

### Features
- **Daily Rotation**: Logs are rotated every day
- **30-Day Retention**: Keeps 30 days of historical logs
- **Compression**: Older logs are compressed to save space
- **Service-Specific**: Different configurations for each service
- **Docker Integration**: Runs as a containerized service

### Services Covered
- **Nginx**: Access and error logs
- **Backend**: Application logs and API logs
- **ML Service**: Inference logs and model logs
- **Prometheus**: Monitoring service logs
- **Grafana**: Dashboard and alerting logs

### Log Locations
- Nginx: `/var/log/nginx/`
- Backend: `/var/log/spheroseg/backend/`
- ML Service: `/var/log/spheroseg/ml/`
- Prometheus: `/var/log/spheroseg/prometheus/`
- Grafana: `/var/log/spheroseg/grafana/`

## Usage Instructions

### Basic Setup
```bash
# Start with enhanced monitoring and log rotation
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d

# Or use the enhanced version with all features
docker compose -f docker-compose.yml -f docker-compose.enhanced.yml up -d
```

### Monitoring Services
- **Grafana**: http://localhost:3030 (dashboards and alerts)
- **Prometheus**: http://localhost:9090 (metrics and rules)
- **Alertmanager**: http://localhost:9093 (alert management)
- **Node Exporter**: http://localhost:9100 (system metrics)
- **cAdvisor**: http://localhost:8080 (container metrics)

### Email Alerts
Email notifications are configured to use MailHog (development) or SMTP (production):
- **Development**: MailHog UI at http://localhost:8025
- **Production**: Configure SMTP settings in alertmanager.yml

### Manual Log Rotation
```bash
# Test log rotation configuration
docker exec spheroseg-logrotate logrotate -d /etc/logrotate.conf

# Force log rotation
docker exec spheroseg-logrotate logrotate -f /etc/logrotate.conf

# Check log sizes
docker exec spheroseg-logrotate du -sh /var/log/spheroseg/*
```

### Health Checks

```bash
# Check logrotate service health
docker exec spheroseg-logrotate /usr/local/bin/health-check.sh

# Monitor service logs
docker logs spheroseg-logrotate -f
```

## Configuration Files Created

### Grafana Alerting Rules
- `/docker/grafana/alerting/rules.yml` - All 7 alert rules
- `/docker/grafana/alerting/notification-policies.yml` - Email notification setup

### Log Rotation
- `/docker/logrotate/logrotate.conf` - Main configuration
- `/docker/logrotate/spheroseg-nginx.conf` - Nginx log rotation
- `/docker/logrotate/spheroseg-backend.conf` - Backend log rotation
- `/docker/logrotate/spheroseg-ml.conf` - ML service log rotation
- `/docker/logrotate/spheroseg-prometheus.conf` - Monitoring logs
- `/docker/logrotate/Dockerfile.logrotate` - Docker image for logrotate
- `/docker/logrotate/setup-log-rotation.sh` - Setup script
- `/docker/logrotate/docker-entrypoint.sh` - Container entrypoint

### Enhanced Configurations
- `/docker/prometheus/alerts.yml` - Prometheus alert rules
- `/docker/alertmanager/alertmanager.yml` - Alert routing and notifications
- `/backend/docker/nginx/nginx.conf` - Enhanced nginx with logging
- `/docker-compose.monitoring.yml` - Monitoring services
- `/docker-compose.enhanced.yml` - Enhanced logging configuration

## Troubleshooting

### Log Rotation Issues
```bash
# Check logrotate status
docker exec spheroseg-logrotate logrotate -d /etc/logrotate.conf

# View logrotate logs
docker logs spheroseg-logrotate

# Manually run rotation
docker exec spheroseg-logrotate logrotate -f /etc/logrotate.conf
```

### Alert Issues
```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Check alert rules
curl http://localhost:9090/api/v1/rules

# Check Alertmanager status
curl http://localhost:9093/api/v1/status

# Test email configuration
docker logs spheroseg-alertmanager
```

### Performance Monitoring
```bash
# View container resource usage
docker stats

# Check disk usage
df -h

# Monitor log sizes
du -sh /var/lib/docker/volumes/*logs*
```

## Security Considerations

- Email alerts contain system information - secure SMTP configuration recommended
- Log files may contain sensitive data - review log retention policies
- Monitor disk space to prevent log overflow
- Regularly update alerting thresholds based on application behavior
- Consider log aggregation solutions for production environments

## Next Steps

1. **Configure SMTP**: Update alertmanager.yml with production email settings
2. **Customize Thresholds**: Adjust alert thresholds based on your environment
3. **Add Custom Metrics**: Enhance backend and ML services with application-specific metrics
4. **Dashboard Integration**: Create custom Grafana dashboards for your specific use cases
5. **Log Aggregation**: Consider ELK stack or similar for centralized logging in production