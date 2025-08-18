#!/bin/sh
set -e

echo "Waiting for database to be ready..."

# Use wait-for-db.sh if available
if [ -f "/app/scripts/wait-for-db.sh" ]; then
  /app/scripts/wait-for-db.sh
elif [ -f "./scripts/wait-for-db.sh" ]; then
  ./scripts/wait-for-db.sh
else
  # Extract database details from DATABASE_URL if set
  if [ -n "${DATABASE_URL}" ]; then
    # Parse PostgreSQL URL using Python for robust URL parsing
    DB_INFO=$(python3 -c "
import urllib.parse
import sys
try:
    url = urllib.parse.urlparse('$DATABASE_URL')
    print(f'{url.hostname}')
    print(f'{url.port or 5432}')
    print(f'{url.username}')
except Exception:
    print('localhost')
    print('5432')
    print('postgres')
" 2>/dev/null)
    
    if [ -n "$DB_INFO" ]; then
        DB_HOST=$(echo "$DB_INFO" | sed -n '1p')
        DB_PORT=$(echo "$DB_INFO" | sed -n '2p')
        DB_USER=$(echo "$DB_INFO" | sed -n '3p')
    fi
    
    # Default values if parsing fails
    DB_HOST=${DB_HOST:-localhost}
    DB_PORT=${DB_PORT:-5432}
    
    # Wait for PostgreSQL to accept connections with timeout
    DB_WAIT_TIMEOUT=${DB_WAIT_TIMEOUT:-60}
    elapsed=0
    interval=2
    
    echo "Waiting for database at $DB_HOST:$DB_PORT (timeout: ${DB_WAIT_TIMEOUT}s)..."
    while ! pg_isready -h "$DB_HOST" -p "$DB_PORT" 2>/dev/null; do
      if [ $elapsed -ge $DB_WAIT_TIMEOUT ]; then
        echo "ERROR: Database connection timeout after ${DB_WAIT_TIMEOUT} seconds"
        exit 1
      fi
      echo "Database is unavailable - sleeping ($elapsed/${DB_WAIT_TIMEOUT}s elapsed)"
      sleep $interval
      elapsed=$((elapsed + interval))
    done
  else
    echo "DATABASE_URL not set, cannot check database connectivity"
  fi
fi

echo "Database is ready, applying migrations..."

# Apply database migrations based on environment
if [ "${NODE_ENV}" = "production" ] && [ -z "${FORCE_DB_PUSH}" ]; then
  # Production: use safe migration deploy
  echo "Running production migrations..."
  npx prisma migrate deploy
elif [ -n "${FORCE_DB_PUSH}" ] || [ "${NODE_ENV}" != "production" ]; then
  # Development or explicit override: allow db push
  echo "Using db push (development mode or FORCE_DB_PUSH is set)"
  npx prisma db push --skip-generate
else
  # Default to safe migration
  echo "Running migrations..."
  npx prisma migrate deploy
fi

echo "Database initialized successfully"
exec "$@"