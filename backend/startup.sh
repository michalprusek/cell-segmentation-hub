#!/bin/sh

# Production startup script for backend
echo "Starting backend server..."
if [ -n "${DATABASE_URL}" ]; then
  echo "DATABASE_URL is set"
else
  echo "DATABASE_URL is not set"
fi

echo "Starting server..."
exec "$@"