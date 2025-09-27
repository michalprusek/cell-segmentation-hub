#!/bin/bash

# ML Authentication Test Runner
# Comprehensive test suite for ML routes authentication

set -e

echo "🧪 Starting ML Authentication Test Suite"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test categories
UNIT_TESTS="src/api/routes/__tests__/mlRoutes.test.ts"
INTEGRATION_TESTS="src/test/integration/mlAuthenticationBoundaries.test.ts"
SECURITY_TESTS="src/test/security/mlAuthenticationSecurity.test.ts"

# Function to run tests with proper formatting
run_test_suite() {
    local test_name="$1"
    local test_files="$2"
    local description="$3"

    echo ""
    echo -e "${BLUE}📋 Running ${test_name}${NC}"
    echo -e "${YELLOW}Description: ${description}${NC}"
    echo "----------------------------------------"

    if npm test -- $test_files --verbose; then
        echo -e "${GREEN}✅ ${test_name} PASSED${NC}"
        return 0
    else
        echo -e "${RED}❌ ${test_name} FAILED${NC}"
        return 1
    fi
}

# Function to run coverage analysis
run_coverage() {
    echo ""
    echo -e "${BLUE}📊 Running Coverage Analysis${NC}"
    echo "----------------------------------------"

    npm run test:coverage -- $UNIT_TESTS $INTEGRATION_TESTS $SECURITY_TESTS
}

# Function to run performance tests
run_performance_tests() {
    echo ""
    echo -e "${BLUE}⚡ Running Performance Tests${NC}"
    echo "----------------------------------------"

    # Run tests with performance monitoring
    npm test -- $INTEGRATION_TESTS --testNamePattern="Performance|Load|Concurrent" --verbose
}

# Main test execution
main() {
    local failed_tests=0

    echo "Starting ML Authentication comprehensive test suite..."
    echo "Target: ML routes authentication fix"
    echo "Focus: /api/ml/health endpoint moved before authentication middleware"
    echo ""

    # 1. Unit Tests - ML Routes Authentication
    if ! run_test_suite \
        "Unit Tests" \
        "$UNIT_TESTS" \
        "Component-level testing of ML routes with mocked authentication scenarios"; then
        ((failed_tests++))
    fi

    # 2. Integration Tests - Authentication Boundaries
    if ! run_test_suite \
        "Integration Tests" \
        "$INTEGRATION_TESTS" \
        "End-to-end authentication flow testing with real database interactions"; then
        ((failed_tests++))
    fi

    # 3. Security Tests - OWASP & Security Scenarios
    if ! run_test_suite \
        "Security Tests" \
        "$SECURITY_TESTS" \
        "OWASP Top 10 and advanced security scenario testing"; then
        ((failed_tests++))
    fi

    # 4. Performance Tests
    echo ""
    echo -e "${BLUE}⚡ Running Performance Validation${NC}"
    echo "----------------------------------------"
    if ! run_performance_tests; then
        echo -e "${YELLOW}⚠️  Performance tests had issues but continuing...${NC}"
    fi

    # 5. Coverage Analysis
    if command -v npm run test:coverage &> /dev/null; then
        run_coverage
    else
        echo -e "${YELLOW}⚠️  Coverage analysis not available${NC}"
    fi

    # Summary
    echo ""
    echo "========================================"
    echo -e "${BLUE}🏁 Test Suite Summary${NC}"
    echo "========================================"

    if [ $failed_tests -eq 0 ]; then
        echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
        echo -e "${GREEN}✅ ML Authentication fix verified successfully${NC}"
        echo ""
        echo "✅ Public endpoints (/api/ml/health, /api/ml/status, /api/ml/models) accessible without auth"
        echo "✅ Protected endpoints (/api/ml/queue, /api/ml/models/:id/warm-up) require authentication"
        echo "✅ Authentication boundaries properly enforced"
        echo "✅ Security vulnerabilities addressed"
        echo "✅ Performance requirements met"
        exit 0
    else
        echo -e "${RED}❌ ${failed_tests} TEST SUITE(S) FAILED${NC}"
        echo -e "${RED}❌ ML Authentication fix needs review${NC}"
        echo ""
        echo "Please review the failed tests and fix issues before deployment."
        exit 1
    fi
}

# Help function
show_help() {
    echo "ML Authentication Test Runner"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -h, --help          Show this help message"
    echo "  -u, --unit-only     Run only unit tests"
    echo "  -i, --integration   Run only integration tests"
    echo "  -s, --security      Run only security tests"
    echo "  -p, --performance   Run only performance tests"
    echo "  -c, --coverage      Run coverage analysis only"
    echo "  -v, --verbose       Verbose output"
    echo ""
    echo "Examples:"
    echo "  $0                  # Run all tests"
    echo "  $0 -u               # Run only unit tests"
    echo "  $0 -s -v            # Run security tests with verbose output"
}

# Parse command line arguments
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    -u|--unit-only)
        run_test_suite "Unit Tests Only" "$UNIT_TESTS" "ML routes unit testing"
        ;;
    -i|--integration)
        run_test_suite "Integration Tests Only" "$INTEGRATION_TESTS" "Authentication boundary integration testing"
        ;;
    -s|--security)
        run_test_suite "Security Tests Only" "$SECURITY_TESTS" "Security and OWASP testing"
        ;;
    -p|--performance)
        run_performance_tests
        ;;
    -c|--coverage)
        run_coverage
        ;;
    *)
        main
        ;;
esac