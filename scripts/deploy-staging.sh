#!/bin/bash

# Staging Deployment Script for SpheroSeg
# This script deploys the application to staging environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
STAGING_DIR="/home/spheroseg/staging"
BACKUP_DIR="/home/spheroseg/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo -e "${GREEN}=== SpheroSeg Staging Deployment ===${NC}"
echo "Timestamp: $TIMESTAMP"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"
for cmd in docker docker-compose git; do
    if ! command_exists $cmd; then
        echo -e "${RED}Error: $cmd is not installed${NC}"
        exit 1
    fi
done

# Load environment variables
if [ -f .env.staging ]; then
    echo -e "${GREEN}Loading staging environment variables...${NC}"
    export $(cat .env.staging | grep -v '^#' | xargs)
else
    echo -e "${RED}Error: .env.staging file not found${NC}"
    exit 1
fi

# Validate required environment variables
REQUIRED_VARS=(
    "STAGING_JWT_ACCESS_SECRET"
    "STAGING_JWT_REFRESH_SECRET"
    "DB_PASSWORD"
    "SMTP_PASSWORD"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}Error: $var is not set in environment${NC}"
        exit 1
    fi
done

# Backup database if exists
echo -e "${YELLOW}Backing up database...${NC}"
if docker exec spheroseg-postgres-staging pg_dump -U spheroseg spheroseg_staging > /dev/null 2>&1; then
    mkdir -p "$BACKUP_DIR"
    docker exec spheroseg-postgres-staging pg_dump -U spheroseg spheroseg_staging | gzip > "$BACKUP_DIR/staging_db_$TIMESTAMP.sql.gz"
    echo -e "${GREEN}Database backed up to $BACKUP_DIR/staging_db_$TIMESTAMP.sql.gz${NC}"
else
    echo -e "${YELLOW}No existing database to backup or backup failed${NC}"
fi

# Pull latest code
echo -e "${YELLOW}Pulling latest code from main branch...${NC}"
git fetch origin
git checkout main
git pull origin main

# Build Docker images
echo -e "${YELLOW}Building Docker images...${NC}"
docker-compose -f docker-compose.staging.yml build --no-cache

# Stop existing containers
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose -f docker-compose.staging.yml down

# Start new containers
echo -e "${YELLOW}Starting new containers...${NC}"
docker-compose -f docker-compose.staging.yml up -d

# Wait for services to be healthy
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 10

# Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
docker exec spheroseg-backend-staging npx prisma migrate deploy

# Verify deployment
echo -e "${YELLOW}Verifying deployment...${NC}"
SERVICES=("staging-frontend:4000" "staging-backend:4001" "staging-ml:4008")
ALL_HEALTHY=true

for service in "${SERVICES[@]}"; do
    IFS=':' read -r container port <<< "$service"
    if curl -f "http://localhost:$port/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ $container is healthy${NC}"
    else
        echo -e "${RED}✗ $container is not responding${NC}"
        ALL_HEALTHY=false
    fi
done

if $ALL_HEALTHY; then
    echo -e "${GREEN}=== Deployment successful! ===${NC}"
    echo "Access the staging environment at:"
    echo "  Frontend: http://localhost:4000"
    echo "  Backend API: http://localhost:4001/api"
    echo "  ML Service: http://localhost:4008"
    echo "  Grafana: http://localhost:3031"
    echo "  Prometheus: http://localhost:9091"
else
    echo -e "${RED}=== Deployment completed with errors ===${NC}"
    echo "Check logs with: docker-compose -f docker-compose.staging.yml logs"
    exit 1
fi

# Clean up old Docker images
echo -e "${YELLOW}Cleaning up old Docker images...${NC}"
docker image prune -f

# Display container status
echo -e "${YELLOW}Container status:${NC}"
docker-compose -f docker-compose.staging.yml ps

echo -e "${GREEN}=== Staging deployment complete ===${NC}"