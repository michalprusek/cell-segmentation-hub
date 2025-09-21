# Test build for frontend with all dependencies
FROM node:20-alpine AS test-base

# Install dependencies for canvas compilation
RUN apk add --no-cache dumb-init python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies for tests)
RUN npm ci || npm install

# Copy configuration files
COPY tsconfig*.json vite.config.ts vitest.config.ts tailwind.config.ts postcss.config.js ./
COPY components.json ./
COPY playwright.config.ts ./

# Copy source code
COPY public ./public
COPY src ./src
COPY index.html ./

# Set test environment
ENV NODE_ENV=test

# Create test results directory
RUN mkdir -p test-results coverage

# Expose port for test server
EXPOSE 5173

# Default command (can be overridden)
CMD ["npm", "run", "test"]