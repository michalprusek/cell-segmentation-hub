#!/bin/bash
# Auto-deploy production on merge to main branch
# Run this script in background: ./scripts/auto-deploy-production.sh &

set -e

PRODUCTION_DIR="/home/cvat/cell-segmentation-hub"
BRANCH="main"
CHECK_INTERVAL=60  # Check every 60 seconds for production

echo "🚀 Auto-deploy PRODUCTION started"
echo "Watching for changes on branch: $BRANCH"
echo "Check interval: ${CHECK_INTERVAL}s"
echo "⚠️  WARNING: This will deploy to PRODUCTION environment!"

cd "$PRODUCTION_DIR"

# Store initial commit
LAST_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "none")

while true; do
    # Fetch latest changes
    git fetch origin $BRANCH --quiet
    
    # Get latest remote commit
    REMOTE_COMMIT=$(git rev-parse origin/$BRANCH 2>/dev/null || echo "none")
    
    # Check if there are new changes
    if [ "$LAST_COMMIT" != "$REMOTE_COMMIT" ] && [ "$REMOTE_COMMIT" != "none" ]; then
        echo ""
        echo "🔴 PRODUCTION DEPLOYMENT TRIGGERED!"
        echo "Current: $LAST_COMMIT"
        echo "Remote:  $REMOTE_COMMIT"
        echo "Time: $(date)"
        
        # Create backup marker
        echo "📸 Creating deployment snapshot..."
        BACKUP_TAG="prod-backup-$(date +%Y%m%d-%H%M%S)"
        git tag -a "$BACKUP_TAG" -m "Backup before production deployment" || true
        
        # Pull changes
        echo "⬇️ Pulling latest changes from main..."
        git checkout main
        git pull origin main
        
        # Stop staging services first to free resources
        echo "🛑 Stopping staging services to free resources..."
        docker compose -f docker-compose.staging.yml down || true
        
        # Build production images
        echo "🔨 Building PRODUCTION Docker images..."
        docker compose -f docker-compose.prod.yml build
        
        # Database backup
        echo "💾 Backing up production database..."
        docker exec spheroseg-db pg_dump -U postgres spheroseg > backup-$(date +%Y%m%d-%H%M%S).sql 2>/dev/null || echo "No existing database to backup"
        
        # Run database migrations
        echo "📊 Running database migrations..."
        docker compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy || true
        
        # Deploy with zero-downtime strategy
        echo "🔄 Starting PRODUCTION services..."
        docker compose -f docker-compose.prod.yml up -d --remove-orphans
        
        # Wait for services to be ready
        echo "⏳ Waiting for services to start..."
        sleep 15
        
        # Health check
        echo "🏥 Running health checks..."
        HEALTH_OK=true
        
        if curl -f http://localhost:3000 > /dev/null 2>&1; then
            echo "✅ Frontend is running at http://localhost:3000"
        else
            echo "❌ Frontend is not responding"
            HEALTH_OK=false
        fi
        
        if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
            echo "✅ Backend API is running at http://localhost:3001"
        else
            echo "❌ Backend API is not responding"
            HEALTH_OK=false
        fi
        
        if curl -f http://localhost:8000/health > /dev/null 2>&1; then
            echo "✅ ML Service is running at http://localhost:8000"
        else
            echo "❌ ML Service is not responding"
            HEALTH_OK=false
        fi
        
        # Rollback if health check fails
        if [ "$HEALTH_OK" = false ]; then
            echo "🔥 HEALTH CHECK FAILED! Rolling back..."
            git checkout "$BACKUP_TAG"
            docker compose -f docker-compose.prod.yml build
            docker compose -f docker-compose.prod.yml up -d
            echo "⚠️  Rollback completed. Manual intervention may be required."
        else
            # Update last commit only if deployment successful
            LAST_COMMIT=$REMOTE_COMMIT
            
            # Cleanup
            echo "🧹 Cleaning up..."
            docker image prune -f
            
            # Restart staging
            echo "🔄 Restarting staging services..."
            docker compose -f docker-compose.staging.yml up -d
            
            echo ""
            echo "✅ PRODUCTION DEPLOYMENT COMPLETE!"
            echo "📋 Production URLs:"
            echo "  Frontend: http://localhost:3000"
            echo "  Backend API: http://localhost:3001/api"
            echo "  ML Service: http://localhost:8000"
            echo "  API Docs: http://localhost:3001/api-docs"
            echo ""
            echo "Commit: $REMOTE_COMMIT"
            echo "Time: $(date)"
        fi
        
        echo "Waiting for next changes..."
    fi
    
    # Wait before next check
    sleep $CHECK_INTERVAL
done