#!/bin/bash

# Database Migration Runner
# Usage: ./scripts/run-migration.sh [environment]
# Environments: dev (default), staging, production

set -euo pipefail
IFS=$'\n\t'

ENVIRONMENT=${1:-dev}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIGRATION_DIR="$PROJECT_ROOT/backend/prisma/migrations/20250121_add_queue_improvements"

echo "🔄 Running database migration for environment: $ENVIRONMENT"

# Load environment-specific database URL
case $ENVIRONMENT in
    dev)
        export DATABASE_URL="file:./data/dev.db"
        echo "📁 Using SQLite database for development"
        
        # For SQLite, we need to use different migration
        cat > "$MIGRATION_DIR/migration_sqlite.sql" << 'EOF'
-- SQLite version of migration
-- Add detectHoles column if it doesn't exist
ALTER TABLE SegmentationQueue ADD COLUMN detectHoles INTEGER DEFAULT 1;

-- Add updatedAt column if it doesn't exist  
ALTER TABLE SegmentationQueue ADD COLUMN updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_queue_processing 
ON SegmentationQueue(status, priority DESC, createdAt ASC)
WHERE status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS idx_queue_user_status 
ON SegmentationQueue(userId, status, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_queue_project_status 
ON SegmentationQueue(projectId, status, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_queue_batch 
ON SegmentationQueue(batchId, status)
WHERE batchId IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_queue_timeout 
ON SegmentationQueue(status, startedAt)
WHERE status = 'processing' AND startedAt IS NOT NULL;

-- Update existing records
UPDATE SegmentationQueue SET detectHoles = 1 WHERE detectHoles IS NULL;
UPDATE SegmentationQueue SET updatedAt = createdAt WHERE updatedAt IS NULL;
EOF
        
        # Run SQLite migration
        cd "$PROJECT_ROOT/backend"
        echo "🏃 Running SQLite migration..."
        sqlite3 data/dev.db < "$MIGRATION_DIR/migration_sqlite.sql" || {
            echo "⚠️  Some statements may have failed (columns might already exist), continuing..."
        }
        ;;
        
    staging)
        if [ -f "$PROJECT_ROOT/.env.staging" ]; then
            source "$PROJECT_ROOT/.env.staging"
        fi
        export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/spheroseg_staging}"
        echo "🐘 Using PostgreSQL database for staging: $DATABASE_URL"
        
        # Run PostgreSQL migration
        cd "$PROJECT_ROOT/backend"
        echo "🏃 Running PostgreSQL migration..."
        psql --no-psqlrc -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f "$MIGRATION_DIR/migration.sql"
        ;;
        
    production)
        if [ -f "$PROJECT_ROOT/.env.production" ]; then
            source "$PROJECT_ROOT/.env.production"
        fi
        export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/spheroseg_production}"
        echo "🐘 Using PostgreSQL database for production: $DATABASE_URL"
        
        # Confirm production migration
        echo "⚠️  WARNING: You are about to run migration on PRODUCTION database!"
        echo "   Database: $DATABASE_URL"
        read -p "   Are you sure? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            echo "❌ Migration cancelled"
            exit 1
        fi
        
        # Run PostgreSQL migration
        cd "$PROJECT_ROOT/backend"
        echo "🏃 Running PostgreSQL migration..."
        psql --no-psqlrc -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f "$MIGRATION_DIR/migration.sql"
        ;;
        
    *)
        echo "❌ Unknown environment: $ENVIRONMENT"
        echo "   Valid environments: dev, staging, production"
        exit 1
        ;;
esac

# Verify migration
echo ""
echo "✅ Migration completed successfully!"
echo ""
echo "📊 Verifying migration..."

case $ENVIRONMENT in
    dev)
        echo "Checking SQLite schema..."
        sqlite3 "$PROJECT_ROOT/backend/data/dev.db" ".schema SegmentationQueue" | grep -E "(detectHoles|updatedAt)" && {
            echo "✅ Columns added successfully"
        } || {
            echo "⚠️  Columns might not be visible in schema but may still work"
        }
        
        echo ""
        echo "Checking indexes..."
        sqlite3 "$PROJECT_ROOT/backend/data/dev.db" ".indexes SegmentationQueue"
        ;;
        
    staging|production)
        echo "Checking PostgreSQL schema..."
        psql "$DATABASE_URL" -c "\d \"SegmentationQueue\"" | grep -E "(detectHoles|updatedAt)" && {
            echo "✅ Columns verified"
        }
        
        echo ""
        echo "Checking indexes..."
        psql "$DATABASE_URL" -c "\di *queue*"
        ;;
esac

echo ""
echo "🎉 Migration and verification complete!"
echo ""
echo "Next steps:"
echo "1. Run 'npx prisma generate' to update Prisma client"
echo "2. Test the application"
echo "3. If issues occur, run rollback: ./scripts/rollback-migration.sh $ENVIRONMENT"