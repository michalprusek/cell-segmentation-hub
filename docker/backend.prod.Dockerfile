FROM node:20-alpine

WORKDIR /app

# Install system dependencies including canvas build requirements
RUN apk add --no-cache \
    dumb-init \
    curl \
    python3 \
    make \
    g++ \
    pkgconfig \
    cairo-dev \
    pango-dev \
    pixman-dev \
    openssl \
    openssl-dev

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (needed for TypeScript)
RUN npm ci

# Generate Prisma client with correct binary
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node
RUN npx prisma generate

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p uploads logs data

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -fS http://localhost:3001/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start with tsx for TypeScript support
CMD ["npx", "tsx", "src/server.ts"]