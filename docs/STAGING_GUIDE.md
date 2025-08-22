# Staging Environment Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the SpheroSeg application to a staging environment based on the working development configuration.

## Prerequisites

- Docker and Docker Compose installed
- Git access to the repository
- SSL certificates (for HTTPS)
- Domain configured (spherosegapp.utia.cas.cz)
- PostgreSQL 15+ for production database
- SMTP credentials for email service

## Environment Configuration

### 1. Environment Variables

Create `.env.staging` with the following required secrets:

```bash
# Generate secure secrets
openssl rand -hex 32  # For JWT_ACCESS_SECRET
openssl rand -hex 32  # For JWT_REFRESH_SECRET
openssl rand -hex 32  # For SESSION_SECRET

# Export required variables
export STAGING_JWT_ACCESS_SECRET="<generated-secret>"
export STAGING_JWT_REFRESH_SECRET="<generated-secret>"
export DB_PASSWORD="<secure-database-password>"
export SMTP_PASSWORD="<smtp-password>"
export SESSION_SECRET="<generated-secret>"
export GRAFANA_ADMIN_PASSWORD="<grafana-password>"
```

### 2. File Structure

```
cell-segmentation-hub/
├── .env.staging                 # Staging environment variables
├── docker-compose.staging.yml   # Staging Docker configuration
├── scripts/
│   └── deploy-staging.sh       # Deployment script
├── docker/
│   └── nginx/
│       ├── nginx.staging.conf  # Nginx configuration
│       └── ssl/                 # SSL certificates
└── monitoring/
    └── staging-prometheus.yml  # Prometheus configuration
```

## Deployment Steps

### 1. Initial Setup

```bash
# Clone repository
git clone https://github.com/michalprusek/cell-segmentation-hub.git
cd cell-segmentation-hub

# Create required directories
mkdir -p backend/uploads/staging/{images,thumbnails,temp}
mkdir -p backend/data/staging
mkdir -p docker/nginx/ssl

# Set proper permissions
sudo chown -R 1001:1001 backend/uploads/staging
```

### 2. Configure SSL Certificates

Place SSL certificates in `docker/nginx/ssl/`:

- `spherosegapp.crt` - SSL certificate
- `spherosegapp.key` - Private key

### 3. Deploy to Staging

```bash
# Make deployment script executable
chmod +x scripts/deploy-staging.sh

# Run deployment
./scripts/deploy-staging.sh
```

### 4. Manual Deployment (Alternative)

```bash
# Load environment variables
export $(cat .env.staging | grep -v '^#' | xargs)

# Build images
docker-compose -f docker-compose.staging.yml build

# Start services
docker-compose -f docker-compose.staging.yml up -d

# Run migrations
docker exec spheroseg-backend-staging npx prisma migrate deploy

# Check health
docker-compose -f docker-compose.staging.yml ps
```

## Service URLs

- **Frontend**: https://spherosegapp.utia.cas.cz (port 4000 internally)
- **Backend API**: https://spherosegapp.utia.cas.cz/api (port 4001 internally)
- **ML Service**: https://spherosegapp.utia.cas.cz/ml (port 4008 internally)
- **Grafana**: http://localhost:3031
- **Prometheus**: http://localhost:9091

## Database Management

### Backup Database

```bash
docker exec spheroseg-postgres-staging pg_dump -U spheroseg spheroseg_staging | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Restore Database

```bash
gunzip < backup_20240822.sql.gz | docker exec -i spheroseg-postgres-staging psql -U spheroseg spheroseg_staging
```

### Run Migrations

```bash
docker exec spheroseg-backend-staging npx prisma migrate deploy
```

## Monitoring

### View Logs

```bash
# All services
docker-compose -f docker-compose.staging.yml logs -f

# Specific service
docker-compose -f docker-compose.staging.yml logs -f staging-backend
```

### Health Checks

```bash
# Check all services
curl http://localhost:4000/health  # Frontend
curl http://localhost:4001/health  # Backend
curl http://localhost:4008/health  # ML Service

# Database connection
docker exec spheroseg-postgres-staging pg_isready
```

### Metrics

- Access Grafana at http://localhost:3031
- Default credentials: admin / ${GRAFANA_ADMIN_PASSWORD}
- Prometheus metrics at http://localhost:9091

## Troubleshooting

### Service Not Starting

```bash
# Check logs
docker-compose -f docker-compose.staging.yml logs staging-backend

# Restart service
docker-compose -f docker-compose.staging.yml restart staging-backend
```

### Database Connection Issues

```bash
# Test connection
docker exec spheroseg-backend-staging npx prisma db pull

# Reset database
docker exec spheroseg-backend-staging npx prisma migrate reset --force
```

### Memory Issues

```bash
# Check resource usage
docker stats

# Increase memory limits in docker-compose.staging.yml
```

## Rollback Procedure

```bash
# Stop current deployment
docker-compose -f docker-compose.staging.yml down

# Restore database from backup
gunzip < backup_previous.sql.gz | docker exec -i spheroseg-postgres-staging psql -U spheroseg spheroseg_staging

# Deploy previous version
git checkout <previous-tag>
docker-compose -f docker-compose.staging.yml build
docker-compose -f docker-compose.staging.yml up -d
```

## Security Checklist

- [ ] Strong JWT secrets generated (32+ bytes)
- [ ] Database password is secure
- [ ] SSL certificates installed and valid
- [ ] CORS configured correctly
- [ ] Rate limiting enabled
- [ ] Environment variables not committed to git
- [ ] File upload restrictions in place
- [ ] Secure cookies enabled for production

## Maintenance

### Update Dependencies

```bash
# Frontend
docker exec spheroseg-frontend-staging npm update

# Backend
docker exec spheroseg-backend-staging npm update
docker exec spheroseg-backend-staging npx prisma generate

# ML Service
docker exec spheroseg-ml-staging pip install --upgrade -r requirements.txt
```

### Clean Up

```bash
# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Clean logs
docker-compose -f docker-compose.staging.yml logs --tail=0
```

## Performance Optimization

### Enable Caching

- Redis is configured for session and queue management
- Frontend assets are cached by Nginx
- Database queries use Prisma's query caching

### Scale Services

```bash
# Scale ML workers
docker-compose -f docker-compose.staging.yml up -d --scale staging-ml=2
```

## Contact

For issues or questions about staging deployment:

- GitHub Issues: https://github.com/michalprusek/cell-segmentation-hub/issues
- Email: spheroseg@utia.cas.cz
