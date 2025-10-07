# Optimized multi-stage build for backend with advanced caching
# Stage 1: Base runtime dependencies
FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init curl openssl

# Stage 2: Build dependencies
FROM base AS build-deps
RUN apk add --no-cache python3 make g++ \
    cairo-dev jpeg-dev pango-dev giflib-dev librsvg-dev \
    pkgconfig pixman-dev

# Stage 3: Dependencies installer with cache
FROM build-deps AS deps
WORKDIR /app

# Copy package files only for better caching
COPY backend/package*.json ./
COPY backend/tsconfig*.json ./

# Install dependencies with cache mount
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit || npm install

# Copy Prisma schema and generate client
COPY backend/prisma ./prisma
RUN npx prisma generate

# Stage 4: Builder with TypeScript compilation
FROM deps AS builder
WORKDIR /app

# Copy source code
COPY backend/src ./src

# Build TypeScript (optional - can use tsx in runtime)
RUN npx tsc --project tsconfig.prod.json || true

# Stage 5: Optimized production image
FROM base AS production

# Add runtime dependencies and fonts
RUN apk add --no-cache \
    cairo pango jpeg giflib librsvg \
    ttf-dejavu ttf-liberation ttf-freefont \
    fontconfig font-noto font-noto-emoji \
    && fc-cache -fv

# Add build dependencies temporarily for canvas compilation
RUN apk add --no-cache --virtual .build-deps \
    python3 make g++ \
    cairo-dev jpeg-dev pango-dev giflib-dev librsvg-dev \
    pkgconfig pixman-dev

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy package files and install production dependencies only
COPY backend/package*.json ./

# Install production deps with cache mount (without dev deps but with scripts for canvas)
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --prefer-offline --no-audit || \
    npm install --omit=dev

# Remove build dependencies after canvas compilation
RUN apk del .build-deps

# Install tsx for runtime TypeScript execution
RUN npm install tsx

# Copy Prisma files and generate client
COPY --from=deps /app/prisma ./prisma
RUN npx prisma generate

# Copy source code
COPY --from=builder /app/src ./src
COPY tsconfig*.json ./

# Create necessary directories with correct permissions
RUN mkdir -p uploads logs data && \
    chown -R nodejs:nodejs /app

# Add labels for image management
LABEL maintainer="Cell Segmentation Hub Team"
LABEL stage="production"
LABEL service="backend"
LABEL build-date="${BUILD_DATE}"
LABEL version="${VERSION}"

# Switch to non-root user
USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start with signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "tsx", "src/server.ts"]