# Production build for backend
FROM node:18-alpine AS builder

# Install dependencies for bcrypt and other native modules
RUN apk add --no-cache python3 make g++ curl dumb-init \
    cairo-dev jpeg-dev pango-dev giflib-dev librsvg-dev \
    pkgconfig pixman-dev

WORKDIR /app

# Copy package files
COPY backend/package*.json ./
COPY backend/tsconfig.json ./
COPY backend/tsconfig.prod.json ./

# Install all dependencies
RUN npm install --frozen-lockfile || npm install

# Copy Prisma schema
COPY backend/prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY backend/src ./src

# Skip TypeScript build - use tsx for runtime transpilation

# Production stage
FROM node:18-alpine

# Install runtime dependencies including canvas dependencies and fonts
RUN apk add --no-cache curl dumb-init python3 make g++ \
    cairo-dev jpeg-dev pango-dev giflib-dev librsvg-dev \
    pkgconfig pixman-dev openssl openssl-dev \
    ttf-dejavu ttf-liberation ttf-freefont \
    fontconfig font-noto font-noto-emoji \
    && fc-cache -fv

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy package files
COPY backend/package*.json ./
COPY --from=builder /app/tsconfig.json ./

# Install production dependencies only
RUN npm install --omit=dev && npm install tsx

# Copy Prisma schema and generate client
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate

# Copy source code (no build step)
COPY --from=builder /app/src ./src

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
CMD ["npx", "tsx", "src/server.ts"]