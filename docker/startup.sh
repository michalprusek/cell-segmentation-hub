#!/bin/sh

# Production startup script for backend
# Runs database migrations before starting the server

echo "Starting backend server..."
echo "DATABASE_URL: ${DATABASE_URL}"

# Wait for database to be ready
echo "Waiting for database to be ready..."
until npx prisma db push --accept-data-loss; do
  echo "Database not ready, waiting..."
  sleep 5
done

echo "Database is ready, starting server..."
exec "$@"