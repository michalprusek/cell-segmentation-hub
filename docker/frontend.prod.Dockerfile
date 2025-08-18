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
ARG VITE_WS_URL

# Build the application with environment variables
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_ML_SERVICE_URL=${VITE_ML_SERVICE_URL}  
ENV VITE_WS_URL=${VITE_WS_URL}
RUN NODE_ENV=production npm run build

# Copy built assets to volume and keep container running
FROM alpine:latest

# Install bash for script
RUN apk add --no-cache bash

# Copy built assets from builder
COPY --from=builder /app/dist /dist

# Create a script to copy files and keep running
RUN printf '#!/bin/bash\ncp -r /dist/* /app/dist/ 2>/dev/null || true\necho "Frontend files copied to volume"\nsleep infinity\n' > /copy.sh && \
    chmod +x /copy.sh

CMD ["/bin/bash", "/copy.sh"]