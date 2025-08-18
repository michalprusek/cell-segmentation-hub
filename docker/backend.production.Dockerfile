# Use Node.js Alpine for smaller image
FROM node:20-alpine AS base

# Install OpenSSL and other dependencies
RUN apk add --no-cache \
    openssl \
    libc6-compat

FROM base AS deps

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    cairo-dev \
    pango-dev \
    pixman-dev

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies
RUN npm ci

# Generate Prisma client with correct binary target
RUN npx prisma generate

# Production stage
FROM base AS runner

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    dumb-init \
    curl \
    cairo \
    pango \
    pixman \
    python3 \
    make \
    g++

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy dependencies from deps stage
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/prisma ./prisma

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create necessary directories
RUN mkdir -p uploads logs data && \
    chown -R nodejs:nodejs /app

# Generate Prisma client again in production stage to ensure correct binary
RUN npx prisma generate

# Create startup script to handle database initialization
RUN printf '#!/bin/sh\n\
set -e\n\
\n\
echo "Waiting for database..."\n\
echo "DATABASE_URL: $DATABASE_URL"\n\
\n\
# Try to connect and show errors\n\
for i in 1 2 3 4 5; do\n\
  if npx prisma db push --skip-generate; then\n\
    echo "Database initialized successfully"\n\
    break\n\
  else\n\
    echo "Attempt $i failed. Waiting 3 seconds..."\n\
    sleep 3\n\
  fi\n\
done\n\
\n\
echo "Running migrations if needed..."\n\
npx prisma migrate deploy || true\n\
\n\
echo "Starting server..."\n\
exec npx tsx src/server.ts\n' > /app/start.sh && \
    chmod +x /app/start.sh

USER nodejs

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -fS http://localhost:3001/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

CMD ["/app/start.sh"]