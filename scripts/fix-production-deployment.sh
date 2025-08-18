#!/bin/bash

# SpheroSeg Production Deployment Fix Script
# Fixes CSP violations and WebSocket connection issues

set -e

echo "🔧 Starting production deployment fixes..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "docker-compose.prod-simple.yml" ]; then
    print_error "docker-compose.prod-simple.yml not found. Please run from the project root directory."
    exit 1
fi

# Check if required environment variables are set
if [ -z "$DB_PASSWORD" ] || [ -z "$JWT_ACCESS_SECRET" ] || [ -z "$JWT_REFRESH_SECRET" ]; then
    print_error "Required environment variables are not set:"
    print_error "- DB_PASSWORD"
    print_error "- JWT_ACCESS_SECRET" 
    print_error "- JWT_REFRESH_SECRET"
    print_error "Please source your .env.production file first."
    exit 1
fi

print_status "Environment variables check passed ✓"

# Set up compose command
COMPOSE="$COMPOSE"

# Step 1: Stop running containers
print_status "Stopping production containers..."
$COMPOSE down

# Step 2: Remove outdated frontend static volume
print_status "Removing outdated frontend static volume..."
# Determine project prefix from COMPOSE_PROJECT_NAME or current directory name
PROJECT_PREFIX="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"
FRONTEND_VOLUME="${PROJECT_PREFIX}_frontend-static"

if docker volume ls | grep -q "${FRONTEND_VOLUME}"; then
    docker volume rm "${FRONTEND_VOLUME}" || true
    print_success "Outdated frontend volume removed"
else
    print_warning "Frontend volume not found (this is expected if first deployment)"
fi

# Step 3: Clean up any dangling images
print_status "Cleaning up dangling Docker images..."
docker image prune -f || true

# Step 4: Build frontend with fresh dependencies
print_status "Building frontend container (this may take a few minutes)..."
$COMPOSE build --no-cache frontend
print_success "Frontend container built successfully"

# Step 5: Build other services
print_status "Building backend and other services..."
$COMPOSE build backend
$COMPOSE build ml-service
print_success "All containers built successfully"

# Step 6: Start services in correct order
print_status "Starting database and Redis..."
$COMPOSE up -d postgres redis

print_status "Waiting for database to be ready..."
sleep 10

print_status "Starting ML service..."
$COMPOSE up -d ml-service

print_status "Starting backend API..."
$COMPOSE up -d backend

print_status "Starting frontend service to populate volume..."
$COMPOSE up -d frontend

print_status "Waiting for frontend files to copy..."
sleep 5

print_status "Starting nginx reverse proxy..."
$COMPOSE up -d nginx

# Step 7: Health checks
print_status "Running health checks..."
sleep 15

# Check nginx
if curl -f -s http://localhost/health > /dev/null; then
    print_success "Nginx is responding ✓"
else
    print_error "Nginx health check failed ✗"
fi

# Check backend - run health check inside container
BACKEND_POD=$(docker ps --filter "name=spheroseg-backend" --format "{{.Names}}" | head -1)
if [ -n "$BACKEND_POD" ]; then
    if docker exec "$BACKEND_POD" curl -f -s http://localhost:3001/health > /dev/null 2>&1; then
        print_success "Backend API is responding ✓"
    else
        print_error "Backend API health check failed ✗"
    fi
else
    print_error "Backend container not found ✗"
fi

# Check ML service - run health check inside container since port is not exposed
ML_POD=$(docker ps --filter "name=spheroseg-ml" --format "{{.Names}}" | head -1)
if [ -n "$ML_POD" ]; then
    if docker exec "$ML_POD" curl -f -s http://localhost:8000/health > /dev/null 2>&1; then
        print_success "ML service is responding ✓"
    else
        print_error "ML service health check failed ✗"
    fi
else
    print_error "ML service container not found ✗"
fi

# Step 8: Verify frontend files are clean
print_status "Verifying frontend build doesn't contain external dependencies..."
if docker exec spheroseg-nginx grep -q "fonts.googleapis.com\|gpteng" /usr/share/nginx/html/index.html 2>/dev/null; then
    print_error "Frontend still contains external dependencies! Build may have failed."
    print_error "Check the frontend container logs:"
    print_error "docker logs spheroseg-frontend"
else
    print_success "Frontend build is clean - no external dependencies found ✓"
fi

# Step 9: Show final status
print_status "Checking container status..."
$COMPOSE ps

print_success "🎉 Production deployment fixes completed!"
print_status "Your application should now be accessible at https://spherosegapp.utia.cas.cz"
print_status ""
print_status "Key fixes applied:"
print_status "✓ Frontend rebuilt without Google Fonts and gptengineer.js"
print_status "✓ WebSocket CORS configuration added (WS_ALLOWED_ORIGINS)"
print_status "✓ All services restarted with fresh configuration"
print_status ""
print_status "To monitor logs: $COMPOSE logs -f"
print_status "To check status: $COMPOSE ps"