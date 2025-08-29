# Multi-stage build for production frontend
FROM node:20-alpine AS builder

# Install build dependencies for canvas
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

WORKDIR /app

# Copy package files and configs
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source code
COPY . .

# Build arguments for environment variables (no defaults!)
ARG VITE_API_BASE_URL
ARG VITE_API_URL
ARG VITE_ML_SERVICE_URL
ARG VITE_WS_URL

# Set environment variables for build
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL:-/api}
ENV VITE_API_URL=${VITE_API_URL:-/api}
ENV VITE_ML_SERVICE_URL=${VITE_ML_SERVICE_URL:-/api/ml}
ENV VITE_WS_URL=${VITE_WS_URL}

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Custom nginx configuration
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location /health { \
        access_log off; \
        return 200 "healthy\n"; \
        add_header Content-Type text/plain; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]