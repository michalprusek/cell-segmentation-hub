#!/bin/bash

# Test Runner for Polygon Selection and Interaction Tests
# Runs all polygon-related tests with proper Docker configuration

set -e

echo "🧪 Running Polygon Selection and Interaction Tests"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to run tests with error handling
run_test() {
    local test_file=$1
    local test_name=$2

    echo -e "\n${BLUE}🔍 Running: ${test_name}${NC}"
    echo "----------------------------------------"

    if docker exec spheroseg-frontend npm test -- --run "${test_file}"; then
        echo -e "${GREEN}✅ ${test_name} PASSED${NC}"
        return 0
    else
        echo -e "${RED}❌ ${test_name} FAILED${NC}"
        return 1
    fi
}

# Check if containers are running
echo -e "${BLUE}🔍 Checking Docker containers...${NC}"
if ! docker ps | grep -q spheroseg-frontend; then
    echo -e "${RED}❌ Frontend container not running. Please start with 'make up'${NC}"
    exit 1
fi

# Initialize counters
total_tests=0
passed_tests=0
failed_tests=0
failed_test_names=()

echo -e "\n${YELLOW}📋 Test Suite: Polygon Selection and Interaction Fixes${NC}"
echo "Testing specific issues reported:"
echo "  • Mass selection bug (clicking one polygon selects all)"
echo "  • Mode switching bug (slice/delete modes not staying active)"
echo "  • Hole rendering (internal polygons should be blue, external red)"
echo "  • Event handling conflicts (vertex vs polygon interactions)"

echo -e "\n${BLUE}🚀 Starting test execution...${NC}"

# Test 1: Polygon Selection Tests
total_tests=$((total_tests + 1))
if run_test "src/pages/segmentation/__tests__/PolygonSelection.test.tsx" "Polygon Selection Bug Prevention"; then
    passed_tests=$((passed_tests + 1))
else
    failed_tests=$((failed_tests + 1))
    failed_test_names+=("Polygon Selection Bug Prevention")
fi

# Test 2: Mode Handling Tests
total_tests=$((total_tests + 1))
if run_test "src/pages/segmentation/__tests__/ModeHandling.test.tsx" "Mode Switching Behavior"; then
    passed_tests=$((passed_tests + 1))
else
    failed_tests=$((failed_tests + 1))
    failed_test_names+=("Mode Switching Behavior")
fi

# Test 3: Hole Rendering Tests
total_tests=$((total_tests + 1))
if run_test "src/pages/segmentation/__tests__/HoleRendering.test.tsx" "Hole Rendering Validation"; then
    passed_tests=$((passed_tests + 1))
else
    failed_tests=$((failed_tests + 1))
    failed_test_names+=("Hole Rendering Validation")
fi

# Test 4: Event Handling Tests
total_tests=$((total_tests + 1))
if run_test "src/pages/segmentation/__tests__/EventHandling.test.tsx" "Event Handling Conflict Resolution"; then
    passed_tests=$((passed_tests + 1))
else
    failed_tests=$((failed_tests + 1))
    failed_test_names+=("Event Handling Conflict Resolution")
fi

# Test 5: Integration Tests
total_tests=$((total_tests + 1))
if run_test "src/pages/segmentation/__tests__/PolygonInteractionIntegration.test.tsx" "Integration and Performance"; then
    passed_tests=$((passed_tests + 1))
else
    failed_tests=$((failed_tests + 1))
    failed_test_names+=("Integration and Performance")
fi

# Summary Report
echo -e "\n\n${YELLOW}📊 TEST SUMMARY REPORT${NC}"
echo "=================================================="
echo -e "Total Tests:   ${BLUE}${total_tests}${NC}"
echo -e "Passed:        ${GREEN}${passed_tests}${NC}"
echo -e "Failed:        ${RED}${failed_tests}${NC}"

if [ $failed_tests -eq 0 ]; then
    echo -e "\n${GREEN}🎉 ALL TESTS PASSED! 🎉${NC}"
    echo -e "${GREEN}✅ Polygon selection and interaction fixes are working correctly${NC}"
    echo ""
    echo "✅ Mass selection bug: FIXED"
    echo "✅ Mode switching bug: FIXED"
    echo "✅ Hole rendering: VALIDATED"
    echo "✅ Event handling conflicts: RESOLVED"
    echo "✅ Integration workflows: WORKING"
    echo "✅ Performance: ACCEPTABLE"
else
    echo -e "\n${RED}❌ SOME TESTS FAILED${NC}"
    echo -e "${RED}Failed test suites:${NC}"
    for test_name in "${failed_test_names[@]}"; do
        echo -e "  • ${RED}${test_name}${NC}"
    done
    echo ""
    echo -e "${YELLOW}🔧 Next steps:${NC}"
    echo "1. Review failed test output above"
    echo "2. Check test mocks and setup"
    echo "3. Verify component implementations match test expectations"
    echo "4. Run individual tests for detailed debugging:"
    echo "   docker exec spheroseg-frontend npm test -- --run <test-file>"
fi

echo -e "\n${BLUE}📝 Additional Test Commands:${NC}"
echo "Run all segmentation tests:"
echo "  docker exec spheroseg-frontend npm test -- --run src/pages/segmentation/"
echo ""
echo "Run specific test with coverage:"
echo "  docker exec spheroseg-frontend npm test -- --coverage --run src/pages/segmentation/__tests__/PolygonSelection.test.tsx"
echo ""
echo "Run tests in watch mode:"
echo "  docker exec spheroseg-frontend npm test -- --watch src/pages/segmentation/"

exit $failed_tests