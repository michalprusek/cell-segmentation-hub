#!/bin/bash

# Initialize green database
echo "Initializing green database..."

# Create database if it doesn't exist
docker exec postgres-green psql -U spheroseg -c "CREATE DATABASE spheroseg_green;" 2>/dev/null || echo "Database already exists"

# Run Prisma migrations
cd /home/cvat/cell-segmentation-hub/backend

# Export environment for Prisma
export DATABASE_URL="postgresql://spheroseg:spheroseg_green_2024@localhost:5433/spheroseg_green?schema=public"

# Temporarily expose postgres port
docker run -d --rm --name temp-postgres-tunnel --network cell-segmentation-hub_green-network -p 5433:5432 alpine/socat TCP-LISTEN:5432,fork TCP-CONNECT:postgres-green:5432

sleep 2

# Run migrations
npx prisma migrate deploy || echo "Migration failed, trying db push..."
npx prisma db push || echo "DB push failed"

# Stop tunnel
docker stop temp-postgres-tunnel 2>/dev/null

echo "Database initialization complete"