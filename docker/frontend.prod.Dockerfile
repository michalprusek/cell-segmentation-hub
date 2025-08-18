# Multi-stage build for optimized production image
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip scripts to avoid husky in production)
RUN npm ci --ignore-scripts

# Copy TypeScript config files
COPY tsconfig*.json ./

# Copy source code
COPY . .

# Create production tsconfig without test references
RUN echo '{ \
  "files": [], \
  "references": [ \
    { "path": "./tsconfig.app.json" }, \
    { "path": "./tsconfig.node.json" } \
  ], \
  "compilerOptions": { \
    "baseUrl": ".", \
    "paths": { \
      "@/*": ["./src/*"] \
    }, \
    "noImplicitAny": true, \
    "noUnusedParameters": false, \
    "skipLibCheck": true, \
    "allowJs": true, \
    "noUnusedLocals": false, \
    "strictNullChecks": true, \
    "noFallthroughCasesInSwitch": true, \
    "noImplicitReturns": true, \
    "noImplicitThis": true \
  } \
}' > tsconfig.json

# Build arguments for environment variables
ARG VITE_API_BASE_URL
ARG VITE_ML_SERVICE_URL

# Build the application
RUN NODE_ENV=production npm run build

# Production stage - serve with nginx
FROM nginx:alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration (from correct context)
COPY ./docker/nginx/frontend.nginx.conf /etc/nginx/conf.d/default.conf

# Create non-root user (handle existing nginx user)
RUN if ! getent group nginx >/dev/null 2>&1; then \
        addgroup -g 1001 -S nginx; \
    fi && \
    if ! getent passwd nginx >/dev/null 2>&1; then \
        adduser -S nginx -u 1001 -G nginx; \
    fi && \
    chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fS http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]