# Cell Segmentation Hub - Production Deployment System

## Overview

This repository includes a comprehensive, production-ready deployment system that prevents all common deployment errors through automated blue-green deployments with zero downtime.

## Features

✅ **Automated Blue-Green Deployment**

- Zero-downtime deployments
- Automatic environment detection
- Instant rollback capabilities
- Traffic switching validation

✅ **Comprehensive Pre-Deployment Validation**

- Docker and container health checks
- SSL certificate validation
- Database connectivity tests
- File permission verification
- Resource usage monitoring

✅ **Automatic Permission Management**

- Fixes all upload directory permissions (UID 1001)
- Resolves duplicate path structures
- Handles ML weights and SSL certificates
- Cleans temporary files

✅ **Post-Deployment Verification**

- Complete system functionality tests
- API endpoint validation
- WebSocket connectivity checks
- ML model inference testing
- Resource usage monitoring

✅ **Robust Error Handling**

- Automatic rollback on failure
- Database backup before deployment
- Comprehensive logging
- Emergency cleanup procedures

## Quick Start

### 1. Initial Setup

```bash
# Ensure all deployment scripts are executable
chmod +x scripts/*.sh

# Create required directories
mkdir -p logs/deployment backups

# Fix file permissions (recommended before first deployment)
./scripts/fix-permissions.sh
```

### 2. Deploy to Production

```bash
# Run full deployment with all safety checks
./scripts/deploy-production.sh

# Or skip backup for faster deployment (NOT RECOMMENDED)
./scripts/deploy-production.sh --skip-backup

# Force deployment even if validation fails (DANGEROUS)
./scripts/deploy-production.sh --force
```

### 3. Emergency Rollback

```bash
# Quick rollback to previous environment
./scripts/deploy-production.sh --quick-rollback
```

## Deployment Scripts

### `/scripts/deploy-production.sh`

Main deployment orchestrator with blue-green logic.

**Options:**

- `--force` - Bypass pre-deployment validation
- `--skip-backup` - Skip database backup (not recommended)
- `--quick-rollback` - Rollback to previous environment

**Example Usage:**

```bash
./scripts/deploy-production.sh                    # Normal deployment
./scripts/deploy-production.sh --quick-rollback   # Emergency rollback
```

### `/scripts/pre-deployment-check.sh`

Comprehensive validation before deployment.

**Checks:**

- Docker daemon status
- Docker Compose file syntax
- Environment variable completeness
- SSL certificate validity
- Upload directory structure
- ML model weights presence
- Database connectivity
- Nginx configuration syntax
- Disk space and memory usage
- Port conflict detection

**Example Usage:**

```bash
./scripts/pre-deployment-check.sh    # Run all validation checks
```

### `/scripts/fix-permissions.sh`

Automatic file permission fixer.

**Options:**

- `--dry-run` - Show what would be fixed without making changes

**Fixes:**

- Upload directory permissions (UID 1001 for Docker)
- Duplicate blue/green directory structures
- ML model weight file permissions
- SSL certificate permissions
- Nginx configuration file permissions
- Database data directory permissions

**Example Usage:**

```bash
./scripts/fix-permissions.sh --dry-run    # Preview changes
./scripts/fix-permissions.sh              # Apply fixes
```

### `/scripts/post-deployment-verify.sh`

Comprehensive post-deployment testing.

**Tests:**

- Container health status
- API endpoint functionality
- Database connectivity
- Redis operations
- File upload capabilities
- WebSocket connections
- ML model inference
- Nginx routing
- Resource usage monitoring

**Example Usage:**

```bash
./scripts/post-deployment-verify.sh blue     # Test blue environment
./scripts/post-deployment-verify.sh green    # Test green environment
```

## Configuration

### Central Configuration File

All deployment parameters are centralized in `/config/deployment.config`:

```bash
# Environment Ports
BLUE_FRONTEND_PORT=4000
BLUE_BACKEND_PORT=4001
BLUE_ML_PORT=4008

GREEN_FRONTEND_PORT=5000
GREEN_BACKEND_PORT=5001
GREEN_ML_PORT=5008

# Docker Settings
DOCKER_UID=1001
DOCKER_GID=1001

# Health Check Settings
HEALTH_CHECK_TIMEOUT=30
HEALTH_CHECK_RETRIES=10

# Production Settings
PRODUCTION_DOMAIN="spherosegapp.utia.cas.cz"
ENABLE_SSL=true
AUTO_MIGRATE=true
```

## Blue-Green Deployment Process

### How It Works

1. **Environment Detection**: Automatically detects which environment (blue/green) is currently active
2. **Pre-Deployment Validation**: Comprehensive system checks
3. **Permission Fixes**: Automatic resolution of file permission issues
4. **Backup Creation**: Database and file backups before changes
5. **Target Environment Deployment**: Deploy new version to inactive environment
6. **Health Checks**: Wait for all services to be healthy
7. **Database Migration**: Run Prisma migrations safely
8. **System Testing**: Comprehensive functionality tests
9. **Traffic Switch**: Update nginx configuration to route to new environment
10. **Old Environment Cleanup**: Stop previous environment after verification

### Environment Structure

```
Blue Environment (Ports 4000-4008):
- blue-frontend:4000
- blue-backend:4001
- blue-ml:4008
- postgres-blue (spheroseg_blue database)
- redis-blue

Green Environment (Ports 5000-5008):
- green-frontend:5000
- green-backend:5001
- green-ml:5008
- postgres-green (spheroseg_green database)
- redis-green
```

### Nginx Traffic Routing

The system uses a unified nginx configuration (`nginx.prod.conf`) with dynamic upstream switching:

```nginx
upstream backend {
    server blue-backend:3001;    # or green-backend:3001
}

upstream ml_service {
    server blue-ml:8000;         # or green-ml:8000
}

upstream frontend {
    server blue-frontend:80;     # or green-frontend:80
}
```

## Common Issues and Solutions

### Issue: Upload 500 Errors

**Cause**: Incorrect file permissions or missing directories
**Solution**: Run `./scripts/fix-permissions.sh`

### Issue: ML Endpoint 405 Errors

**Cause**: Nginx routing configuration
**Solution**: Check nginx upstream configuration in `nginx.prod.conf`

### Issue: Database Migration Failures

**Cause**: Database connectivity or schema conflicts
**Solution**: Check database container health and backup restoration

### Issue: Duplicate Blue Directory Structure

**Cause**: Previous deployment issues
**Solution**: Automatically fixed by `fix-permissions.sh`

### Issue: Container Health Check Failures

**Cause**: Service startup issues or resource constraints
**Solution**: Check container logs and resource usage

## Monitoring and Logging

### Log Files

All deployment operations are logged to `/logs/deployment/`:

```bash
/logs/deployment/
├── deployment-YYYYMMDD-HHMMSS.log        # Main deployment log
├── pre-deployment-YYYYMMDD-HHMMSS.log     # Validation log
├── fix-permissions-YYYYMMDD-HHMMSS.log    # Permission fix log
└── post-deployment-verify-YYYYMMDD-HHMMSS.log # Verification log
```

### Health Check URLs

- Frontend: `http://localhost:PORT/health`
- Backend: `http://localhost:PORT/health`
- ML Service: `http://localhost:PORT/health`

### Production Monitoring

- Grafana: `http://localhost:3030`
- Prometheus: `http://localhost:9090`

## Safety Features

### Automatic Rollback Triggers

- Pre-deployment validation failure
- Health check timeouts
- Database migration errors
- Post-deployment test failures
- Manual emergency rollback

### Backup Strategy

- Automatic database backups before deployment
- Upload file backups
- Nginx configuration backups
- Retention: 30 days, maximum 10 backups

### Permission Management

- Automatic UID 1001 assignment for Docker compatibility
- Upload directory structure validation
- SSL certificate permission handling
- Cleanup of temporary files

## Environment Variables

### Required Environment Files

**`.env.blue`:**

```bash
DB_PASSWORD=your_secure_password
BLUE_JWT_ACCESS_SECRET=your_jwt_secret
BLUE_JWT_REFRESH_SECRET=your_refresh_secret
```

**`.env.green.prod`:**

```bash
JWT_ACCESS_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
```

## Troubleshooting

### Debug Mode

Enable verbose logging by setting in `deployment.config`:

```bash
VERBOSE_LOGGING=true
```

### Manual Environment Check

```bash
# Check active environment
docker ps | grep -E "(blue|green)"

# Check nginx configuration
grep -E "server (blue|green)" docker/nginx/nginx.prod.conf

# Test health endpoints
curl http://localhost:4000/health  # Blue frontend
curl http://localhost:5000/health  # Green frontend
```

### Emergency Procedures

**If deployment fails mid-process:**

1. Check deployment log in `/logs/deployment/`
2. Run quick rollback: `./scripts/deploy-production.sh --quick-rollback`
3. Verify system health: `./scripts/post-deployment-verify.sh [environment]`

**If rollback fails:**

1. Manually switch nginx configuration
2. Restart containers: `docker-compose -f docker-compose.[env].yml restart`
3. Check database connectivity

## Production Checklist

Before deploying to production:

- [ ] Run permission fix: `./scripts/fix-permissions.sh`
- [ ] Run pre-deployment validation: `./scripts/pre-deployment-check.sh`
- [ ] Verify SSL certificates are valid
- [ ] Check available disk space (minimum 10GB)
- [ ] Ensure ML model weights are present
- [ ] Verify environment files contain all required variables
- [ ] Test in staging environment first

## Security Considerations

- All secrets are stored in environment files (not in scripts)
- SSL certificates are automatically validated
- File permissions follow principle of least privilege
- Database backups are created before any changes
- All operations are logged for audit trail
- Emergency rollback preserves data integrity

## Support

For deployment issues:

1. Check deployment logs in `/logs/deployment/`
2. Run diagnostic scripts with verbose output
3. Verify all requirements in the production checklist
4. Test individual components using post-deployment verification

The deployment system is designed to be fail-safe with multiple rollback mechanisms and comprehensive validation at every step.
