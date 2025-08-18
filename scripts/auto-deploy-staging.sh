#!/bin/bash
# Auto-deploy staging on git push
# Run this script in background: ./scripts/auto-deploy-staging.sh &

set -e

STAGING_DIR="/home/cvat/cell-segmentation-hub"
BRANCH="staging"
CHECK_INTERVAL=30  # Check every 30 seconds

echo "🚀 Auto-deploy staging started"
echo "Watching for changes on branch: $BRANCH"
echo "Check interval: ${CHECK_INTERVAL}s"

cd "$STAGING_DIR"

# Store initial commit
LAST_COMMIT=$(git rev-parse HEAD)

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
        
        # Pull changes
        echo "⬇️ Pulling latest changes..."
        git pull origin $BRANCH
        
        # Rebuild and restart staging
        echo "🔨 Building Docker images..."
        docker compose -f docker-compose.staging.yml build
        
        echo "🔄 Restarting services..."
        docker compose -f docker-compose.staging.yml down
        docker compose -f docker-compose.staging.yml up -d
        
        # Wait for services to start
        sleep 10
        
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