# Test Quality Improvement Action Plan

## 🚨 Critical Issues to Fix (Today)

### 1. Fix Axios Mock Configuration

**Problem:** 346 test failures due to incorrect axios mocking
**Impact:** Blocking 30% of tests from running

**Solution:**

```typescript
// src/test/setup.ts
import { vi } from 'vitest';
import axios from 'axios';

// Create proper axios mock
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
    defaults: {
      headers: {
        common: {},
        post: {},
        get: {},
        put: {},
        patch: {},
        delete: {},
      },
    },
  };

  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
      ...mockAxiosInstance,
    },
    create: vi.fn(() => mockAxiosInstance),
  };
});
```

### 2. Fix Context Provider Issues

**Problem:** Component tests failing with "Cannot read properties of undefined"
**Impact:** 40% of component tests failing

**Solution:**

```typescript
// src/test/test-utils.tsx
import { render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { WebSocketProvider } from '@/contexts/WebSocketContext';

export const AllProviders = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <AuthProvider>
      <WebSocketProvider>
        {children}
      </WebSocketProvider>
    </AuthProvider>
  </ThemeProvider>
);

export const renderWithProviders = (ui: React.ReactElement, options = {}) =>
  render(ui, { wrapper: AllProviders, ...options });
```

### 3. Fix Backend TypeScript Errors

**Problem:** Backend tests won't compile
**Impact:** 0% backend test coverage

**Quick Fixes:**

```bash
# Fix missing service
touch backend/src/services/sessionService.ts

# Update Prisma schema
cd backend && npx prisma generate

# Fix type mismatches
npm run type-check
```

## 📊 Coverage Improvement Strategy

### Week 1: Stabilize Existing Tests

- [ ] Fix all mock configuration issues
- [ ] Resolve context provider problems
- [ ] Fix TypeScript compilation errors
- [ ] Target: 50% overall coverage

### Week 2: Fill Critical Gaps

- [ ] Add auth flow integration tests
- [ ] Add file upload tests
- [ ] Add WebSocket event tests
- [ ] Target: 65% overall coverage

### Week 3: Reach Production Standards

- [ ] Add remaining unit tests
- [ ] Complete E2E test suite
- [ ] Add performance benchmarks
- [ ] Target: 70%+ coverage

## 🎯 Quick Wins (1-2 hours each)

### 1. Add Simple Unit Tests

```typescript
// Easy wins for immediate coverage boost
describe('Utility Functions', () => {
  test('formatDate formats correctly', () => {
    expect(formatDate('2024-01-01')).toBe('Jan 1, 2024');
  });

  test('validateEmail validates correctly', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('invalid')).toBe(false);
  });
});
```

### 2. Add API Endpoint Tests

```typescript
// backend/src/api/__tests__/health.test.ts
describe('Health Check Endpoint', () => {
  test('GET /health returns 200', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });
});
```

### 3. Add Component Smoke Tests

```typescript
// Ensure components render without crashing
describe('Component Smoke Tests', () => {
  test('Dashboard renders', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByText(/dashboard/i)).toBeInTheDocument();
  });
});
```

## 🔧 Test Infrastructure Fixes

### 1. Update Test Configuration

```javascript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      threshold: {
        statements: 50, // Start lower
        branches: 40,
        functions: 50,
        lines: 50,
      },
    },
  },
});
```

### 2. Create Test Helpers

```typescript
// src/test/factories.ts
export const createMockUser = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  role: 'user',
  ...overrides,
});

export const createMockProject = (overrides = {}) => ({
  id: 'project-123',
  name: 'Test Project',
  userId: 'user-123',
  ...overrides,
});
```

### 3. Add Custom Matchers

```typescript
// src/test/matchers.ts
expect.extend({
  toBeValidEmail(received) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const pass = emailRegex.test(received);
    return {
      pass,
      message: () => `expected ${received} to be a valid email`,
    };
  },
});
```

## 📈 Monitoring Progress

### Daily Metrics

```bash
# Run this daily to track progress
npm run test:coverage -- --reporter=json > coverage-$(date +%Y%m%d).json

# Compare coverage over time
node scripts/coverage-trend.js
```

### Weekly Goals

| Week | Frontend | Backend | E2E | Overall |
| ---- | -------- | ------- | --- | ------- |
| 1    | 40%      | 20%     | 60% | 40%     |
| 2    | 55%      | 40%     | 80% | 58%     |
| 3    | 70%      | 60%     | 90% | 73%     |

## 🚀 Automation Setup

### Pre-commit Hook

```bash
# .husky/pre-commit
npm run test:coverage -- --coverage.enabled --run
if [ $? -ne 0 ]; then
  echo "Tests must pass before commit"
  exit 1
fi
```

### CI Pipeline Check

```yaml
# .github/workflows/ci.yml
- name: Check Coverage
  run: |
    npm run test:coverage
    if [ $(cat coverage/coverage-summary.json | jq '.total.lines.pct') -lt 50 ]; then
      echo "Coverage below threshold"
      exit 1
    fi
```

## 📝 Testing Best Practices

### 1. Test Structure

```typescript
// Arrange - Act - Assert pattern
test('should calculate total correctly', () => {
  // Arrange
  const items = [{ price: 10 }, { price: 20 }];

  // Act
  const total = calculateTotal(items);

  // Assert
  expect(total).toBe(30);
});
```

### 2. Test Naming

```typescript
// Use descriptive names
describe('UserService', () => {
  describe('when creating a new user', () => {
    test('should hash the password before saving', () => {});
    test('should send welcome email', () => {});
    test('should handle duplicate email error', () => {});
  });
});
```

### 3. Async Testing

```typescript
// Always use async/await for clarity
test('should fetch user data', async () => {
  const userData = await fetchUser('123');
  expect(userData.name).toBe('John Doe');
});
```

## ✅ Success Criteria

The testing improvement initiative will be considered successful when:

1. **Coverage Metrics:**
   - Frontend: ≥70%
   - Backend: ≥60%
   - E2E: ≥80% of critical paths

2. **Test Stability:**
   - <5% flaky tests
   - All tests pass in CI
   - <60s total execution time

3. **Developer Experience:**
   - Tests run in watch mode during development
   - Clear error messages
   - Fast feedback loop (<5s for unit tests)

## 🎉 Expected Outcomes

After implementing these improvements:

- **50% reduction** in production bugs
- **30% faster** development velocity
- **90% confidence** in deployments
- **Automated quality gates** preventing regressions

---

**Next Step:** Start with Critical Issue #1 (Fix Axios Mocks) - Estimated time: 30 minutes
