#!/bin/bash
# Auto-deploy production on merge to main branch
# Run this script in background: ./scripts/auto-deploy-production.sh &

set -eEuo pipefail

# Error trap for debugging (propagates to functions and subshells)
trap 'echo "Error at line $LINENO: Command \"$BASH_COMMAND\" failed with exit code $?" >&2' ERR
trap 'echo "Script interrupted by signal" >&2; exit 130' INT TERM
trap 'echo "Script exiting" >&2' EXIT

PRODUCTION_DIR="/home/cvat/spheroseg-app"
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
    {
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
        
        # Pull changes with deterministic reset
        echo "⬇️ Pulling latest changes from $BRANCH..."
        git fetch origin "$BRANCH"
        git checkout --force "$BRANCH" || git checkout -B "$BRANCH" "origin/$BRANCH"
        git reset --hard "$REMOTE_COMMIT"
        
        # Verify we're on the expected state
        if [ "$(git rev-parse HEAD)" != "$REMOTE_COMMIT" ]; then
            echo "❌ Failed to reset to expected commit $REMOTE_COMMIT" >&2
            exit 1
        fi
        
        if [ "$(git status --porcelain)" != "" ]; then
            echo "❌ Working tree is not clean after reset" >&2
            exit 1
        fi
        
        if ! git symbolic-ref -q HEAD >/dev/null; then
            echo "❌ In detached HEAD state, expected to be on branch $BRANCH" >&2
            exit 1
        fi
        
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
        if ! docker compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy; then
            echo "❌ Database migration failed!" >&2
            exit 1
        fi
        
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
            
            # Check if database backup exists
            LATEST_BACKUP=$(ls -t backup-*.sql 2>/dev/null | head -1)
            if [ -n "$LATEST_BACKUP" ]; then
                echo "📥 Found database backup: $LATEST_BACKUP"
                read -p "Restore database from backup? This will overwrite current data! (y/N): " -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    echo "🔄 Restoring database..."
                    docker exec -i spheroseg-db psql -U postgres -d spheroseg < "$LATEST_BACKUP"
                fi
            fi
            
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
    } || {
        echo "❌ Deploy iteration failed with code: $?" >&2
        echo "⏳ Waiting ${CHECK_INTERVAL}s before retry..." >&2
        sleep $CHECK_INTERVAL
        continue
    }
done