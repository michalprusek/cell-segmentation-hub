# Test Execution Blockers and Immediate Fixes

**Date:** 2025-10-07
**Status:** Tests cannot execute - Environment issues detected
**Estimated Fix Time:** 30-60 minutes

---

## Critical Blockers

### 1. Permission Issues with node_modules ⚠️

**Problem:**
```bash
EACCES: permission denied, mkdir 'node_modules/axe-playwright/node_modules'
```

**Cause:** node_modules owned by root:root instead of cvat:cvat

**Fix:**
```bash
sudo chown -R cvat:cvat /home/cvat/cell-segmentation-hub/node_modules
```

**Impact:** Prevents all frontend dependency installation

---

### 2. Missing package-lock.json (Backend) ⚠️

**Problem:**
```bash
npm error code EUSAGE
npm error The `npm ci` command can only install with an existing package-lock.json
```

**Cause:** Backend package-lock.json not committed to repository

**Fix:**
```bash
cd /home/cvat/cell-segmentation-hub/backend
npm install  # Generates package-lock.json
git add package-lock.json
git commit -m "chore: Add missing package-lock.json for reproducible builds"
```

**Impact:** Prevents Docker builds and test execution in containers

---

### 3. Missing Test Dependencies ⚠️

**Problem:**
```bash
sh: 1: vitest: not found
```

**Cause:** Test frameworks not installed in host environment

**Fix:**
```bash
# After fixing permissions, install dependencies
cd /home/cvat/cell-segmentation-hub
npm install

cd backend
npm install
```

**Impact:** Cannot run tests on host machine

---

### 4. Production Containers Don't Have Test Dependencies 🔍

**Problem:** Blue environment containers (blue-frontend, blue-backend, blue-ml) are production builds without dev dependencies

**Cause:** Production Dockerfiles use `npm ci --omit=dev`

**Solutions:**

**Option A: Use Test Environment (RECOMMENDED)**
```bash
# Use dedicated test containers
docker compose -f docker-compose.test.yml up -d test-database test-redis
docker compose -f docker-compose.test.yml run --rm test-backend npm run test
docker compose -f docker-compose.test.yml run --rm test-frontend npm run test
docker compose -f docker-compose.test.yml run --rm test-ml pytest -v
```

**Option B: Use Development Environment**
```bash
# Ensure dev containers are running
make up

# Run tests through Makefile
make test
make test-e2e
```

**Option C: Run on Host After Fixing Dependencies**
```bash
npm run test
cd backend && npm run test
```

**Impact:** Cannot use active production containers for testing

---

## Quick Fix Script

Run this to fix all blockers:

```bash
#!/bin/bash
set -e

echo "🔧 Fixing Test Execution Blockers..."

# Fix 1: Permissions
echo "📝 Fixing node_modules permissions..."
sudo chown -R cvat:cvat /home/cvat/cell-segmentation-hub/node_modules

# Fix 2: Generate package-lock.json
echo "📦 Generating backend package-lock.json..."
cd /home/cvat/cell-segmentation-hub/backend
npm install

# Fix 3: Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd /home/cvat/cell-segmentation-hub
npm install

# Fix 4: Commit package-lock.json
echo "💾 Committing package-lock.json..."
cd /home/cvat/cell-segmentation-hub
git add backend/package-lock.json
git commit -m "chore: Add missing package-lock.json for reproducible builds" || echo "Already committed"

echo "✅ All blockers fixed!"
echo ""
echo "🧪 You can now run tests:"
echo "  npm run test              # Frontend unit tests"
echo "  cd backend && npm run test # Backend unit tests"
echo "  npm run test:e2e          # E2E tests"
```

Save as `fix-test-blockers.sh` and run:
```bash
chmod +x fix-test-blockers.sh
./fix-test-blockers.sh
```

---

## Verification Commands

After fixing blockers, verify with:

```bash
# Check permissions
ls -la /home/cvat/cell-segmentation-hub/node_modules | head -5

# Check package-lock exists
ls -la /home/cvat/cell-segmentation-hub/backend/package-lock.json

# Check vitest installed
npx vitest --version

# Check jest installed
cd backend && npx jest --version

# Check playwright installed
npx playwright --version
```

Expected output:
```
✅ node_modules owned by cvat:cvat
✅ backend/package-lock.json exists
✅ vitest 3.2.4 (or similar)
✅ jest 29.x.x (or similar)
✅ playwright 1.54.2 (or similar)
```

---

## Test Execution Commands (After Fixes)

### Frontend Unit Tests (Vitest)
```bash
cd /home/cvat/cell-segmentation-hub
npm run test -- --run --reporter=verbose 2>&1 | tee test-results/frontend-unit.log
```

**Expected:**
- 500-800 tests
- 15-20 minutes duration
- 70-80% coverage

---

### Backend Unit Tests (Jest)
```bash
cd /home/cvat/cell-segmentation-hub/backend
npm run test -- --verbose --runInBand 2>&1 | tee ../test-results/backend-unit.log
```

**Expected:**
- 200-300 tests
- 10-15 minutes duration
- 70-80% coverage

---

### Backend Integration Tests (Jest)
```bash
cd /home/cvat/cell-segmentation-hub/backend
npm run test:integration -- --verbose 2>&1 | tee ../test-results/backend-integration.log
```

**Expected:**
- 50-80 tests
- 5-10 minutes duration

---

### ML Service Tests (Pytest)
```bash
cd /home/cvat/cell-segmentation-hub/backend/segmentation
pytest -v --tb=short --junitxml=../../test-results/ml-tests.xml 2>&1 | tee ../../test-results/ml-tests.log
```

**Expected:**
- 35-55 tests
- 5-13 minutes duration

---

### E2E Tests (Playwright)
```bash
cd /home/cvat/cell-segmentation-hub
npm run test:e2e -- --reporter=list 2>&1 | tee test-results/e2e-tests.log
```

**Expected:**
- 80-120 tests
- 20-40 minutes duration
- Screenshots/videos on failure

---

## Test Coverage Commands (After Tests Pass)

```bash
# Frontend coverage
npm run test:coverage

# Backend coverage
cd backend && npm run test:coverage

# ML coverage
cd backend/segmentation && pytest --cov --cov-report=html --cov-report=term-missing
```

---

## Alternative: Use Test Environment (No Host Dependencies)

If you want to avoid host-level dependency issues entirely:

```bash
# Build and run all tests in isolated Docker environment
docker compose -f docker-compose.test.yml build
docker compose -f docker-compose.test.yml up -d test-database test-redis

# Run tests in containers
docker compose -f docker-compose.test.yml run --rm test-frontend npm run test -- --run --reporter=verbose
docker compose -f docker-compose.test.yml run --rm test-backend npm run test -- --verbose --runInBand
docker compose -f docker-compose.test.yml run --rm test-ml pytest -v --tb=short

# Cleanup
docker compose -f docker-compose.test.yml down -v
```

**Pros:**
- ✅ No host dependencies needed
- ✅ Isolated test environment
- ✅ Reproducible across machines
- ✅ Matches CI/CD environment

**Cons:**
- ❌ Longer build times
- ❌ Requires fixing package-lock.json first
- ❌ More disk space usage

---

## Summary

**Current State:** ❌ Tests cannot execute

**After Fixes:** ✅ All 159+ test files ready to run

**Fix Priority:**
1. 🔴 Fix permissions (5 minutes)
2. 🔴 Generate package-lock.json (10 minutes)
3. 🟡 Install dependencies (15-30 minutes)
4. 🟢 Run tests (55-98 minutes)

**Total Time:** ~1.5-2.5 hours from start to complete test execution

---

**Next Step:** Run the quick fix script or apply fixes manually, then execute tests using your preferred method (host, test environment, or development environment).
