#!/bin/sh

# PostgreSQL Migration Entrypoint
# Automatically runs database migrations on container startup

set -e

echo "Starting backend service with PostgreSQL..."

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
while ! nc -z postgres 5432; do
  sleep 1
done
echo "PostgreSQL is ready!"

# Run Prisma migrations
echo "Running database migrations..."
npx prisma migrate deploy

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Start the application
echo "Starting Node.js application..."
exec "$@"