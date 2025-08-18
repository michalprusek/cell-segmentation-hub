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
  echo "Warning: Database migrations failed, continuing anyway..."
fi

echo "Starting server..."
exec "$@"