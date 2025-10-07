# Test Integration Mapping for New Features

**Purpose:** Guide for where to add tests when implementing new features
**Generated:** 2025-10-07

## Quick Decision Tree

```
New Feature? → What layer?
    ↓
    Frontend Component?
        → Add to /src/components/__tests__/
        → Use reactTestUtils.tsx
        → Follow pattern from existing tests
    ↓
    Backend API?
        → Controller test in /backend/src/api/controllers/__tests__/
        → Service test in /backend/src/services/__tests__/
        → Integration test in /backend/src/test/integration/
    ↓
    ML Inference?
        → API test in /backend/segmentation/tests/
        → Unit test in /backend/segmentation/tests/unit/
    ↓
    User Workflow?
        → E2E test in /tests/e2e/
        → Use Playwright
```

## Test File Naming Conventions

### Frontend
```
Component:     ComponentName.test.tsx
Hook:          useHookName.test.ts
Utility:       utilityName.test.ts
Integration:   FeatureName.integration.test.tsx
Performance:   FeatureName.performance.test.ts
```

### Backend
```
Controller:    controller.test.ts
Service:       serviceName.test.ts
Integration:   featureName.integration.test.ts
Security:      featureName.security.test.ts
```

### ML Service
```
API:           test_api_feature.py
Unit:          test_feature_service.py
Performance:   test_feature_benchmarks.py
```

### E2E
```
Workflow:      feature-workflow.spec.ts
Performance:   feature-performance.spec.ts
```

## Test Integration Points by Feature Type

### 1. New UI Component

**Where to add tests:**

1. **Component Unit Test** (REQUIRED)
   - Location: `/src/components/__tests__/ComponentName.test.tsx`
   - Template: Copy from existing component test
   - Focus: Rendering, props, interactions, accessibility

2. **Integration Test** (if complex)
   - Location: `/src/components/__tests__/ComponentName.integration.test.tsx`
   - Focus: Integration with contexts, API calls, state management

3. **E2E Test** (if user-facing)
   - Location: `/tests/e2e/component-workflow.spec.ts`
   - Focus: User workflows, cross-browser compatibility

**Example structure:**
```typescript
// ComponentName.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentName } from '../ComponentName';

describe('ComponentName', () => {
  it('renders correctly', () => {
    render(<ComponentName />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const mockHandler = vi.fn();
    render(<ComponentName onClick={mockHandler} />);
    await fireEvent.click(screen.getByRole('button'));
    expect(mockHandler).toHaveBeenCalledOnce();
  });
});
```

**Test utilities to use:**
- `reactTestUtils.tsx` - React testing helpers
- `test-helpers.ts` - General utilities
- `mockComponents.tsx` - Mock child components

### 2. New API Endpoint

**Where to add tests:**

1. **Controller Test** (REQUIRED)
   - Location: `/backend/src/api/controllers/__tests__/controller.test.ts`
   - Focus: Request handling, validation, response formatting

2. **Service Test** (REQUIRED)
   - Location: `/backend/src/services/__tests__/serviceName.test.ts`
   - Focus: Business logic, error handling, data processing

3. **Integration Test** (REQUIRED)
   - Location: `/backend/src/test/integration/feature.integration.test.ts`
   - Focus: Database operations, service orchestration, end-to-end flow

4. **Security Test** (if auth-related)
   - Location: `/backend/src/test/security/featureSecurity.test.ts`
   - Focus: Authorization, authentication boundaries, access control

**Example structure:**
```typescript
// controller.test.ts
describe('FeatureController', () => {
  describe('POST /api/feature', () => {
    it('creates new feature successfully', async () => {
      const response = await request(app)
        .post('/api/feature')
        .send({ data: 'test' })
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        data: 'test'
      });
    });

    it('validates required fields', async () => {
      await request(app)
        .post('/api/feature')
        .send({})
        .expect(400);
    });
  });
});
```

**Test utilities to use:**
- `supertest` for HTTP requests
- `prisma` for database mocking
- Test database isolation

### 3. New WebSocket Event

**Where to add tests:**

1. **WebSocket Service Test** (REQUIRED)
   - Location: `/backend/src/services/__tests__/websocketService.test.ts`
   - Focus: Event emission, room management, error handling

2. **Frontend WebSocket Test** (REQUIRED)
   - Location: `/src/services/__tests__/webSocketManager.test.ts`
   - Focus: Event handling, reconnection, state updates

3. **Integration Test** (REQUIRED)
   - Location: `/backend/src/test/integration/feature.realtime.test.ts`
   - Focus: Client-server communication, real-time updates

**Example structure:**
```typescript
// Frontend
describe('WebSocket Feature Events', () => {
  it('handles feature update event', async () => {
    const mockHandler = vi.fn();
    wsManager.on('featureUpdate', mockHandler);

    wsTestUtils.emitServerEvent('featureUpdate', { id: '1', status: 'updated' });

    await waitFor(() => {
      expect(mockHandler).toHaveBeenCalledWith({
        id: '1',
        status: 'updated'
      });
    });
  });
});
```

**Test utilities to use:**
- `webSocketTestUtils.ts` - WebSocket mocking utilities
- `webSocketManager.test.ts` patterns

### 4. New Segmentation Feature

**Where to add tests:**

1. **Canvas Component Test** (REQUIRED)
   - Location: `/src/pages/segmentation/components/canvas/__tests__/FeatureCanvas.test.tsx`
   - Focus: Rendering, interactions, coordinate transformations

2. **Hook Test** (REQUIRED)
   - Location: `/src/pages/segmentation/hooks/__tests__/useFeature.test.tsx`
   - Focus: State management, side effects, cleanup

3. **Integration Test** (REQUIRED)
   - Location: `/src/pages/segmentation/__tests__/FeatureIntegration.test.tsx`
   - Focus: Editor integration, polygon operations, user workflows

4. **E2E Test** (REQUIRED)
   - Location: `/tests/e2e/feature-editing.spec.ts`
   - Focus: Complete user workflows, cross-browser testing

**Example structure:**
```typescript
// Canvas test
describe('FeatureCanvas', () => {
  it('renders polygons correctly', () => {
    const polygons = polygonTestDataFactory.createMultiple(5);
    render(<FeatureCanvas polygons={polygons} />);

    expect(screen.getAllByTestId('polygon')).toHaveLength(5);
  });

  it('handles click interactions', async () => {
    const mockHandler = vi.fn();
    render(<FeatureCanvas onClick={mockHandler} />);

    const canvas = canvasTestUtils.getCanvas();
    await canvasTestUtils.clickAt(canvas, { x: 100, y: 100 });

    expect(mockHandler).toHaveBeenCalledWith(
      expect.objectContaining({ x: 100, y: 100 })
    );
  });
});
```

**Test utilities to use:**
- `canvasTestUtils.ts` - Canvas interaction utilities
- `polygonTestUtils.ts` - Polygon helpers
- `polygonTestDataFactory.ts` - Test data generation
- `segmentationTestUtils.ts` - Segmentation-specific helpers

### 5. New ML Model/Inference

**Where to add tests:**

1. **Model Unit Test** (REQUIRED)
   - Location: `/backend/segmentation/tests/unit/ml/test_feature_model.py`
   - Focus: Model loading, inference correctness, output validation

2. **API Test** (REQUIRED)
   - Location: `/backend/segmentation/tests/test_feature_api.py`
   - Focus: Endpoint functionality, request/response, error handling

3. **Performance Test** (RECOMMENDED)
   - Location: `/backend/segmentation/tests/test_feature_benchmarks.py`
   - Focus: Inference time, memory usage, throughput

**Example structure:**
```python
# test_feature_model.py
def test_model_inference():
    model = load_model('feature-model')
    input_data = create_test_input()

    result = model.predict(input_data)

    assert result is not None
    assert result.shape == expected_shape
    assert result.dtype == expected_dtype

def test_model_handles_errors():
    model = load_model('feature-model')
    invalid_input = create_invalid_input()

    with pytest.raises(ValidationError):
        model.predict(invalid_input)
```

### 6. New Database Model

**Where to add tests:**

1. **Model Test** (REQUIRED)
   - Location: `/backend/src/services/__tests__/featureService.test.ts`
   - Focus: CRUD operations, relationships, constraints

2. **Integration Test** (REQUIRED)
   - Location: `/backend/src/test/integration/database.integration.test.ts`
   - Focus: Transactions, migrations, data integrity

**Example structure:**
```typescript
describe('Feature Model', () => {
  it('creates feature with relationships', async () => {
    const user = await createTestUser();
    const feature = await featureService.create({
      userId: user.id,
      data: 'test'
    });

    expect(feature).toMatchObject({
      id: expect.any(String),
      userId: user.id,
      data: 'test'
    });
  });

  it('enforces constraints', async () => {
    await expect(
      featureService.create({ data: null })
    ).rejects.toThrow('Validation failed');
  });
});
```

### 7. New Authentication Flow

**Where to add tests:**

1. **Auth Service Test** (REQUIRED)
   - Location: `/backend/src/services/__tests__/authService.test.ts`
   - Focus: Token generation, validation, refresh logic

2. **Security Test** (REQUIRED)
   - Location: `/backend/src/test/security/authSecurity.test.ts`
   - Focus: Attack vectors, rate limiting, session management

3. **E2E Test** (REQUIRED)
   - Location: `/tests/e2e/auth-enhanced.spec.ts`
   - Focus: User flows, error scenarios, UI feedback

**Test utilities to use:**
- JWT mocking utilities
- Session management helpers
- Rate limit testing

## Test Coverage Requirements

### Minimum Coverage by Feature Type

| Feature Type | Unit Tests | Integration Tests | E2E Tests |
|--------------|-----------|-------------------|-----------|
| UI Component | ✅ Required | Optional | Optional |
| API Endpoint | ✅ Required | ✅ Required | Optional |
| WebSocket | ✅ Required | ✅ Required | Optional |
| ML Model | ✅ Required | ✅ Required | ✅ Required |
| Database Model | ✅ Required | ✅ Required | Optional |
| Auth Flow | ✅ Required | ✅ Required | ✅ Required |
| User Workflow | Optional | Optional | ✅ Required |

### Coverage Thresholds

```
Statements:  80%+
Branches:    75%+
Functions:   80%+
Lines:       80%+
```

## Common Test Patterns

### 1. Async Operation Testing

```typescript
it('handles async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

### 2. Error Handling

```typescript
it('handles errors gracefully', async () => {
  await expect(functionThatThrows()).rejects.toThrow(ExpectedError);
});
```

### 3. State Management

```typescript
it('updates state correctly', async () => {
  const { result } = renderHook(() => useFeature());

  act(() => {
    result.current.update('new value');
  });

  await waitFor(() => {
    expect(result.current.value).toBe('new value');
  });
});
```

### 4. API Mocking

```typescript
it('fetches data from API', async () => {
  vi.spyOn(api, 'fetchFeature').mockResolvedValue({ data: 'test' });

  const result = await fetchFeature();

  expect(result.data).toBe('test');
  expect(api.fetchFeature).toHaveBeenCalledOnce();
});
```

### 5. WebSocket Events

```typescript
it('emits event correctly', async () => {
  const listener = vi.fn();
  wsManager.on('event', listener);

  wsTestUtils.emitServerEvent('event', { data: 'test' });

  await waitFor(() => {
    expect(listener).toHaveBeenCalledWith({ data: 'test' });
  });
});
```

## Test Dependencies Map

### When Testing Component X, Also Mock:

**UI Components:**
- Child components (use mockComponents.tsx)
- Contexts (AuthContext, ThemeContext, WebSocketContext)
- API calls (use vi.spyOn)
- Router (use createMemoryRouter)

**API Endpoints:**
- Database (use test database or mocks)
- External services (mock with supertest)
- WebSocket (mock Socket.io)
- Authentication (mock JWT)

**WebSocket Events:**
- Socket.io client/server
- Event emitters
- State management
- API calls triggered by events

**ML Inference:**
- Model loading (mock weights)
- CUDA availability (conditional tests)
- Input preprocessing
- Output postprocessing

## Checklist for New Feature Tests

### Pre-Development
- [ ] Identify all integration points
- [ ] Determine test file locations
- [ ] List required test utilities
- [ ] Plan test scenarios (happy path, edge cases, errors)

### During Development
- [ ] Write tests alongside code (TDD)
- [ ] Test happy path first
- [ ] Add edge case tests
- [ ] Add error handling tests
- [ ] Mock external dependencies properly

### Post-Development
- [ ] Verify coverage meets thresholds
- [ ] Run tests in isolation
- [ ] Check for flaky tests (run 5x)
- [ ] Document test scenarios
- [ ] Review with team

### Before Merge
- [ ] All tests passing
- [ ] No skipped tests (or documented why)
- [ ] No console.log or debug statements
- [ ] Code coverage meets requirements
- [ ] E2E tests added (if user-facing)

## Anti-Patterns to Avoid

### ❌ Don't Do This

1. **Testing Implementation Details**
   ```typescript
   // BAD
   expect(component.state.internalValue).toBe('x');

   // GOOD
   expect(screen.getByText('x')).toBeInTheDocument();
   ```

2. **Too Many Assertions**
   ```typescript
   // BAD - Testing too much in one test
   it('does everything', () => {
     expect(a).toBe('a');
     expect(b).toBe('b');
     expect(c).toBe('c');
     // ... 20 more assertions
   });

   // GOOD - Split into focused tests
   it('sets value a correctly', () => {
     expect(a).toBe('a');
   });
   ```

3. **Not Waiting for Async**
   ```typescript
   // BAD
   it('updates after API call', () => {
     callAPI();
     expect(result).toBe('updated'); // Race condition!
   });

   // GOOD
   it('updates after API call', async () => {
     await callAPI();
     expect(result).toBe('updated');
   });
   ```

4. **Sharing State Between Tests**
   ```typescript
   // BAD
   let sharedState;

   it('test 1', () => {
     sharedState = 'value';
   });

   it('test 2', () => {
     expect(sharedState).toBe('value'); // Dependent on test 1!
   });

   // GOOD
   beforeEach(() => {
     sharedState = 'value';
   });
   ```

5. **Not Cleaning Up**
   ```typescript
   // BAD
   it('subscribes to events', () => {
     wsManager.on('event', handler);
     // No cleanup - memory leak!
   });

   // GOOD
   it('subscribes to events', () => {
     wsManager.on('event', handler);
   });

   afterEach(() => {
     wsManager.removeAllListeners();
   });
   ```

## Quick Reference: Test File Templates

### Frontend Component
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentName } from '../ComponentName';

describe('ComponentName', () => {
  it('renders correctly', () => {
    render(<ComponentName />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('handles interaction', async () => {
    const mockHandler = vi.fn();
    render(<ComponentName onAction={mockHandler} />);

    await fireEvent.click(screen.getByRole('button'));

    expect(mockHandler).toHaveBeenCalledOnce();
  });
});
```

### Backend Controller
```typescript
import request from 'supertest';
import { app } from '../../app';

describe('FeatureController', () => {
  describe('POST /api/feature', () => {
    it('creates feature successfully', async () => {
      const response = await request(app)
        .post('/api/feature')
        .send({ data: 'test' })
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        data: 'test'
      });
    });
  });
});
```

### ML Service
```python
import pytest
from api.feature import predict

def test_prediction():
    input_data = create_test_data()
    result = predict(input_data)

    assert result is not None
    assert len(result) > 0
    assert result[0] > 0.5

def test_invalid_input():
    with pytest.raises(ValueError):
        predict(None)
```

### E2E Test
```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Workflow', () => {
  test('completes feature workflow', async ({ page }) => {
    await page.goto('/feature');
    await page.getByRole('button', { name: 'Start' }).click();

    await expect(page.getByText('Success')).toBeVisible();
  });
});
```

## Test Execution Tips

### Run Specific Tests
```bash
# Single file
npm test -- ComponentName.test.tsx

# Pattern matching
npm test -- pattern

# Watch mode
npm test -- --watch
```

### Debug Tests
```bash
# Enable debug output
DEBUG=* npm test

# Run with coverage
npm test -- --coverage

# Run with specific reporter
npm test -- --reporter=verbose
```

### Fix Flaky Tests
```bash
# Run test multiple times
for i in {1..10}; do npm test -- flaky.test.tsx || break; done

# Use debugging tools
npm test -- --inspect-brk flaky.test.tsx
```

---

**For detailed test coverage report, see:** TEST_FILE_MAPPING_REPORT.md
**For quick reference, see:** TEST_COVERAGE_SUMMARY.md
