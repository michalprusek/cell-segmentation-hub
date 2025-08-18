# Multi-stage build - pouze build a kopírování
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with ignore-scripts to avoid husky issues
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build arguments for environment variables
ARG VITE_API_BASE_URL
ARG VITE_ML_SERVICE_URL

# Build the application
RUN npm run build

# Copy public fonts to dist
RUN cp -r public/fonts dist/ 2>/dev/null || true

# Final stage - just copy files
FROM alpine:latest

# Install bash for script
RUN apk add --no-cache bash

# Copy built assets from builder
COPY --from=builder /app/dist /dist

# Create a script to copy files and keep running
RUN printf '#!/bin/bash\ncp -r /dist/* /app/dist/ 2>/dev/null || true\necho "Frontend files copied to volume"\nsleep infinity\n' > /copy.sh && \
    chmod +x /copy.sh

CMD ["/bin/bash", "/copy.sh"]