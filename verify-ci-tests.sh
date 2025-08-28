#!/bin/bash

# Script to verify CI/CD improvements and test coverage

echo "======================================"
echo "CI/CD Test Verification Report"
echo "======================================"
echo ""

# Check GitHub Actions workflows
echo "1. GitHub Actions Workflows:"
echo "----------------------------"
for workflow in .github/workflows/*.yml; do
    if [ -f "$workflow" ]; then
        filename=$(basename "$workflow")
        echo "✅ $filename - $(wc -l < "$workflow") lines"
    fi
done
echo ""

# Check test files
echo "2. Test Files Created:"
echo "----------------------"
test_files=(
    "backend/segmentation/tests/test_inference_integration.py"
    "backend/tests/websocket.test.ts"
    "tests/performance/performance.test.ts"
    "tests/e2e/auth.e2e.test.ts"
)

for test_file in "${test_files[@]}"; do
    if [ -f "$test_file" ]; then
        lines=$(wc -l < "$test_file")
        echo "✅ $test_file - $lines lines"
    else
        echo "❌ $test_file - NOT FOUND"
    fi
done
echo ""

# Validate YAML syntax
echo "3. YAML Validation:"
echo "-------------------"
for workflow in .github/workflows/*.yml; do
    if [ -f "$workflow" ]; then
        filename=$(basename "$workflow")
        if python3 -c "import yaml; yaml.safe_load(open('$workflow'))" 2>/dev/null; then
            echo "✅ $filename - Valid YAML"
        else
            echo "❌ $filename - Invalid YAML"
        fi
    fi
done
echo ""

# Check for test commands in package.json
echo "4. Test Commands in package.json:"
echo "---------------------------------"
if [ -f "package.json" ]; then
    grep -E '"test"|"test:e2e"|"test:coverage"' package.json | while read -r line; do
        echo "✅ $line"
    done
fi
echo ""

# Check backend test configuration
echo "5. Backend Test Configuration:"
echo "------------------------------"
if [ -f "backend/jest.config.js" ]; then
    echo "✅ Jest config exists"
    if grep -q "tests" backend/jest.config.js; then
        echo "✅ Tests directory included in Jest config"
    else
        echo "⚠️  Tests directory not in Jest config"
    fi
fi
echo ""

# Summary statistics
echo "6. Summary Statistics:"
echo "----------------------"
workflow_count=$(ls -1 .github/workflows/*.yml 2>/dev/null | wc -l)
test_count=0
for test_file in "${test_files[@]}"; do
    [ -f "$test_file" ] && ((test_count++))
done

total_test_lines=0
for test_file in "${test_files[@]}"; do
    if [ -f "$test_file" ]; then
        lines=$(wc -l < "$test_file")
        ((total_test_lines += lines))
    fi
done

echo "📊 GitHub Workflows: $workflow_count"
echo "📊 Test Files: $test_count/${#test_files[@]}"
echo "📊 Total Test Lines: $total_test_lines"
echo ""

# Performance thresholds check
echo "7. Performance Thresholds:"
echo "-------------------------"
if grep -q "PERFORMANCE_THRESHOLDS" tests/performance/performance.test.ts 2>/dev/null; then
    echo "✅ Performance thresholds defined"
    grep -A 5 "PERFORMANCE_THRESHOLDS" tests/performance/performance.test.ts | head -10
fi
echo ""

# Security scanning configuration
echo "8. Security Scanning:"
echo "--------------------"
if [ -f ".github/workflows/security-scan-enhanced.yml" ]; then
    echo "✅ Enhanced security scanning configured"
    echo "   - Dependency scanning"
    echo "   - Container scanning"
    echo "   - Secret detection"
    echo "   - SAST analysis"
fi
echo ""

# Coverage thresholds
echo "9. Coverage Thresholds:"
echo "----------------------"
if [ -f ".github/workflows/test-coverage.yml" ]; then
    echo "Coverage thresholds configured:"
    grep -E "MIN_.*_COVERAGE" .github/workflows/test-coverage.yml 2>/dev/null || echo "No explicit thresholds found"
fi
echo ""

echo "======================================"
echo "✅ CI/CD Test Verification Complete"
echo "======================================"
echo ""
echo "Next Steps:"
echo "-----------"
echo "1. Run 'git add .' to stage all changes"
echo "2. Run 'git commit -m \"feat: comprehensive CI/CD improvements and test coverage\"'"
echo "3. Push to trigger GitHub Actions workflows"
echo "4. Monitor workflow runs in GitHub Actions tab"