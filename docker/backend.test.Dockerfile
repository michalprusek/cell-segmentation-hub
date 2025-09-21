# Test build for backend with all dependencies
FROM node:20-alpine AS test

# Install dependencies for bcrypt, canvas and other native modules
RUN apk add --no-cache dumb-init curl python3 make g++ \
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
COPY backend/tsconfig*.json ./

# Install ALL dependencies (including dev dependencies for tests)
RUN npm ci || npm install

# Copy Prisma schema and generate client
COPY backend/prisma ./prisma
RUN npx prisma generate

# Copy source code
COPY backend/src ./src

# Create necessary directories
RUN mkdir -p uploads logs data test-results coverage && \
    chown -R nodejs:nodejs /app

# Copy test configuration files (if they exist)
COPY backend/jest.config.js ./jest.config.js
COPY backend/jest.setup.js ./jest.setup.js
COPY backend/jest.integration.config.js ./jest.integration.config.js

USER nodejs

# Environment variables
ENV NODE_ENV=test
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Default command (can be overridden)
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "tsx", "src/server.ts"]