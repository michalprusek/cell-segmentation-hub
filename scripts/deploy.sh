#!/bin/bash

# Deployment script for SphereSeg application
set -e

echo "🚀 Starting SphereSeg deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as appropriate user
if [ "$EUID" -eq 0 ]; then 
   echo -e "${RED}Please do not run as root${NC}"
   exit 1
fi

# Change to project directory
DEPLOY_DIR="${DEPLOY_DIR:-/home/cvat/cell-segmentation-hub}"
if [ ! -d "$DEPLOY_DIR" ]; then
    echo -e "${RED}Deployment directory does not exist: $DEPLOY_DIR${NC}"
    exit 1
fi
cd "$DEPLOY_DIR"

# Check for required files
echo "📋 Checking required files..."
required_files=(".env.production" "docker-compose.prod.yml" "backend/segmentation/weights/hrnet_best_model.pth")
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}Missing required file: $file${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ All required files present${NC}"

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker compose -f docker-compose.prod.yml down --remove-orphans || true

# Build images
echo "🔨 Building Docker images..."
docker compose -f docker-compose.prod.yml build --parallel

# Start services
echo "🚀 Starting services..."
docker compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Run database migrations
echo "📊 Running database migrations..."
docker compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy || {
    echo -e "${YELLOW}Warning: Could not run migrations. Will retry...${NC}"
    sleep 5
    docker compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy
}

# Check service health
echo "🏥 Checking service health..."
services=("nginx" "frontend" "backend" "ml-service" "postgres" "redis")
all_healthy=true

for service in "${services[@]}"; do
    container_id=$(docker compose -f docker-compose.prod.yml ps -q "$service" 2>/dev/null)
    if [ -n "$container_id" ]; then
        health_status=$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || echo "no-health-check")
        case "$health_status" in
            "healthy")
                echo -e "${GREEN}✅ $service is healthy${NC}"
                ;;
            "no-health-check")
                # Check if container is running for services without health check
                if docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null | grep -q "true"; then
                    echo -e "${GREEN}✅ $service is running${NC}"
                else
                    echo -e "${RED}❌ $service is not running${NC}"
                    all_healthy=false
                fi
                ;;
            "unhealthy"|"starting")
                echo -e "${YELLOW}⚠️  $service is $health_status${NC}"
                all_healthy=false
                ;;
            *)
                echo -e "${RED}❌ $service health check failed${NC}"
                all_healthy=false
                ;;
        esac
    else
        echo -e "${RED}❌ $service container not found${NC}"
        all_healthy=false
    fi
done

if [ "$all_healthy" = true ]; then
    echo -e "${GREEN}🎉 Deployment successful!${NC}"
    echo ""
    echo "Application is available at: https://spherosegapp.utia.cas.cz"
    echo "Monitoring available at: https://spherosegapp.utia.cas.cz/grafana"
    echo ""
    echo "To view logs: docker compose -f docker-compose.prod.yml logs -f"
else
    echo -e "${YELLOW}⚠️  Some services are not healthy. Check logs for details.${NC}"
    exit 1
fi