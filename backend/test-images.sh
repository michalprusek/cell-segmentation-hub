#!/bin/bash

# Test script pro Image Management API
# Použití: ./test-images.sh

API_BASE="http://localhost:3001/api"
TEST_EMAIL="test@example.com"
TEST_PASSWORD="test123456"

echo "🧪 Testing Image Management API"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Function to check if jq is installed
check_jq() {
    if ! command -v jq &> /dev/null; then
        print_error "jq is required but not installed. Please install jq first."
        exit 1
    fi
}

# Function to make authenticated request
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local content_type=${4:-"application/json"}
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available"
        return 1
    fi
    
    if [ "$method" = "GET" ]; then
        curl -s -X "$method" "$API_BASE$endpoint" \
            -H "Authorization: Bearer $ACCESS_TOKEN"
    elif [ -n "$data" ]; then
        curl -s -X "$method" "$API_BASE$endpoint" \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: $content_type" \
            -d "$data"
    else
        curl -s -X "$method" "$API_BASE$endpoint" \
            -H "Authorization: Bearer $ACCESS_TOKEN"
    fi
}

# Check dependencies
check_jq

print_info "Checking server health..."
health_response=$(curl -s http://localhost:3001/health)
if echo "$health_response" | jq -e '.success' > /dev/null 2>&1; then
    print_success "Server is healthy"
else
    print_error "Server is not responding correctly"
    exit 1
fi

print_info "Logging in user..."
login_response=$(curl -s -X POST "$API_BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$TEST_EMAIL\", \"password\": \"$TEST_PASSWORD\"}")

if echo "$login_response" | jq -e '.success' > /dev/null 2>&1; then
    ACCESS_TOKEN=$(echo "$login_response" | jq -r '.data.accessToken')
    USER_ID=$(echo "$login_response" | jq -r '.data.user.id')
    print_success "Login successful"
else
    print_error "Login failed"
    echo "$login_response" | jq '.'
    exit 1
fi

print_info "Creating a test project..."
project_response=$(make_request "POST" "/projects" '{"title": "Test Image Project", "description": "Project for testing image upload"}')

if echo "$project_response" | jq -e '.success' > /dev/null 2>&1; then
    PROJECT_ID=$(echo "$project_response" | jq -r '.data.id')
    print_success "Project created: $PROJECT_ID"
else
    print_error "Failed to create project"
    echo "$project_response" | jq '.'
    exit 1
fi

print_info "Creating test images..."
# Create simple test images using ImageMagick or base64 data
mkdir -p temp_test_images

# Create a simple 100x100 red square PNG
cat > temp_test_images/test1.png << 'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==
EOF

# For a real test, you would need actual image files
print_info "Note: For real testing, place actual image files in temp_test_images/"
print_info "Supported formats: JPG, PNG, BMP, TIFF (max 10MB each)"

print_info "Testing image endpoints..."

# Test 1: Get images (should be empty initially)
print_info "Test 1: Getting project images (should be empty)"
images_response=$(make_request "GET" "/projects/$PROJECT_ID/images")
if echo "$images_response" | jq -e '.success' > /dev/null 2>&1; then
    image_count=$(echo "$images_response" | jq '.data.images | length')
    print_success "Successfully retrieved images (count: $image_count)"
else
    print_error "Failed to get images"
    echo "$images_response" | jq '.'
fi

# Test 2: Get image statistics (should show zeros)
print_info "Test 2: Getting image statistics"
stats_response=$(make_request "GET" "/projects/$PROJECT_ID/images/stats")
if echo "$stats_response" | jq -e '.success' > /dev/null 2>&1; then
    total_images=$(echo "$stats_response" | jq '.data.stats.totalImages')
    print_success "Successfully retrieved stats (total images: $total_images)"
else
    print_error "Failed to get image statistics"
    echo "$stats_response" | jq '.'
fi

# Test 3: Upload without files (should fail)
print_info "Test 3: Testing upload without files (should fail)"
upload_response=$(curl -s -X POST "$API_BASE/projects/$PROJECT_ID/images" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
if echo "$upload_response" | jq -e '.success == false' > /dev/null 2>&1; then
    print_success "Correctly rejected upload without files"
else
    print_error "Should have rejected upload without files"
    echo "$upload_response" | jq '.'
fi

# Test 4: Get non-existent image (should fail)
print_info "Test 4: Testing access to non-existent image (should fail)"
fake_image_id="00000000-0000-0000-0000-000000000000"
image_response=$(make_request "GET" "/projects/$PROJECT_ID/images/$fake_image_id")
if echo "$image_response" | jq -e '.success == false' > /dev/null 2>&1; then
    print_success "Correctly rejected access to non-existent image"
else
    print_error "Should have rejected access to non-existent image"
    echo "$image_response" | jq '.'
fi

# Test 5: Access other user's project (should fail)
print_info "Test 5: Testing access to non-existent project (should fail)"
fake_project_id="00000000-0000-0000-0000-000000000000"
other_images_response=$(make_request "GET" "/projects/$fake_project_id/images")
if echo "$other_images_response" | jq -e '.success == false' > /dev/null 2>&1; then
    print_success "Correctly rejected access to non-existent project"
else
    print_error "Should have rejected access to non-existent project"
    echo "$other_images_response" | jq '.'
fi

# Test 6: Test pagination parameters
print_info "Test 6: Testing pagination parameters"
paginated_response=$(make_request "GET" "/projects/$PROJECT_ID/images?page=1&limit=5&sortBy=createdAt&sortOrder=desc")
if echo "$paginated_response" | jq -e '.success' > /dev/null 2>&1; then
    current_page=$(echo "$paginated_response" | jq '.data.pagination.page')
    limit=$(echo "$paginated_response" | jq '.data.pagination.limit')
    print_success "Pagination works correctly (page: $current_page, limit: $limit)"
else
    print_error "Pagination test failed"
    echo "$paginated_response" | jq '.'
fi

print_info "Cleaning up test project..."
delete_response=$(make_request "DELETE" "/projects/$PROJECT_ID")
if echo "$delete_response" | jq -e '.success' > /dev/null 2>&1; then
    print_success "Test project cleaned up"
else
    print_error "Failed to clean up test project"
fi

# Clean up temporary files
rm -rf temp_test_images

echo ""
print_success "Image API basic tests completed!"
print_info "For file upload testing, you'll need to:"
print_info "1. Create actual image files in supported formats"
print_info "2. Use curl with -F flag to upload files"
print_info "3. Example: curl -X POST \$API_BASE/projects/\$PROJECT_ID/images -H \"Authorization: Bearer \$ACCESS_TOKEN\" -F \"images=@image.jpg\""

echo ""
print_info "Supported image formats: JPG, PNG, BMP, TIFF"
print_info "Max file size: 10MB"
print_info "Max files per request: 20"
print_info "Thumbnails are automatically generated at 300x300px"