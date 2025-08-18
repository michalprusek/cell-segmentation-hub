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
    # Extract connection info from DATABASE_URL
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
    DB_USER=$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
    # Wait for PostgreSQL to be ready with timeout
    DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-300}"  # Default 5 minutes
    start_time=$(date +%s)
    until pg_isready -h "${DB_HOST:-postgres}" -U "${DB_USER:-spheroseg}" 2>/dev/null; do
      current_time=$(date +%s)
      elapsed=$((current_time - start_time))
      
      if [ $elapsed -ge $DB_WAIT_TIMEOUT ]; then
        echo "Error: Database not ready after ${DB_WAIT_TIMEOUT} seconds, giving up" >&2
        exit 1
      fi
      
      echo "Database not ready, waiting... (${elapsed}/${DB_WAIT_TIMEOUT}s)"
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