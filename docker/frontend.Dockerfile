FROM node:20-alpine

WORKDIR /app

# Install dumb-init, curl for health check, and build dependencies for canvas
RUN apk add --no-cache dumb-init curl python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev

# Copy package files
COPY package*.json ./

# Install dependencies (clean install to ensure all deps are included)
RUN npm ci || npm install

# Copy application files
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose port
EXPOSE 5173

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fS http://0.0.0.0:5173/ || exit 1

# Start development server with proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]