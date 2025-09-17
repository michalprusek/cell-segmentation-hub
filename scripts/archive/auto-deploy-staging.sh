#!/bin/bash
# Auto-deploy staging on git push
# Run this script in background: ./scripts/auto-deploy-staging.sh &

set -euo pipefail

# Error trap for debugging
trap 'echo "Error at line $LINENO: Command \"$BASH_COMMAND\" failed with exit code $?" >&2' ERR

# Allow environment overrides with validation
STAGING_DIR="${STAGING_DIR:-"/home/cvat/spheroseg-app"}"
BRANCH="${BRANCH:-"staging"}"
CHECK_INTERVAL="${CHECK_INTERVAL:-30}"  # Check every 30 seconds
PROJECT="${PROJECT:-"staging"}"  # Docker Compose project name

# Validate directory exists and is a git repo
if [ ! -d "$STAGING_DIR/.git" ]; then
    echo "Error: $STAGING_DIR is not a git repository!" >&2
    exit 1
fi

echo "🚀 Auto-deploy staging started"
echo "Watching for changes on branch: $BRANCH"
echo "Check interval: ${CHECK_INTERVAL}s"

cd "$STAGING_DIR"

# Fetch remote refs to ensure we have latest
git fetch origin

# Store initial commit from remote branch
LAST_COMMIT=$(git rev-parse origin/$BRANCH 2>/dev/null || git rev-parse HEAD)

while true; do
    # Fetch latest changes
    git fetch origin $BRANCH --quiet
    
    # Get latest remote commit
    REMOTE_COMMIT=$(git rev-parse origin/$BRANCH)
    
    # Check if there are new changes
    if [ "$LAST_COMMIT" != "$REMOTE_COMMIT" ]; then
        echo ""
        echo "📦 New changes detected!"
        echo "Current: $LAST_COMMIT"
        echo "Remote:  $REMOTE_COMMIT"
        
        # Pull changes safely with proper quoting
        echo "⬇️ Syncing with remote..."
        git fetch origin
        git checkout -B "$BRANCH" "origin/$BRANCH"
        git reset --hard "origin/$BRANCH"
        git clean -fd  # Note: removed -x to preserve .env files
        
        # Rebuild and restart staging with consistent project name
        echo "🔨 Building Docker images..."
        docker compose -f docker-compose.staging.yml -p "$PROJECT" build
        
        echo "🔄 Restarting services (preserving database)..."
        # Stop and remove containers but KEEP volumes (database data)
        docker compose -f docker-compose.staging.yml -p "$PROJECT" stop
        docker compose -f docker-compose.staging.yml -p "$PROJECT" up -d --remove-orphans
        
        # Wait for services to start
        sleep 10
        
        # Run migrations if needed
        echo "🗄️ Checking database migrations..."
        docker compose -f docker-compose.staging.yml -p "$PROJECT" exec -T backend npx prisma migrate deploy || echo "⚠️ Migration check failed (may be normal on first run)"
        
        # Optionally restart just backend after migrations
        docker compose -f docker-compose.staging.yml -p "$PROJECT" up -d --no-deps backend
        
        # Health check
        echo "🏥 Running health checks..."
        if curl -f http://localhost:4000 > /dev/null 2>&1; then
            echo "✅ Frontend is running"
        else
            echo "❌ Frontend is not responding"
        fi
        
        if curl -f http://localhost:4001/api/health > /dev/null 2>&1; then
            echo "✅ Backend API is running"
        else
            echo "❌ Backend API is not responding"
        fi
        
        if curl -f http://localhost:4008/health > /dev/null 2>&1; then
            echo "✅ ML Service is running"
        else
            echo "❌ ML Service is not responding"
        fi
        
        # Update last commit
        LAST_COMMIT=$REMOTE_COMMIT
        
        echo "✅ Deployment complete!"
        echo "Waiting for next changes..."
    fi
    
    # Wait before next check
    sleep $CHECK_INTERVAL
done