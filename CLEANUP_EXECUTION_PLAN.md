# Cell Segmentation Hub - Cleanup Execution Plan

**Date:** 2025-09-29
**Active Environment:** Blue (Production)
**Estimated Time:** 2-3 hours
**Estimated Space Saved:** 1.67GB

## Executive Summary

Comprehensive cleanup to remove legacy files, consolidate duplicates, and update production configuration to use optimized Docker builds (40-70% smaller images).

---

## Phase 1: CRITICAL - Docker Configuration Update (30 min)

### Issue

Production blue environment uses deprecated Dockerfiles instead of optimized versions:

- Line 8: `dockerfile: docker/frontend.prod.Dockerfile` → should be `docker/frontend.optimized.Dockerfile`
- Line 31: `dockerfile: docker/backend.prod.Dockerfile` → should be `docker/backend.optimized.Dockerfile`
- Line 114: `dockerfile: docker/ml.Dockerfile` → should be `docker/ml.optimized.Dockerfile`

### Impact

- 40-70% larger images
- Slower builds
- More disk usage

### Files to Delete After Update

```
docker/frontend.Dockerfile (890 bytes)
docker/backend.Dockerfile (1.2KB)
docker/ml.Dockerfile (1.7KB)
docker/frontend.prod.Dockerfile (1.7KB)
docker/backend.prod.Dockerfile (1.9KB)
```

---

## Phase 2: Safe File Cleanup (15 min)

### 2.1 Lint Output Files (800KB)

```bash
rm -f all-lint-check.txt
rm -f backend-controllers-lint.txt
rm -f eslint-output.txt
rm -f final-lint-check.txt
rm -f frontend-lint.txt
rm -f .eslintcache
```

### 2.2 Debug Test Scripts (60KB)

```bash
rm -f test-export-*.mjs
rm -f test-inline-cancel.mjs
rm -f test-shared-export-state.mjs
rm -f clear-export-state.mjs
rm -f export-test-results.json
```

### 2.3 Debug Screenshots (3.3MB)

```bash
rm -f export-cancel-test-final.png
rm -f inline-cancel-not-found.png
```

### 2.4 Unused Lock File (530KB)

```bash
rm -f bun.lockb
```

### 2.5 Old Backups (5.2KB)

```bash
rm -f docker-compose.*.backup.*
```

**Total: ~4.7MB**

---

## Phase 3: Documentation Consolidation (20 min)

Move completed feature/fix documentation to archive:

```bash
mkdir -p docs/archive/completed-fixes/{export,polygon,performance,canvas}

# Export-related fixes
mv ABORT_CONTROLLER_FIX_SUMMARY.md docs/archive/completed-fixes/export/
mv COMPLETE_EXPORT_FIX_SUMMARY.md docs/archive/completed-fixes/export/
mv EXPORT_BUTTON_FIX_VERIFICATION.md docs/archive/completed-fixes/export/
mv EXPORT_DUPLICATE_DOWNLOAD_FIX_VERIFICATION.md docs/archive/completed-fixes/export/
mv EXPORT_FIX_TEST_GUIDE.md docs/archive/completed-fixes/export/
mv INLINE_CANCEL_FIX_FINAL.md docs/archive/completed-fixes/export/
mv RACE_CONDITION_FIX_SUMMARY.md docs/archive/completed-fixes/export/
mv UNIVERSAL_CANCEL_IMPLEMENTATION.md docs/archive/completed-fixes/export/

# Polygon-related fixes
mv POLYGON_ID_VALIDATION_FIX_VERIFICATION.md docs/archive/completed-fixes/polygon/
mv POLYGON_ID_VALIDATION_TEST_REPORT.md docs/archive/completed-fixes/polygon/
mv POLYGON_SELECTION_FIX_VERIFICATION.md docs/archive/completed-fixes/polygon/
mv POLYGON_TESTS_REPORT.md docs/archive/completed-fixes/polygon/
mv test-slice-mode-fix.md docs/archive/completed-fixes/polygon/

# Performance analysis
mv CANVAS_OPTIMIZATION_RESEARCH_REPORT.md docs/archive/completed-fixes/canvas/
mv REACT_DEVTOOLS_PROFILING_GUIDE.md docs/archive/completed-fixes/performance/
mv REACT_VERTEX_PERFORMANCE_ANALYSIS.md docs/archive/completed-fixes/performance/
mv TEST_GENERATION_REPORT.md docs/archive/completed-fixes/performance/
mv VERTEX_PERFORMANCE_ANALYSIS_REPORT.md docs/archive/completed-fixes/performance/
mv VERTEX_SCALING_ANALYSIS_REPORT.md docs/archive/completed-fixes/performance/
```

**Total: ~160KB moved to archive**

---

## Phase 4: Code Consolidation (1-2 hours)

### 4.1 Delete Duplicate WebSocket Manager

```bash
# Keep webSocketManagerImproved.ts, delete old version
rm src/services/webSocketManager.ts
# Rename improved version to standard name
mv src/services/webSocketManagerImproved.ts src/services/webSocketManager.ts
```

### 4.2 Email Service Consolidation (NEEDS CAREFUL TESTING)

```bash
# Mark for manual consolidation (not automated):
# - Keep: backend/src/services/emailService.ts
# - Merge retry logic from: backend/src/services/emailRetryService.ts
# - Delete: backend/src/services/reliableEmailService.ts
# This requires careful code review and testing
```

---

## Phase 5: Optional - Test Images (1.4GB)

**DO NOT DELETE** unless confirmed with team. These are test datasets.

Option: Archive externally and keep 20 sample images for testing.

---

## Execution Checklist

- [ ] **Backup created** - `/tmp/cleanup-backup-YYYYMMDD/`
- [ ] **Git status clean** - No uncommitted changes
- [ ] **Active services stopped** - `docker compose -f docker-compose.blue.yml down`
- [ ] **Phase 1 executed** - Docker configs updated
- [ ] **Phase 2 executed** - Safe files removed
- [ ] **Phase 3 executed** - Docs consolidated
- [ ] **Phase 4 executed** - Code deduplicated
- [ ] **Git commit created** - Changes committed
- [ ] **Services restarted** - Blue environment tested
- [ ] **Health check passed** - All services healthy

---

## Verification Commands

```bash
# Check disk space before/after
df -h /

# Verify Docker configs
grep "dockerfile:" docker-compose.blue.yml
grep "dockerfile:" docker-compose.green.yml

# Check file count
ls -1 | wc -l  # Should drop from 72 to ~45

# Test services
curl http://localhost:4001/health
curl http://localhost:4008/health
```

---

## Rollback Plan

If issues occur:

1. `git reset --hard HEAD~1` - Revert changes
2. Restore from `/tmp/cleanup-backup-YYYYMMDD/`
3. `docker compose -f docker-compose.blue.yml up -d` - Restart services

---

## Post-Cleanup Monitoring

After cleanup, monitor for 24 hours:

- Docker build times (should be faster)
- Container startup times
- Application functionality (especially email and WebSocket)
- Disk usage trends
