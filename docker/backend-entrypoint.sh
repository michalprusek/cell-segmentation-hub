#!/bin/bash

# Fix volume mount permissions
chown -R nodejs:nodejs /app/uploads /app/logs /app/data 2>/dev/null || true

# Switch to nodejs user and start the application
exec su nodejs -c "npx tsx src/server.ts"