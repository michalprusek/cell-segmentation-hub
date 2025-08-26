#!/bin/bash
# Safe auto-deploy staging on git push - preserves database
# Run this script in background: ./scripts/auto-deploy-staging-safe.sh &

set -e

STAGING_DIR="/home/cvat/cell-segmentation-hub"
BRANCH="staging"
CHECK_INTERVAL=30  # Check every 30 seconds
LOG_FILE="/tmp/auto-deploy-staging.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

log "${GREEN}🚀 Safe Auto-deploy staging started${NC}"
log "Watching for changes on branch: $BRANCH"
log "Check interval: ${CHECK_INTERVAL}s"
log "Log file: $LOG_FILE"

cd "$STAGING_DIR"

# Store initial commit
LAST_COMMIT=$(git rev-parse HEAD)

while true; do
    # Fetch latest changes
    git fetch origin $BRANCH --quiet 2>/dev/null || {
        log "${YELLOW}⚠️ Failed to fetch from remote, will retry...${NC}"
        sleep $CHECK_INTERVAL
        continue
    }
    
    # Get latest remote commit
    REMOTE_COMMIT=$(git rev-parse origin/$BRANCH 2>/dev/null || echo "")
    
    # Check if there are new changes
    if [ -n "$REMOTE_COMMIT" ] && [ "$LAST_COMMIT" != "$REMOTE_COMMIT" ]; then
        log ""
        log "${GREEN}📦 New changes detected!${NC}"
        log "Current: $LAST_COMMIT"
        log "Remote:  $REMOTE_COMMIT"
        
        # Show what changed
        log "${YELLOW}Changes:${NC}"
        git log --oneline "$LAST_COMMIT..$REMOTE_COMMIT" | head -5
        
        # Pull changes
        log "${GREEN}⬇️ Pulling latest changes...${NC}"
        if ! git pull origin $BRANCH; then
            log "${RED}❌ Failed to pull changes, will retry next cycle${NC}"
            sleep $CHECK_INTERVAL
            continue
        fi
        
        # Check if database schema changed
        SCHEMA_CHANGED=$(git diff "$LAST_COMMIT" "$REMOTE_COMMIT" --name-only | grep -E "schema.prisma|migrations/" || true)
        
        # Rebuild only changed services
        log "${GREEN}🔨 Building Docker images...${NC}"
        docker compose -f docker-compose.staging.yml build
        
        log "${GREEN}🔄 Restarting services (preserving database)...${NC}"
        
        # Smart restart - keep database running
        SERVICES_TO_RESTART="frontend backend ml-service nginx redis prometheus grafana"
        
        # Stop non-database services
        docker compose -f docker-compose.staging.yml stop $SERVICES_TO_RESTART 2>/dev/null || true
        
        # Start all services (database will stay up if already running)
        docker compose -f docker-compose.staging.yml up -d --remove-orphans
        
        # Wait for services to be ready
        log "⏳ Waiting for services to start..."
        sleep 15
        
        # Run migrations if schema changed
        if [ -n "$SCHEMA_CHANGED" ]; then
            log "${YELLOW}📝 Database schema changed, running migrations...${NC}"
            if docker exec staging-backend npx prisma migrate deploy; then
                log "${GREEN}✅ Migrations applied successfully${NC}"
            else
                log "${RED}❌ Migration failed - manual intervention may be needed${NC}"
            fi
        else
            log "📝 No database schema changes detected"
        fi
        
        # Health checks with retries
        log "${GREEN}🏥 Running health checks...${NC}"
        
        # Frontend check
        for i in {1..3}; do
            if curl -f http://localhost:4000 > /dev/null 2>&1; then
                log "${GREEN}✅ Frontend is running${NC}"
                break
            elif [ $i -eq 3 ]; then
                log "${RED}❌ Frontend is not responding after 3 attempts${NC}"
            else
                sleep 5
            fi
        done
        
        # Backend API check
        for i in {1..3}; do
            if curl -f http://localhost:4001/api/health > /dev/null 2>&1; then
                log "${GREEN}✅ Backend API is running${NC}"
                break
            elif [ $i -eq 3 ]; then
                log "${RED}❌ Backend API is not responding after 3 attempts${NC}"
            else
                sleep 5
            fi
        done
        
        # ML Service check
        for i in {1..3}; do
            if curl -f http://localhost:4008/health > /dev/null 2>&1; then
                log "${GREEN}✅ ML Service is running${NC}"
                break
            elif [ $i -eq 3 ]; then
                log "${YELLOW}⚠️ ML Service is not responding (may take longer to start)${NC}"
            else
                sleep 5
            fi
        done
        
        # Update last commit
        LAST_COMMIT=$REMOTE_COMMIT
        
        log "${GREEN}✅ Deployment complete!${NC}"
        log "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
        log "Waiting for next changes..."
    fi
    
    # Wait before next check
    sleep $CHECK_INTERVAL
done