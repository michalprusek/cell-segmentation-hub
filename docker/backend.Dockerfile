FROM node:20-alpine

WORKDIR /app

# Install system dependencies for Prisma and development
RUN apk add --no-cache \
    openssl \
    dumb-init \
    curl \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p uploads data && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:3001/health || exit 1

# Start script with proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "[ \"$PRISMA_DB_PUSH\" = \"true\" ] && npx prisma db push --accept-data-loss; npm run dev"]