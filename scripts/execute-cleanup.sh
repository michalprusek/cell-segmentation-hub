#!/bin/bash
# Cell Segmentation Hub - Automated Cleanup Script
# Run from project root: ./scripts/execute-cleanup.sh

set -e

PROJECT_ROOT="/home/cvat/cell-segmentation-hub"
BACKUP_DIR="/tmp/cleanup-backup-$(date +%Y%m%d-%H%M%S)"
DRY_RUN=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--dry-run]"
            exit 1
            ;;
    esac
done

echo "==================================="
echo "Cell Segmentation Hub - Cleanup"
echo "==================================="
echo ""

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}DRY RUN MODE - No files will be deleted${NC}"
    echo ""
fi

# Change to project root
cd "$PROJECT_ROOT" || exit 1

# Check we're in the right directory
if [ ! -f "CLAUDE.md" ]; then
    echo -e "${RED}Error: Not in project root directory${NC}"
    exit 1
fi

# Create backup directory
echo "Creating backup directory: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# Calculate space before
SPACE_BEFORE=$(du -sh . 2>/dev/null | cut -f1)
echo "Space before cleanup: $SPACE_BEFORE"
echo ""

# ============================================
# Phase 1: Update Docker Configuration
# ============================================
echo -e "${GREEN}Phase 1: Updating Docker Configuration${NC}"
echo "----------------------------------------"

if [ "$DRY_RUN" = false ]; then
    # Backup docker-compose files
    cp docker-compose.blue.yml "$BACKUP_DIR/"
    cp docker-compose.green.yml "$BACKUP_DIR/"
    cp docker-compose.yml "$BACKUP_DIR/"

    # Update blue environment
    sed -i 's|dockerfile: docker/frontend.prod.Dockerfile|dockerfile: docker/frontend.optimized.Dockerfile|g' docker-compose.blue.yml
    sed -i 's|dockerfile: docker/backend.prod.Dockerfile|dockerfile: docker/backend.optimized.Dockerfile|g' docker-compose.blue.yml
    sed -i 's|dockerfile: docker/ml.Dockerfile|dockerfile: docker/ml.optimized.Dockerfile|g' docker-compose.blue.yml

    # Update green environment
    sed -i 's|dockerfile: docker/frontend.prod.Dockerfile|dockerfile: docker/frontend.optimized.Dockerfile|g' docker-compose.green.yml
    sed -i 's|dockerfile: docker/backend.prod.Dockerfile|dockerfile: docker/backend.optimized.Dockerfile|g' docker-compose.green.yml
    sed -i 's|dockerfile: docker/ml.Dockerfile|dockerfile: docker/ml.optimized.Dockerfile|g' docker-compose.green.yml

    # Update development docker-compose
    sed -i 's|dockerfile: docker/frontend.Dockerfile|dockerfile: docker/frontend.optimized.Dockerfile|g' docker-compose.yml
    sed -i 's|dockerfile: docker/backend.Dockerfile|dockerfile: docker/backend.optimized.Dockerfile|g' docker-compose.yml
    sed -i 's|dockerfile: docker/ml.Dockerfile|dockerfile: docker/ml.optimized.Dockerfile|g' docker-compose.yml

    echo "✓ Updated docker-compose.blue.yml"
    echo "✓ Updated docker-compose.green.yml"
    echo "✓ Updated docker-compose.yml"
else
    echo "[DRY RUN] Would update docker-compose files"
fi

# Verify changes
echo ""
echo "Verification - Dockerfile references:"
grep "dockerfile:" docker-compose.blue.yml | head -5
echo ""

# ============================================
# Phase 2: Safe File Cleanup
# ============================================
echo -e "${GREEN}Phase 2: Safe File Cleanup${NC}"
echo "----------------------------------------"

# 2.1 Lint output files
LINT_FILES="all-lint-check.txt backend-controllers-lint.txt eslint-output.txt final-lint-check.txt frontend-lint.txt .eslintcache"
echo "Removing lint output files..."
for file in $LINT_FILES; do
    if [ -f "$file" ]; then
        if [ "$DRY_RUN" = false ]; then
            cp "$file" "$BACKUP_DIR/" 2>/dev/null || true
            rm -f "$file"
            echo "  ✓ Removed $file"
        else
            echo "  [DRY RUN] Would remove $file"
        fi
    fi
done

# 2.2 Debug test scripts
TEST_SCRIPTS="test-export-*.mjs test-inline-cancel.mjs test-shared-export-state.mjs clear-export-state.mjs export-test-results.json"
echo "Removing debug test scripts..."
for pattern in $TEST_SCRIPTS; do
    for file in $pattern; do
        if [ -f "$file" ]; then
            if [ "$DRY_RUN" = false ]; then
                cp "$file" "$BACKUP_DIR/" 2>/dev/null || true
                rm -f "$file"
                echo "  ✓ Removed $file"
            else
                echo "  [DRY RUN] Would remove $file"
            fi
        fi
    done
done

# 2.3 Debug screenshots
SCREENSHOTS="export-cancel-test-final.png inline-cancel-not-found.png"
echo "Removing debug screenshots..."
for file in $SCREENSHOTS; do
    if [ -f "$file" ]; then
        if [ "$DRY_RUN" = false ]; then
            cp "$file" "$BACKUP_DIR/" 2>/dev/null || true
            rm -f "$file"
            echo "  ✓ Removed $file"
        else
            echo "  [DRY RUN] Would remove $file"
        fi
    fi
done

# 2.4 Unused lock file
if [ -f "bun.lockb" ]; then
    echo "Removing unused bun.lockb..."
    if [ "$DRY_RUN" = false ]; then
        cp "bun.lockb" "$BACKUP_DIR/" 2>/dev/null || true
        rm -f "bun.lockb"
        echo "  ✓ Removed bun.lockb (530KB)"
    else
        echo "  [DRY RUN] Would remove bun.lockb"
    fi
fi

# 2.5 Old backups
echo "Removing old backup files..."
if [ "$DRY_RUN" = false ]; then
    find . -maxdepth 1 -name "docker-compose.*.backup.*" -delete
    echo "  ✓ Removed old backup files"
else
    echo "  [DRY RUN] Would remove old backup files"
fi

# 2.6 Old build logs (keep last 7 days)
echo "Cleaning old build logs (older than 7 days)..."
if [ "$DRY_RUN" = false ]; then
    find logs/docker/ -name "build-*.log" -mtime +7 -delete 2>/dev/null || true
    find logs/docker/ -name "build-optimizer-*.log" -mtime +7 -delete 2>/dev/null || true
    echo "  ✓ Cleaned old build logs"
else
    echo "  [DRY RUN] Would clean old build logs"
fi

echo ""

# ============================================
# Phase 3: Documentation Consolidation
# ============================================
echo -e "${GREEN}Phase 3: Documentation Consolidation${NC}"
echo "----------------------------------------"

if [ "$DRY_RUN" = false ]; then
    # Create archive directories
    mkdir -p docs/archive/completed-fixes/{export,polygon,performance,canvas}

    # Export-related fixes
    git mv ABORT_CONTROLLER_FIX_SUMMARY.md docs/archive/completed-fixes/export/ 2>/dev/null || mv ABORT_CONTROLLER_FIX_SUMMARY.md docs/archive/completed-fixes/export/
    git mv COMPLETE_EXPORT_FIX_SUMMARY.md docs/archive/completed-fixes/export/ 2>/dev/null || mv COMPLETE_EXPORT_FIX_SUMMARY.md docs/archive/completed-fixes/export/
    git mv EXPORT_BUTTON_FIX_VERIFICATION.md docs/archive/completed-fixes/export/ 2>/dev/null || mv EXPORT_BUTTON_FIX_VERIFICATION.md docs/archive/completed-fixes/export/
    git mv EXPORT_DUPLICATE_DOWNLOAD_FIX_VERIFICATION.md docs/archive/completed-fixes/export/ 2>/dev/null || mv EXPORT_DUPLICATE_DOWNLOAD_FIX_VERIFICATION.md docs/archive/completed-fixes/export/
    git mv EXPORT_FIX_TEST_GUIDE.md docs/archive/completed-fixes/export/ 2>/dev/null || mv EXPORT_FIX_TEST_GUIDE.md docs/archive/completed-fixes/export/
    git mv INLINE_CANCEL_FIX_FINAL.md docs/archive/completed-fixes/export/ 2>/dev/null || mv INLINE_CANCEL_FIX_FINAL.md docs/archive/completed-fixes/export/
    git mv RACE_CONDITION_FIX_SUMMARY.md docs/archive/completed-fixes/export/ 2>/dev/null || mv RACE_CONDITION_FIX_SUMMARY.md docs/archive/completed-fixes/export/
    git mv UNIVERSAL_CANCEL_IMPLEMENTATION.md docs/archive/completed-fixes/export/ 2>/dev/null || mv UNIVERSAL_CANCEL_IMPLEMENTATION.md docs/archive/completed-fixes/export/

    # Polygon-related fixes
    git mv POLYGON_ID_VALIDATION_FIX_VERIFICATION.md docs/archive/completed-fixes/polygon/ 2>/dev/null || mv POLYGON_ID_VALIDATION_FIX_VERIFICATION.md docs/archive/completed-fixes/polygon/
    git mv POLYGON_ID_VALIDATION_TEST_REPORT.md docs/archive/completed-fixes/polygon/ 2>/dev/null || mv POLYGON_ID_VALIDATION_TEST_REPORT.md docs/archive/completed-fixes/polygon/
    git mv POLYGON_SELECTION_FIX_VERIFICATION.md docs/archive/completed-fixes/polygon/ 2>/dev/null || mv POLYGON_SELECTION_FIX_VERIFICATION.md docs/archive/completed-fixes/polygon/
    git mv POLYGON_TESTS_REPORT.md docs/archive/completed-fixes/polygon/ 2>/dev/null || mv POLYGON_TESTS_REPORT.md docs/archive/completed-fixes/polygon/
    git mv test-slice-mode-fix.md docs/archive/completed-fixes/polygon/ 2>/dev/null || mv test-slice-mode-fix.md docs/archive/completed-fixes/polygon/

    # Performance analysis
    git mv CANVAS_OPTIMIZATION_RESEARCH_REPORT.md docs/archive/completed-fixes/canvas/ 2>/dev/null || mv CANVAS_OPTIMIZATION_RESEARCH_REPORT.md docs/archive/completed-fixes/canvas/
    git mv REACT_DEVTOOLS_PROFILING_GUIDE.md docs/archive/completed-fixes/performance/ 2>/dev/null || mv REACT_DEVTOOLS_PROFILING_GUIDE.md docs/archive/completed-fixes/performance/
    git mv REACT_VERTEX_PERFORMANCE_ANALYSIS.md docs/archive/completed-fixes/performance/ 2>/dev/null || mv REACT_VERTEX_PERFORMANCE_ANALYSIS.md docs/archive/completed-fixes/performance/
    git mv TEST_GENERATION_REPORT.md docs/archive/completed-fixes/performance/ 2>/dev/null || mv TEST_GENERATION_REPORT.md docs/archive/completed-fixes/performance/
    git mv VERTEX_PERFORMANCE_ANALYSIS_REPORT.md docs/archive/completed-fixes/performance/ 2>/dev/null || mv VERTEX_PERFORMANCE_ANALYSIS_REPORT.md docs/archive/completed-fixes/performance/
    git mv VERTEX_SCALING_ANALYSIS_REPORT.md docs/archive/completed-fixes/performance/ 2>/dev/null || mv VERTEX_SCALING_ANALYSIS_REPORT.md docs/archive/completed-fixes/performance/

    echo "✓ Consolidated documentation to docs/archive/"
else
    echo "[DRY RUN] Would consolidate documentation"
fi

echo ""

# ============================================
# Phase 4: Delete Deprecated Docker Files
# ============================================
echo -e "${GREEN}Phase 4: Delete Deprecated Docker Files${NC}"
echo "----------------------------------------"

DEPRECATED_DOCKERFILES="docker/frontend.Dockerfile docker/backend.Dockerfile docker/ml.Dockerfile docker/frontend.prod.Dockerfile docker/backend.prod.Dockerfile"
echo "Removing deprecated Dockerfiles..."
for file in $DEPRECATED_DOCKERFILES; do
    if [ -f "$file" ]; then
        if [ "$DRY_RUN" = false ]; then
            cp "$file" "$BACKUP_DIR/" 2>/dev/null || true
            rm -f "$file"
            echo "  ✓ Removed $file"
        else
            echo "  [DRY RUN] Would remove $file"
        fi
    fi
done

echo ""

# ============================================
# Summary
# ============================================
echo -e "${GREEN}Cleanup Summary${NC}"
echo "========================================"

# Calculate space after
SPACE_AFTER=$(du -sh . 2>/dev/null | cut -f1)
FILE_COUNT=$(ls -1 | wc -l)

echo "Space before: $SPACE_BEFORE"
echo "Space after:  $SPACE_AFTER"
echo "Root files:   $FILE_COUNT"
echo ""
echo "Backup location: $BACKUP_DIR"
echo ""

if [ "$DRY_RUN" = false ]; then
    echo -e "${GREEN}✓ Cleanup complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Review changes: git status"
    echo "2. Test Docker builds: make build-optimized"
    echo "3. Commit changes: git add -A && git commit -m 'chore: Comprehensive cleanup and Docker optimization'"
else
    echo -e "${YELLOW}DRY RUN COMPLETE - No files were modified${NC}"
    echo "Remove --dry-run flag to execute cleanup"
fi