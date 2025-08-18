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
    # Parse PostgreSQL URL: postgresql://user:pass@host:port/dbname
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:\/]*\).*/\1/p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
    DB_USER=$(echo "$DATABASE_URL" | sed -n 's/.*\/\/\([^:]*\).*/\1/p')
    
    # Default values if parsing fails
    DB_HOST=${DB_HOST:-localhost}
    DB_PORT=${DB_PORT:-5432}
    
    # Wait for PostgreSQL to accept connections
    until pg_isready -h "$DB_HOST" -p "$DB_PORT" 2>/dev/null; do
      echo "Database is unavailable - sleeping"
      sleep 2
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