# Optimized multi-stage build for frontend with advanced caching
# Stage 1: Base dependencies
FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init

# Stage 2: Dependencies installer with cache mount
FROM base AS deps
WORKDIR /app

# Install build dependencies for canvas compilation
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev

# Copy only package files for better layer caching
COPY package*.json ./

# Use cache mount for npm packages to speed up builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund || npm install

# Stage 3: Builder with source code
FROM deps AS builder
WORKDIR /app

# Copy configs first (changes less frequently)
COPY tsconfig*.json vite.config.ts tailwind.config.ts postcss.config.js ./
COPY components.json ./

# Copy source code
COPY public ./public
COPY src ./src
COPY index.html ./

# Build arguments with defaults
ARG VITE_API_BASE_URL=/api
ARG VITE_ML_SERVICE_URL=/api/ml
ARG VITE_WS_URL=

# Build with optimizations
ENV NODE_ENV=production
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_ML_SERVICE_URL=${VITE_ML_SERVICE_URL}
ENV VITE_WS_URL=${VITE_WS_URL}

# Build application with cache mount for build artifacts
RUN --mount=type=cache,target=/app/.vite \
    npm run build

# Stage 4: Test environment
FROM deps AS test
WORKDIR /app

# Copy configs and source code
COPY tsconfig*.json vitest.config.ts vite.config.ts tailwind.config.ts postcss.config.js ./
COPY components.json ./
COPY public ./public
COPY src ./src
COPY index.html ./

# Set test environment
ENV NODE_ENV=test

# Default command for test stage
CMD ["npm", "run", "test"]

# Stage 5: Optimized production image
FROM nginx:alpine AS production

# Add labels for better image management
LABEL maintainer="Cell Segmentation Hub Team"
LABEL stage="production"
LABEL service="frontend"
LABEL build-date="${BUILD_DATE}"
LABEL version="${VERSION}"

# Install wget for health checks only
RUN apk add --no-cache wget

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Create nginx configuration file
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript 
               application/javascript application/json application/xml+rss 
               application/rss+xml application/atom+xml image/svg+xml 
               text/javascript application/x-javascript application/x-font-ttf 
               application/vnd.ms-fontobject font/opentype;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Static assets with aggressive caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
    
    # JSON and other data files
    location ~* \.(json|xml)$ {
        expires 1h;
        add_header Cache-Control "public, must-revalidate";
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
    
    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
EOF

# Create nginx cache directory
RUN mkdir -p /var/cache/nginx && \
    chown -R nginx:nginx /var/cache/nginx

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]