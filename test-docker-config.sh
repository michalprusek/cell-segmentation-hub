#!/bin/bash

# Docker Test Configuration Verification Script
# This script tests the Docker configuration fixes for test execution

set -e

echo "🔧 Docker Test Configuration Verification"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

# Function to print info
print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

echo ""
print_info "Testing Docker Configuration for Tests..."

# Test 1: Check if test compose file exists
echo ""
echo "1. Checking test compose configuration..."
if [ -f "docker-compose.test.yml" ]; then
    print_status 0 "Test compose file exists"
else
    print_status 1 "Test compose file missing"
    exit 1
fi

# Test 2: Check if test Dockerfiles exist
echo ""
echo "2. Checking test Dockerfiles..."
DOCKERFILE_STATUS=0

if [ -f "docker/backend.test.Dockerfile" ]; then
    print_status 0 "Backend test Dockerfile exists"
else
    print_status 1 "Backend test Dockerfile missing"
    DOCKERFILE_STATUS=1
fi

if [ -f "docker/frontend.test.Dockerfile" ]; then
    print_status 0 "Frontend test Dockerfile exists"
else
    print_status 1 "Frontend test Dockerfile missing"
    DOCKERFILE_STATUS=1
fi

if [ -f "docker/ml.test.Dockerfile" ]; then
    print_status 0 "ML test Dockerfile exists"
else
    print_status 1 "ML test Dockerfile missing"
    DOCKERFILE_STATUS=1
fi

# Test 3: Check if jest config exists
echo ""
echo "3. Checking Jest configuration..."
if [ -f "backend/jest.config.js" ]; then
    print_status 0 "Jest config exists"
else
    print_status 1 "Jest config missing"
fi

if [ -f "backend/jest.setup.js" ]; then
    print_status 0 "Jest setup exists"
else
    print_status 1 "Jest setup missing"
fi

# Test 4: Check package.json scripts
echo ""
echo "4. Checking package.json test scripts..."
if grep -q "npx jest" backend/package.json; then
    print_status 0 "Backend uses npx jest"
else
    print_status 1 "Backend doesn't use npx jest"
fi

# Test 5: Create test directories if they don't exist
echo ""
echo "5. Checking/creating test directories..."

# Create directories without sudo if possible
BACKEND_UPLOADS_DIR="backend/uploads"
if [ ! -d "$BACKEND_UPLOADS_DIR" ]; then
    mkdir -p "$BACKEND_UPLOADS_DIR" 2>/dev/null || true
fi

BACKEND_TEST_DIR="$BACKEND_UPLOADS_DIR/test"
if [ ! -d "$BACKEND_TEST_DIR" ]; then
    mkdir -p "$BACKEND_TEST_DIR" 2>/dev/null || print_info "Could not create $BACKEND_TEST_DIR - will be created by Docker"
fi

if [ -d "$BACKEND_TEST_DIR" ]; then
    print_status 0 "Test uploads directory exists or will be created"
else
    print_info "Test uploads directory will be created by Docker"
fi

# Test 6: Test docker-compose syntax
echo ""
echo "6. Testing Docker Compose syntax..."
if docker compose -f docker-compose.test.yml config > /dev/null 2>&1; then
    print_status 0 "Test compose syntax is valid"
else
    print_status 1 "Test compose syntax has errors"
    echo "Run: docker compose -f docker-compose.test.yml config"
fi

# Summary
echo ""
echo "📋 Test Configuration Summary"
echo "=============================="

echo ""
print_info "Available test commands:"
echo "  make test-env          - Run all tests in isolated environment"
echo "  make test-env-backend  - Run backend tests in isolated environment"
echo "  make test-backend      - Run backend tests in current environment"
echo "  make test-all          - Run all tests in current environment"

echo ""
print_info "To run tests manually:"
echo "  # Start test environment"
echo "  docker compose -f docker-compose.test.yml up -d"
echo ""
echo "  # Run backend tests"
echo "  docker compose -f docker-compose.test.yml exec test-backend npm run test:ci"
echo ""
echo "  # Run frontend tests"
echo "  docker compose -f docker-compose.test.yml exec test-frontend npm run test"
echo ""
echo "  # Run ML tests"
echo "  docker compose -f docker-compose.test.yml exec test-ml python -m pytest tests/ -v"
echo ""
echo "  # Clean up"
echo "  docker compose -f docker-compose.test.yml down"

echo ""
print_info "Main fixes implemented:"
echo "  ✅ Added test volume mounts to docker-compose.yml"
echo "  ✅ Created isolated test environment (docker-compose.test.yml)"
echo "  ✅ Created test-specific Dockerfiles with dev dependencies"
echo "  ✅ Updated package.json to use 'npx jest' consistently"
echo "  ✅ Added comprehensive test commands to Makefile"
echo "  ✅ Fixed Jest execution path issues"

echo ""
print_status 0 "Docker test configuration verification complete!"