#!/bin/bash

# Database Migration Rollback
# Usage: ./scripts/rollback-migration.sh [environment]
# Environments: dev (default), staging, production

set -euo pipefail
IFS=$'\n\t'

ENVIRONMENT=${1:-dev}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIGRATION_DIR="$PROJECT_ROOT/backend/prisma/migrations/20250121_add_queue_improvements"

echo "⏪ Rolling back database migration for environment: $ENVIRONMENT"

# Confirm rollback
echo "⚠️  WARNING: You are about to rollback migration!"
echo "   Environment: $ENVIRONMENT"
read -p "   Are you sure? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "❌ Rollback cancelled"
    exit 1
fi

case $ENVIRONMENT in
    dev)
        export DATABASE_URL="file:./data/dev.db"
        echo "📁 Rolling back SQLite database..."
        
        # Create SQLite rollback script
        cat > "$MIGRATION_DIR/rollback_sqlite.sql" << 'EOF'
-- SQLite rollback
-- Drop indexes (safe operation)
DROP INDEX IF EXISTS idx_queue_processing;
DROP INDEX IF EXISTS idx_queue_user_status;
DROP INDEX IF EXISTS idx_queue_project_status;
DROP INDEX IF EXISTS idx_queue_batch;
DROP INDEX IF EXISTS idx_queue_timeout;

-- Note: SQLite doesn't support dropping columns easily
-- We'll keep the columns but they won't cause issues
EOF
        
        cd "$PROJECT_ROOT/backend"
        sqlite3 data/dev.db < "$MIGRATION_DIR/rollback_sqlite.sql"
        ;;
        
    staging)
        if [ -f "$PROJECT_ROOT/.env.staging" ]; then
            source "$PROJECT_ROOT/.env.staging"
        fi
        export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/spheroseg_staging}"
        echo "🐘 Rolling back PostgreSQL staging database..."
        
        cd "$PROJECT_ROOT/backend"
        psql --no-psqlrc --set=ON_ERROR_STOP=1 "$DATABASE_URL" -f "$MIGRATION_DIR/rollback.sql"
        ;;
        
    production)
        if [ -f "$PROJECT_ROOT/.env.production" ]; then
            source "$PROJECT_ROOT/.env.production"
        fi
        export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/spheroseg_production}"
        
        # Double confirm for production
        echo "⚠️  WARNING: You are about to rollback PRODUCTION database!"
        echo "   Database: $DATABASE_URL"
        read -p "   Type 'rollback production' to confirm: " confirm
        if [ "$confirm" != "rollback production" ]; then
            echo "❌ Rollback cancelled"
            exit 1
        fi
        
        echo "🐘 Rolling back PostgreSQL production database..."
        cd "$PROJECT_ROOT/backend"
        psql --no-psqlrc --set=ON_ERROR_STOP=1 -X -q "$DATABASE_URL" -f "$MIGRATION_DIR/rollback.sql"
        ;;
        
    *)
        echo "❌ Unknown environment: $ENVIRONMENT"
        echo "   Valid environments: dev, staging, production"
        exit 1
        ;;
esac

echo ""
echo "✅ Rollback completed successfully!"
echo ""
echo "Next steps:"
echo "1. Run 'npx prisma generate' to update Prisma client"
echo "2. Restart the application"
echo "3. Verify everything works correctly"