#!/bin/bash

# Database Backup Script for Cell Segmentation Hub
# Supports both PostgreSQL and SQLite databases

# pipefail is critical: without it, `pg_dump | gzip` masks pg_dump
# failures (e.g. wrong credentials, missing pg_dump binary) because
# gzip happily exits 0 on empty input and produces a 20-byte "valid"
# gzip header. The `-s` size check below would still pass, and we'd
# silently install a useless backup.
set -eo pipefail

# Configuration — env-overridable so the script works for both root
# (default `/backups/database` + `/var/log/backup.log`) and non-root
# users (e.g. systemd timer running as `cvat` writing under `~/spheroseg-backups`).
BACKUP_DIR="${BACKUP_DIR:-/backups/database}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="${LOG_FILE:-/var/log/backup.log}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Safe environment variable loading
load_env_file() {
    local env_file="$1"
    if [ -f "$env_file" ]; then
        while IFS='=' read -r key value; do
            # Skip empty lines and comments
            [[ -z "$key" || "$key" =~ ^#.*$ ]] && continue
            
            # Remove surrounding quotes from value
            value="${value#\"}"  # Remove leading quote
            value="${value%\"}"  # Remove trailing quote
            value="${value#\'}"  # Remove leading single quote
            value="${value%\'}"  # Remove trailing single quote
            
            # Export the variable
            export "$key=$value"
        done < "$env_file"
    fi
}

# Source environment variables
if [ -f ".env.production" ]; then
    load_env_file ".env.production"
elif [ -f ".env" ]; then
    load_env_file ".env"
fi

# Logging function — tolerate non-writable LOG_FILE (e.g. when running
# as a non-root systemd user that can't touch /var/log). Fall back to
# stderr only.
log() {
    echo -e "$1"
    if [ -w "$(dirname "$LOG_FILE")" ] 2>/dev/null; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE" 2>/dev/null || true
    fi
}

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

log "${GREEN}Starting database backup...${NC}"

# Determine database type and perform backup
if [ ! -z "$DATABASE_URL" ] && [[ "$DATABASE_URL" == postgres* ]]; then
    # PostgreSQL backup - Parse DATABASE_URL using Python for reliability
    if command -v python3 &>/dev/null; then
        # Use Python to parse the URL reliably
        eval $(python3 -c "
import urllib.parse
import sys
import os

try:
    url = os.environ.get('DATABASE_URL', '$DATABASE_URL')
    if not url or url == 'None':
        print('echo \"Error: DATABASE_URL is not set\" >&2', file=sys.stderr)
        sys.exit(1)
    
    parsed = urllib.parse.urlparse(url)
    
    # Validate required components
    if not parsed.scheme or not parsed.scheme.startswith('postgres'):
        print(f'echo \"Error: Invalid database scheme: {parsed.scheme}\" >&2', file=sys.stderr)
        sys.exit(1)
    
    if not parsed.username:
        print('echo \"Error: Database username is missing\" >&2', file=sys.stderr)
        sys.exit(1)
    
    if not parsed.hostname:
        print('echo \"Error: Database hostname is missing\" >&2', file=sys.stderr)
        sys.exit(1)
    
    if not parsed.path or parsed.path == '/':
        print('echo \"Error: Database name is missing\" >&2', file=sys.stderr)
        sys.exit(1)
    
    print(f'DB_USER={urllib.parse.unquote(parsed.username)}')
    print(f'POSTGRES_PASSWORD={urllib.parse.unquote(parsed.password or \"\")}')
    print(f'DB_HOST={parsed.hostname}')
    print(f'DB_PORT={parsed.port or 5432}')
    print(f'DB_NAME={parsed.path.lstrip(\"/\")}')
except Exception as e:
    print(f'echo \"Error parsing DATABASE_URL: {e}\" >&2', file=sys.stderr)
    sys.exit(1)
")
        if [ $? -ne 0 ]; then
            log "${RED}❌ Failed to parse DATABASE_URL${NC}"
            exit 1
        fi
    else
        # Fallback to sed parsing (less reliable with special characters)
        DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
        DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
        DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        DB_USER=$(echo $DATABASE_URL | sed -n 's/.*\/\/\([^:]*\):.*/\1/p')
    fi
    
    BACKUP_FILE="$BACKUP_DIR/postgres_${DB_NAME}_${TIMESTAMP}.sql.gz"
    
    log "${YELLOW}Backing up PostgreSQL database: $DB_NAME${NC}"
    
    # Create pgpass file for secure password handling with cleanup trap
    PGPASS_FILE=$(mktemp -t pgpass.XXXXXX)
    trap 'rm -f "$PGPASS_FILE"' EXIT INT TERM
    echo "$DB_HOST:$DB_PORT:$DB_NAME:$DB_USER:$POSTGRES_PASSWORD" > "$PGPASS_FILE"
    chmod 600 "$PGPASS_FILE"
    
    # Perform backup with compression
    PGPASSFILE="$PGPASS_FILE" pg_dump \
        -h $DB_HOST \
        -p $DB_PORT \
        -U $DB_USER \
        -d $DB_NAME \
        --no-owner \
        --no-acl \
        --clean \
        --if-exists \
        | gzip > $BACKUP_FILE
    
    # Remove temporary pgpass file
    rm -f "$PGPASS_FILE"
    
    # Verify backup. Minimum size check is critical — a 20-byte gzip
    # header on its own passes `-s` (size > 0) but is unusable. A real
    # spheroseg dump is megabytes; require at least 1 KiB so an empty
    # pg_dump (e.g. credential failure that pipefail somehow missed)
    # surfaces as a backup error rather than a silent zero-content file.
    MIN_BACKUP_BYTES=1024
    if [ -f "$BACKUP_FILE" ]; then
        BYTES=$(stat -c %s "$BACKUP_FILE" 2>/dev/null || stat -f %z "$BACKUP_FILE")
        if [ "$BYTES" -lt "$MIN_BACKUP_BYTES" ]; then
            log "${RED}❌ Backup is suspiciously small ($BYTES B < $MIN_BACKUP_BYTES B). Aborting.${NC}"
            rm -f "$BACKUP_FILE"
            exit 1
        fi
        SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        log "${GREEN}✅ PostgreSQL backup successful: $BACKUP_FILE (Size: $SIZE)${NC}"

        # Test restore capability (gzip integrity)
        if gunzip -t "$BACKUP_FILE"; then
            log "${GREEN}✅ Backup integrity verified${NC}"
        else
            log "${RED}❌ Backup integrity check failed${NC}"
            exit 1
        fi
    else
        log "${RED}❌ PostgreSQL backup failed${NC}"
        exit 1
    fi
    
elif [ -f "backend/prisma/data/dev.db" ]; then
    # SQLite backup
    DB_FILE="backend/prisma/data/dev.db"
    BACKUP_FILE="$BACKUP_DIR/sqlite_${TIMESTAMP}.db.gz"
    
    log "${YELLOW}Backing up SQLite database${NC}"
    
    # Create backup with integrity check
    sqlite3 $DB_FILE ".backup '$BACKUP_DIR/temp_backup.db'"
    
    # Verify backup
    sqlite3 $BACKUP_DIR/temp_backup.db "PRAGMA integrity_check"
    if [ $? -eq 0 ]; then
        gzip -c $BACKUP_DIR/temp_backup.db > $BACKUP_FILE
        rm $BACKUP_DIR/temp_backup.db
        
        SIZE=$(du -h $BACKUP_FILE | cut -f1)
        log "${GREEN}✅ SQLite backup successful: $BACKUP_FILE (Size: $SIZE)${NC}"
    else
        log "${RED}❌ SQLite backup integrity check failed${NC}"
        rm $BACKUP_DIR/temp_backup.db
        exit 1
    fi
else
    log "${RED}❌ No database found to backup${NC}"
    exit 1
fi

# Clean up old backups
log "${YELLOW}Cleaning up old backups (older than $RETENTION_DAYS days)${NC}"
# Validate RETENTION_DAYS contains only digits
if [[ ! $RETENTION_DAYS =~ ^[0-9]+$ ]]; then
    log "${RED}❌ RETENTION_DAYS must be a positive integer${NC}"
    exit 1
fi
# xargs -r is required: without it, an empty find result (no files
# older than RETENTION_DAYS, common on a fresh install) calls
# `rm --` with no arguments and rm errors with "missing operand".
find -- "$BACKUP_DIR" -type f -name "*.gz" -mtime +"$RETENTION_DAYS" -print0 \
    | xargs -0 -r rm --

# List recent backups
log "${GREEN}Recent backups:${NC}"
ls -lh $BACKUP_DIR/*.gz | tail -5

# Upload to S3 if configured
if [ ! -z "$AWS_ACCESS_KEY_ID" ] && [ ! -z "$S3_BACKUP_BUCKET" ]; then
    log "${YELLOW}Uploading backup to S3...${NC}"
    aws s3 cp $BACKUP_FILE s3://$S3_BACKUP_BUCKET/database/$(basename $BACKUP_FILE)
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ Backup uploaded to S3${NC}"
    else
        log "${RED}⚠️  S3 upload failed (backup saved locally)${NC}"
    fi
fi

log "${GREEN}✅ Database backup completed successfully${NC}"

# Send notification if webhook configured
if [ ! -z "$SLACK_WEBHOOK" ]; then
    curl -X POST $SLACK_WEBHOOK \
        -H 'Content-Type: application/json' \
        -d "{\"text\":\"✅ Database backup completed: $(basename $BACKUP_FILE) (Size: $SIZE)\"}" \
        2>/dev/null
fi

exit 0