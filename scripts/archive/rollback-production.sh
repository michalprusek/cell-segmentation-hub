#!/bin/bash

# Rollback Production to Previous Version
# Emergency rollback script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${RED}    EMERGENCY ROLLBACK - Production${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"

# Confirmation
read -p "Are you sure you want to rollback production? (type 'ROLLBACK' to confirm): " confirm
if [ "$confirm" != "ROLLBACK" ]; then
    echo "Rollback cancelled"
    exit 0
fi

echo -e "\n${YELLOW}Starting rollback...${NC}"

# 1. Check for rollback images
echo "Checking for rollback images..."
if ! docker images | grep -q "rollback"; then
    echo -e "${RED}Error: No rollback images found!${NC}"
    echo "Looking for previous versions..."
    
    # Find previous production images
    PREV_TAG=$(docker images --format "{{.Tag}}" | grep "production-" | head -1)
    if [ -z "$PREV_TAG" ]; then
        echo -e "${RED}No previous versions found. Manual intervention required.${NC}"
        exit 1
    fi
    
    echo "Found previous version: $PREV_TAG"
    docker tag spheroseg-app-frontend:$PREV_TAG spheroseg-app-frontend:latest
    docker tag spheroseg-app-backend:$PREV_TAG spheroseg-app-backend:latest
    docker tag spheroseg-app-ml-service:$PREV_TAG spheroseg-app-ml-service:latest
else
    # Use rollback images
    docker tag spheroseg-app-frontend:rollback spheroseg-app-frontend:latest
    docker tag spheroseg-app-backend:rollback spheroseg-app-backend:latest
    docker tag spheroseg-app-ml-service:rollback spheroseg-app-ml-service:latest
fi

# 2. Restore previous environment if backup exists
if [ -f ".env.production.backup."* ]; then
    LATEST_BACKUP=$(ls -t .env.production.backup.* | head -1)
    echo "Restoring environment from $LATEST_BACKUP"
    cp $LATEST_BACKUP .env.production
fi

# 3. Restart services
echo -e "\n${YELLOW}Restarting services with previous version...${NC}"
docker compose -f docker-compose.prod.yml up -d --force-recreate

# 4. Wait for services
echo "Waiting for services to start..."
sleep 20

# 5. Health check
echo -e "\n${YELLOW}Verifying rollback...${NC}"
PROD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://spherosegapp.utia.cas.cz 2>/dev/null || echo "000")
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://spherosegapp.utia.cas.cz/api/health 2>/dev/null || echo "000")

if [ "$PROD_STATUS" = "200" ] && [ "$API_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Rollback successful!${NC}"
    echo -e "${GREEN}Production is running the previous version${NC}"
else
    echo -e "${RED}✗ Rollback may have failed!${NC}"
    echo -e "${RED}Site status: $PROD_STATUS, API status: $API_STATUS${NC}"
    echo -e "${RED}Manual intervention may be required${NC}"
    
    # Show logs for debugging
    echo -e "\n${YELLOW}Recent logs:${NC}"
    docker compose -f docker-compose.prod.yml logs --tail=50
fi

echo -e "\n${YELLOW}Rollback complete. Please investigate the issue before attempting another deployment.${NC}"