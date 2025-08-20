# Production build for backend
FROM node:18-alpine AS builder

# Install dependencies for bcrypt and other native modules
RUN apk add --no-cache python3 make g++ curl dumb-init \
    cairo-dev jpeg-dev pango-dev giflib-dev librsvg-dev \
    pkgconfig pixman-dev

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.prod.json ./

# Install all dependencies
RUN npm ci

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY src ./src

# Build TypeScript with production config
RUN npx tsc -p tsconfig.prod.json

# Production stage
FROM node:18-alpine

# Install runtime dependencies including canvas dependencies  
RUN apk add --no-cache curl dumb-init python3 make g++ \
    cairo-dev jpeg-dev pango-dev giflib-dev librsvg-dev \
    pkgconfig pixman-dev openssl openssl-dev

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm install tsx

# Copy Prisma schema and generate client
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate

# Copy built application
COPY --from=builder /app/dist ./dist

# Create necessary directories
RUN mkdir -p uploads logs data && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start with signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "tsx", "dist/server.js"]