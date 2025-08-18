FROM node:20-slim

WORKDIR /app

# Install system dependencies for Prisma, Canvas and PostgreSQL
RUN apt-get update && apt-get install -y \
    openssl \
    libssl-dev \
    ca-certificates \
    python3 \
    make \
    g++ \
    pkg-config \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    postgresql-client \
    netcat-openbsd \
    curl \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Copy entrypoint script and make it executable
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create necessary directories
RUN mkdir -p uploads logs data

# Create non-root user
RUN groupadd -r nodejs && \
    useradd -r -g nodejs nodejs && \
    chown -R nodejs:nodejs /app

# Don't switch to nodejs user yet - we'll handle permissions in startup script

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -fS http://localhost:3001/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Use custom entrypoint
CMD ["/entrypoint.sh"]