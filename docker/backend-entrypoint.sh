#!/bin/bash

# Enable strict shell options
set -euo pipefail

# Create target directories before chown
mkdir -p /app/uploads /app/logs /app/data

# Fix volume mount permissions
chown -R nodejs:nodejs /app/uploads /app/logs /app/data 2>/dev/null || true

# Switch to nodejs user and start the application with preserved environment
exec su -m -s /bin/sh nodejs -c "exec ./node_modules/.bin/tsx src/server.ts"