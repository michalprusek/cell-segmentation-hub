#!/bin/sh
set -e

echo "Waiting for database to be ready..."
until npx prisma db push --skip-generate; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Database initialized successfully"
exec "$@"