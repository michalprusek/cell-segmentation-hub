#!/bin/bash

# Deploy from Staging to Production
# This script promotes staging environment to production

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}    SpheroSeg - Staging to Production Deployment${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"

# Check if running on production server
if [ ! -f "/home/cvat/spheroseg-app/docker-compose.prod.yml" ]; then
    echo -e "${RED}Error: This script must be run on the production server${NC}"
    exit 1
fi

# Function to confirm action
confirm() {
    read -p "$1 (y/N): " response
    case "$response" in
        [yY][eE][sS]|[yY]) 
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# 1. Pre-deployment checks
echo -e "\n${YELLOW}Step 1: Pre-deployment checks${NC}"
echo "Checking staging environment health..."

# Check staging is running
STAGING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000 2>/dev/null || echo "000")
if [ "$STAGING_STATUS" != "200" ]; then
    echo -e "${RED}Error: Staging environment is not healthy (HTTP $STAGING_STATUS)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Staging environment is healthy${NC}"

# 2. Backup production database
echo -e "\n${YELLOW}Step 2: Backup production database${NC}"
if confirm "Do you want to backup the production database?"; then
    BACKUP_DIR="/backup/postgres/$(date +%Y%m%d-%H%M%S)"
    mkdir -p $BACKUP_DIR
    
    echo "Creating database backup..."
    # Use environment variables for credentials
    DB_USER="${DB_USER:-postgres}"
    DB_NAME="${DB_NAME:-spheroseg}"
    docker exec spheroseg-db pg_dump -U "$DB_USER" "$DB_NAME" > $BACKUP_DIR/spheroseg.sql
    gzip $BACKUP_DIR/spheroseg.sql
    echo -e "${GREEN}✓ Backup created: $BACKUP_DIR/spheroseg.sql.gz${NC}"
else
    echo -e "${YELLOW}⚠ Skipping database backup (not recommended)${NC}"
fi

# 3. Export staging images
echo -e "\n${YELLOW}Step 3: Preparing staging images for production${NC}"
echo "Tagging staging images as production..."

# Tag staging images as production
docker tag spheroseg-app-frontend:latest spheroseg-app-frontend:production-$(date +%Y%m%d-%H%M%S)
docker tag spheroseg-app-backend:latest spheroseg-app-backend:production-$(date +%Y%m%d-%H%M%S)
docker tag spheroseg-app-ml-service:latest spheroseg-app-ml-service:production-$(date +%Y%m%d-%H%M%S)

# Keep current production as rollback
docker tag spheroseg-app-frontend:latest spheroseg-app-frontend:rollback
docker tag spheroseg-app-backend:latest spheroseg-app-backend:rollback
docker tag spheroseg-app-ml-service:latest spheroseg-app-ml-service:rollback

echo -e "${GREEN}✓ Images tagged for deployment${NC}"

# 4. Stop staging to free resources
echo -e "\n${YELLOW}Step 4: Stopping staging environment${NC}"
if confirm "Stop staging environment to free resources?"; then
    docker compose -f docker-compose.staging.yml down
    echo -e "${GREEN}✓ Staging environment stopped${NC}"
else
    echo -e "${YELLOW}⚠ Staging still running (may cause resource issues)${NC}"
fi

# 5. Update production configuration
echo -e "\n${YELLOW}Step 5: Updating production configuration${NC}"

# Copy staging configs to production
if [ -f ".env.staging" ]; then
    echo "Updating environment variables..."
    # Backup current production env
    cp .env.production .env.production.backup.$(date +%Y%m%d-%H%M%S)
    
    # Update production env with staging values (keep production-specific vars)
    # Create secure temp file
    TEMP_SECRETS=$(mktemp)
    chmod 600 "$TEMP_SECRETS"
    trap "rm -f '$TEMP_SECRETS'" EXIT
    
    grep -E "^(POSTGRES_PASSWORD|JWT_SECRET|ADMIN_EMAIL|SMTP_)" .env.production > "$TEMP_SECRETS"
    cp .env.staging .env.production
    cat "$TEMP_SECRETS" >> .env.production
    
    echo -e "${GREEN}✓ Configuration updated${NC}"
fi

# 6. Deploy to production
echo -e "\n${YELLOW}Step 6: Deploying to production${NC}"
echo -e "${YELLOW}This will cause a brief downtime (< 1 minute)${NC}"

if ! confirm "Deploy to production now?"; then
    echo -e "${RED}Deployment cancelled${NC}"
    exit 0
fi

echo "Starting deployment..."

# Run database migrations
echo "Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy

# Restart services with new images
echo "Restarting services..."
docker compose -f docker-compose.prod.yml up -d --no-deps backend
sleep 5
docker compose -f docker-compose.prod.yml up -d --no-deps frontend
sleep 5
docker compose -f docker-compose.prod.yml up -d --no-deps ml-service
sleep 5

# Restart nginx to pick up any config changes
docker compose -f docker-compose.prod.yml restart nginx

# 7. Health checks
echo -e "\n${YELLOW}Step 7: Verifying deployment${NC}"
echo "Waiting for services to be ready..."
sleep 15

# Check production health
PROD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://spherosegapp.utia.cas.cz 2>/dev/null || echo "000")
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://spherosegapp.utia.cas.cz/api/health 2>/dev/null || echo "000")

if [ "$PROD_STATUS" = "200" ] && [ "$API_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Production deployment successful!${NC}"
    echo -e "${GREEN}✓ Site: https://spherosegapp.utia.cas.cz${NC}"
    echo -e "${GREEN}✓ API: https://spherosegapp.utia.cas.cz/api${NC}"
else
    echo -e "${RED}✗ Deployment verification failed!${NC}"
    echo -e "${RED}Site status: $PROD_STATUS, API status: $API_STATUS${NC}"
    
    if confirm "Rollback to previous version?"; then
        echo "Rolling back..."
        docker tag spheroseg-app-frontend:rollback spheroseg-app-frontend:latest
        docker tag spheroseg-app-backend:rollback spheroseg-app-backend:latest
        docker tag spheroseg-app-ml-service:rollback spheroseg-app-ml-service:latest
        
        docker compose -f docker-compose.prod.yml up -d --force-recreate
        echo -e "${YELLOW}Rolled back to previous version${NC}"
    fi
    exit 1
fi

# 8. Cleanup
echo -e "\n${YELLOW}Step 8: Cleanup${NC}"
docker image prune -f
echo -e "${GREEN}✓ Cleanup complete${NC}"

# 9. Summary
echo -e "\n${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}    Deployment Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "Production URL: https://spherosegapp.utia.cas.cz"
echo -e "Backup location: $BACKUP_DIR/spheroseg.sql.gz"
echo -e "\nTo rollback if needed:"
echo -e "  ./scripts/rollback-production.sh"
echo -e "\nTo restart staging:"
echo -e "  docker compose -f docker-compose.staging.yml up -d"