# Deployment Guide

This guide covers deploying the Cell Segmentation Hub to production environments using Docker containers and cloud platforms.

## Quick Deploy with Docker

The fastest way to deploy is using the provided Docker Compose configuration:

```bash
# 1. Clone and configure
git clone https://github.com/your-org/spheroseg-app.git
cd spheroseg-app

# 2. Set production environment variables
cp .env.example .env.production
# Edit .env.production with your production values

# 3. Build and start services
docker-compose -f docker-compose.prod.yml up -d

# 4. Check health
curl http://localhost:3001/health
```

Services will be available at:

- **Frontend**: http://localhost:3000 (development: 8082)
- **Backend API**: http://localhost:3001
- **ML Service**: http://localhost:8000

## Production Architecture

### Container Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer                        │
│              (nginx/Traefik/AWS ALB)                    │
└─────────────────┬───────────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌─────────┐ ┌─────────┐ ┌─────────────┐
│Frontend │ │Backend  │ │ ML Service  │
│Container│ │Container│ │  Container  │
└─────────┘ └─────────┘ └─────────────┘
    │             │             │
    └─────────────┼─────────────┘
                  │
            ┌─────────┐
            │Database │
            │ & Files │
            └─────────┘
```

### Service Configuration

#### Frontend Container

- **Image**: Custom React build
- **Port**: 5173 (internal)
- **Environment**: Production optimized build
- **Resources**: 512MB RAM, 0.5 CPU

#### Backend Container

- **Image**: Node.js with Express
- **Port**: 3001 (internal)
- **Environment**: Production database, JWT secrets
- **Resources**: 1GB RAM, 1 CPU

#### ML Service Container

- **Image**: Python with PyTorch
- **Port**: 8000 (internal)
- **Environment**: GPU support (optional)
- **Resources**: 4GB RAM, 2 CPU (8GB+ for GPU)

## Environment Configuration

### Production Environment Variables

Create `.env.production` with production values:

```bash
# Application Environment
NODE_ENV=production
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_ML_SERVICE_URL=https://ml.yourdomain.com

# Backend Configuration
PORT=3001
HOST=0.0.0.0
DATABASE_URL=postgresql://user:password@db:5432/cellseg

# Security (Generate strong secrets!)
JWT_ACCESS_SECRET=your-256-bit-secret-key-for-access-tokens
JWT_REFRESH_SECRET=your-256-bit-secret-key-for-refresh-tokens

# CORS Origins (Update with your domains)
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# File Storage
STORAGE_TYPE=s3  # or 'local' for filesystem
AWS_BUCKET_NAME=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Services
SEGMENTATION_SERVICE_URL=http://ml-service:8000

# Monitoring
LOG_LEVEL=info
SENTRY_DSN=your-sentry-dsn

# Database (PostgreSQL recommended for production)
POSTGRES_USER=cellseg
POSTGRES_PASSWORD=secure-db-password
POSTGRES_DB=cellseg
```

### Security Configuration

```bash
# SSL/TLS Configuration
SSL_CERT_PATH=/path/to/certificate.pem
SSL_KEY_PATH=/path/to/private-key.pem

# Rate Limiting (Stricter for production)
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX=100           # 100 requests per window

# Authentication
JWT_EXPIRY_ACCESS=15m        # 15 minutes
JWT_EXPIRY_REFRESH=7d        # 7 days
BCRYPT_SALT_ROUNDS=12        # High security

# CORS Security
CORS_CREDENTIALS=true
CORS_MAX_AGE=86400          # 24 hours
```

## Docker Configuration

### Production Dockerfile - Frontend

```dockerfile
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built app
COPY --from=builder /app/dist /usr/share/nginx/html

# Custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Production Dockerfile - Backend

```dockerfile
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create uploads directory
RUN mkdir -p uploads && chown -R node:node uploads

# Switch to non-root user
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

EXPOSE 3001
CMD ["node", "dist/server.js"]
```

### Production Dockerfile - ML Service

```dockerfile
FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Create non-root user
RUN useradd --create-home --shell /bin/bash ml-user && \
    chown -R ml-user:ml-user /app

USER ml-user

# Create weights directory
RUN mkdir -p weights

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000
CMD ["python", "api/main.py"]
```

## Docker Compose - Production

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  # Frontend Service
  frontend:
    build:
      context: .
      dockerfile: docker/frontend.Dockerfile
    container_name: cellseg-frontend-prod
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - ./ssl:/etc/ssl/certs
    environment:
      - NODE_ENV=production
    depends_on:
      - backend
    networks:
      - cellseg-network
    restart: unless-stopped
    labels:
      - 'traefik.enable=true'
      - 'traefik.http.routers.frontend.rule=Host(`yourdomain.com`)'

  # Backend Service
  backend:
    build:
      context: ./backend
      dockerfile: ../docker/backend.Dockerfile
    container_name: cellseg-backend-prod
    ports:
      - '3001:3001'
    volumes:
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://cellseg:${POSTGRES_PASSWORD}@postgres:5432/cellseg
      - JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
      - STORAGE_TYPE=${STORAGE_TYPE}
      - AWS_BUCKET_NAME=${AWS_BUCKET_NAME}
      - SEGMENTATION_SERVICE_URL=http://ml-service:8000
    depends_on:
      - postgres
      - redis
      - ml-service
    networks:
      - cellseg-network
    restart: unless-stopped

  # ML Service
  ml-service:
    build:
      context: ./backend/segmentation
      dockerfile: ../../docker/ml.Dockerfile
    container_name: cellseg-ml-prod
    ports:
      - '8000:8000'
    volumes:
      - ./ml-models:/app/weights
    environment:
      - PYTHONUNBUFFERED=1
      - PYTHONDONTWRITEBYTECODE=1
    deploy:
      resources:
        limits:
          memory: 6G
        reservations:
          memory: 4G
    networks:
      - cellseg-network
    restart: unless-stopped

  # Database
  postgres:
    image: postgres:14-alpine
    container_name: cellseg-postgres-prod
    ports:
      - '5432:5432'
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./backups:/backups
    environment:
      - POSTGRES_USER=cellseg
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=cellseg
    networks:
      - cellseg-network
    restart: unless-stopped

  # Redis (Optional - for caching and sessions)
  redis:
    image: redis:7-alpine
    container_name: cellseg-redis-prod
    ports:
      - '6379:6379'
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    networks:
      - cellseg-network
    restart: unless-stopped

  # Backup Service
  backup:
    image: postgres:14-alpine
    container_name: cellseg-backup
    volumes:
      - ./backups:/backups
      - ./backup-scripts:/scripts
    environment:
      - POSTGRES_USER=cellseg
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=cellseg
      - POSTGRES_HOST=postgres
    command: /scripts/backup.sh
    depends_on:
      - postgres
    networks:
      - cellseg-network
    restart: 'no'

networks:
  cellseg-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  postgres-data:
    driver: local
  redis-data:
    driver: local
```

## Cloud Platform Deployment

### AWS Deployment

#### Using AWS ECS (Elastic Container Service)

1. **Create ECR Repositories**

```bash
# Create repositories for each service
aws ecr create-repository --repository-name cellseg/frontend
aws ecr create-repository --repository-name cellseg/backend
aws ecr create-repository --repository-name cellseg/ml-service
```

2. **Build and Push Images**

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com

# Build and push frontend
docker build -f docker/frontend.Dockerfile -t cellseg/frontend .
docker tag cellseg/frontend:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/cellseg/frontend:latest
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/cellseg/frontend:latest
```

3. **ECS Task Definition**

```json
{
  "family": "cellseg-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::123456789:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "backend",
      "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/cellseg/backend:latest",
      "portMappings": [
        {
          "containerPort": 3001,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "DATABASE_URL",
          "value": "postgresql://user:pass@rds-endpoint:5432/cellseg"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/cellseg",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "backend"
        }
      }
    }
  ]
}
```

#### Using AWS Lambda + API Gateway

For serverless deployment (backend only):

```bash
# Install Serverless Framework
npm install -g serverless

# Deploy with serverless.yml configuration
serverless deploy --stage production
```

### Google Cloud Platform

#### Using Google Cloud Run

```bash
# Build and push to Container Registry
gcloud builds submit --tag gcr.io/PROJECT-ID/cellseg-backend

# Deploy to Cloud Run
gcloud run deploy cellseg-backend \
  --image gcr.io/PROJECT-ID/cellseg-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production
```

#### Using GKE (Google Kubernetes Engine)

```yaml
# kubernetes/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cellseg-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: cellseg-backend
  template:
    metadata:
      labels:
        app: cellseg-backend
    spec:
      containers:
        - name: backend
          image: gcr.io/PROJECT-ID/cellseg-backend:latest
          ports:
            - containerPort: 3001
          env:
            - name: NODE_ENV
              value: 'production'
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: cellseg-secrets
                  key: database-url
```

### Azure Deployment

#### Using Azure Container Instances

```bash
# Create resource group
az group create --name cellseg-prod --location eastus

# Deploy container group
az container create \
  --resource-group cellseg-prod \
  --name cellseg-backend \
  --image your-registry.azurecr.io/cellseg/backend:latest \
  --cpu 2 \
  --memory 4 \
  --ports 3001 \
  --environment-variables NODE_ENV=production
```

## Monitoring and Logging

### Application Monitoring

#### Health Checks

```bash
# Backend health
curl https://api.yourdomain.com/health

# ML Service health
curl https://ml.yourdomain.com/health
```

#### Prometheus Metrics

```yaml
# docker-compose.monitoring.yml
services:
  prometheus:
    image: prom/prometheus
    ports:
      - '9090:9090'
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - '3000:3000'
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

### Log Management

#### Centralized Logging with ELK Stack

```yaml
services:
  elasticsearch:
    image: elasticsearch:7.14.0
    environment:
      - discovery.type=single-node
    ports:
      - '9200:9200'

  kibana:
    image: kibana:7.14.0
    ports:
      - '5601:5601'
    depends_on:
      - elasticsearch

  logstash:
    image: logstash:7.14.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch
```

## SSL/TLS Configuration

### Let's Encrypt with Certbot

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com -d api.yourdomain.com

# Auto-renewal cron job
echo "0 12 * * * /usr/bin/certbot renew --quiet" | sudo crontab -
```

### Nginx SSL Configuration

```nginx
# nginx.conf
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Database Migration

### Production Database Setup

```bash
# Run migrations
cd backend
npm run db:migrate

# Verify schema
npm run db:studio
```

### Backup Strategy

```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/backups/cellseg_$DATE.sql"

# Create backup
docker exec cellseg-postgres-prod pg_dump -U cellseg cellseg > $BACKUP_FILE

# Compress backup
gzip $BACKUP_FILE

# Upload to S3 (optional)
aws s3 cp $BACKUP_FILE.gz s3://your-backup-bucket/database/

# Clean old backups (keep last 30 days)
find /backups -name "cellseg_*.sql.gz" -mtime +30 -delete
```

## Scaling Considerations

### Horizontal Scaling

```yaml
# Docker Compose - Multiple Backend Instances
services:
  backend-1:
    <<: *backend-service
    container_name: cellseg-backend-1

  backend-2:
    <<: *backend-service
    container_name: cellseg-backend-2

  backend-3:
    <<: *backend-service
    container_name: cellseg-backend-3

  load-balancer:
    image: nginx:alpine
    ports:
      - "80:80"
    depends_on:
      - backend-1
      - backend-2
      - backend-3
```

### Auto-scaling with Kubernetes

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: cellseg-backend-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: cellseg-backend
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Troubleshooting

### Common Issues

#### Container Health Check Failures

```bash
# Check container logs
docker logs cellseg-backend-prod

# Check health endpoint
curl -f http://localhost:3001/health

# Inspect container
docker exec -it cellseg-backend-prod /bin/bash
```

#### Database Connection Issues

```bash
# Test database connection
docker exec cellseg-postgres-prod psql -U cellseg -c "SELECT 1;"

# Check connection string
echo $DATABASE_URL
```

#### SSL Certificate Problems

```bash
# Check certificate validity
openssl x509 -in /etc/letsencrypt/live/yourdomain.com/cert.pem -text -noout

# Test SSL configuration
curl -vI https://yourdomain.com
```

For detailed troubleshooting steps, see [Production Troubleshooting Guide](./troubleshooting.md).

## Security Checklist

- [ ] Strong JWT secrets configured
- [ ] Database credentials secured
- [ ] SSL/TLS certificates installed
- [ ] CORS origins restricted
- [ ] Rate limiting enabled
- [ ] Security headers configured
- [ ] File upload restrictions enforced
- [ ] Database backups automated
- [ ] Monitoring alerts configured
- [ ] Log retention policy implemented

## Performance Optimization

### Database Optimization

```sql
-- Add indexes for common queries
CREATE INDEX CONCURRENTLY idx_projects_user_updated ON projects(userId, updatedAt DESC);
CREATE INDEX CONCURRENTLY idx_images_project_status ON images(projectId, segmentationStatus);

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM projects WHERE userId = 'user123';
```

### Caching Strategy

```yaml
# Redis caching configuration
services:
  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
```

### CDN Integration

```nginx
# Static asset caching
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## Maintenance

### Regular Tasks

- Database backups (automated)
- SSL certificate renewal (automated)
- Security updates (monthly)
- Performance monitoring (continuous)
- Log rotation (automated)
- Cleanup old data (quarterly)

### Update Procedure

```bash
# 1. Backup current state
./scripts/backup.sh

# 2. Pull latest code
git pull origin main

# 3. Build new images
docker-compose -f docker-compose.prod.yml build

# 4. Rolling update
docker-compose -f docker-compose.prod.yml up -d

# 5. Verify deployment
./scripts/health-check.sh
```

This deployment guide provides a comprehensive foundation for running the Cell Segmentation Hub in production environments with high availability, security, and scalability.
