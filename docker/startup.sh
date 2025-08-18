#!/bin/sh

# Production startup script for backend
# Runs database migrations before starting the server

echo "Starting backend server..."
if [ -n "${DATABASE_URL}" ]; then
  echo "DATABASE_URL is set"
else
  echo "DATABASE_URL is not set"
fi

# Wait for database to be ready
echo "Waiting for database to be ready..."

# Use wait-for-db.sh if available, otherwise basic connectivity check
if [ -f "/app/scripts/wait-for-db.sh" ]; then
  /app/scripts/wait-for-db.sh
else
  # Extract database connection details from DATABASE_URL
  if [ -n "${DATABASE_URL}" ]; then
    # Wait for PostgreSQL to be ready
    until pg_isready -h postgres -U spheroseg 2>/dev/null; do
      echo "Database not ready, waiting..."
      sleep 5
    done
  fi
fi

# Apply database migrations
echo "Applying database migrations..."
if [ "${NODE_ENV}" = "production" ] || [ -z "${FORCE_DB_PUSH}" ]; then
  # Production: use safe migration deploy
  npx prisma migrate deploy
else
  # Development/explicit override: allow db push
  echo "Using db push (FORCE_DB_PUSH is set or not in production)"
  npx prisma db push --accept-data-loss
fi

echo "Database is ready, starting server..."
exec "$@"