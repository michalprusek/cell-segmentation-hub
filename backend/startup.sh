#!/bin/sh

# Production startup script for backend
echo "Starting backend server..."
if [ -n "${DATABASE_URL}" ]; then
  echo "DATABASE_URL is set"
else
  echo "DATABASE_URL is not set"
fi

# Run database migrations automatically
echo "Running database migrations..."
if npx prisma migrate deploy; then
  echo "Database migrations completed successfully"
else
  echo "Error: Database migrations failed" >&2
  if [ "${FAIL_ON_MIGRATION_ERROR:-false}" = "true" ]; then
    echo "FAIL_ON_MIGRATION_ERROR is set, exiting..." >&2
    exit 1
  else
    echo "Warning: Continuing despite migration failure (set FAIL_ON_MIGRATION_ERROR=true to exit on failure)" >&2
  fi
fi

echo "Starting server..."
exec "$@"