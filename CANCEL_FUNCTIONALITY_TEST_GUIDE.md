# Cancel Functionality Test Suite - Execution Guide

## Overview

This guide provides comprehensive instructions for running the complete test suite for the cancel functionality implementation. The tests follow TDD principles and cover all aspects of the cancel operations from frontend interactions to backend processing.

## Test Architecture

### Test Categories

1. **Frontend Unit Tests** - Component behavior and UI interactions
2. **Backend API Tests** - REST endpoint functionality and validation
3. **Service Layer Tests** - Business logic and data operations
4. **WebSocket Tests** - Real-time event handling
5. **Integration Tests** - End-to-end workflows
6. **Performance Tests** - Load testing and optimization
7. **Security Tests** - Authorization and input validation

### Test Structure

```
/home/cvat/cell-segmentation-hub/
├── src/
│   ├── pages/__tests__/
│   │   └── ProjectDetail.cancel.test.tsx         # Frontend unit tests
│   └── test/utils/
│       └── cancelTestUtils.ts                    # Frontend test utilities
├── backend/src/
│   ├── api/controllers/__tests__/
│   │   └── queueController.cancel.test.ts        # API endpoint tests
│   ├── services/__tests__/
│   │   ├── queueService.cancel.test.ts           # Service layer tests
│   │   └── websocket.queueCancellation.test.ts   # WebSocket tests
│   ├── test/
│   │   ├── integration/
│   │   │   └── queueCancellation.test.ts         # Integration tests
│   │   ├── performance/
│   │   │   └── cancelPerformance.test.ts         # Performance tests
│   │   ├── security/
│   │   │   └── cancelSecurity.test.ts            # Security tests
│   │   └── utils/
│   │       └── cancelTestUtils.ts                # Backend test utilities
└── CANCEL_FUNCTIONALITY_TEST_GUIDE.md           # This guide
```

## Running Tests

### Prerequisites

Ensure all services are running in Docker:

```bash
# Start all services
make up

# Verify services are healthy
make health
```

### Frontend Tests

#### Unit Tests for Cancel Functionality

```bash
# Run frontend cancel tests
docker exec -it spheroseg-frontend npm run test src/pages/__tests__/ProjectDetail.cancel.test.tsx

# Run with coverage
docker exec -it spheroseg-frontend npm run test:coverage -- src/pages/__tests__/ProjectDetail.cancel.test.tsx

# Run in watch mode for development
docker exec -it spheroseg-frontend npm run test:watch -- src/pages/__tests__/ProjectDetail.cancel.test.tsx
```

**Test Coverage:**

- Component rendering with cancel button
- User interaction workflows
- Toast message handling
- WebSocket event processing
- Error state management
- Large-scale cancellation scenarios

#### Expected Results:

- ✅ 40+ test cases covering all cancel interactions
- ✅ Handles malformed API responses (fixes TypeError: .filter is not a function)
- ✅ Proper loading states and user feedback
- ✅ WebSocket event integration
- ✅ Performance with 200+ image batches

### Backend Tests

#### API Controller Tests

```bash
# Run API controller cancel tests
docker exec -it spheroseg-backend npm run test backend/src/api/controllers/__tests__/queueController.cancel.test.ts

# Run with verbose output
docker exec -it spheroseg-backend npm run test -- --verbose backend/src/api/controllers/__tests__/queueController.cancel.test.ts
```

**Test Coverage:**

- Project-level cancellation endpoint
- Batch-level cancellation endpoint
- Authentication and authorization
- Input validation and sanitization
- Error handling and edge cases

#### Service Layer Tests

```bash
# Run queue service cancel tests
docker exec -it spheroseg-backend npm run test backend/src/services/__tests__/queueService.cancel.test.ts

# Run with debugging
docker exec -it spheroseg-backend npm run test -- --debug backend/src/services/__tests__/queueService.cancel.test.ts
```

**Test Coverage:**

- Atomic cancellation operations
- Race condition handling
- Database transaction management
- Business logic validation
- Memory management

#### WebSocket Integration Tests

```bash
# Run WebSocket cancel tests
docker exec -it spheroseg-backend npm run test backend/src/services/__tests__/websocket.queueCancellation.test.ts
```

**Test Coverage:**

- Event emission to correct users
- Event data structure validation
- Concurrent user scenarios
- Connection handling during cancellation
- Performance under load

### Integration Tests

#### End-to-End Cancel Workflows

```bash
# Run complete integration tests
docker exec -it spheroseg-backend npm run test backend/src/test/integration/queueCancellation.test.ts

# Run with extended timeout for large batches
docker exec -it spheroseg-backend npm run test -- --testTimeout=60000 backend/src/test/integration/queueCancellation.test.ts
```

**Test Coverage:**

- Complete cancel flow (API → Database → WebSocket)
- 200+ image batch cancellation
- Race condition prevention
- Database constraint handling
- WebSocket disconnection scenarios

### Performance Tests

#### Load Testing and Optimization

```bash
# Run performance tests
docker exec -it spheroseg-backend npm run test backend/src/test/performance/cancelPerformance.test.ts

# Run with memory profiling
docker exec -it spheroseg-backend npm run test -- --detectOpenHandles backend/src/test/performance/cancelPerformance.test.ts
```

**Performance Benchmarks:**

- 1000+ item cancellation < 2 seconds
- 10,000+ item cancellation < 10 seconds
- Memory usage < 50MB for large operations
- Concurrent user support (10+ users)
- WebSocket throughput > 1000 events/second

### Security Tests

#### Authorization and Input Validation

```bash
# Run security tests
docker exec -it spheroseg-backend npm run test backend/src/test/security/cancelSecurity.test.ts
```

**Security Coverage:**

- User authentication requirements
- Project ownership validation
- Shared project access control
- SQL injection prevention
- Rate limiting and abuse prevention
- Data exposure prevention

## Test Data and Scenarios

### Test Scenarios Covered

1. **Standard Cancellation** - Normal user cancels their queue items
2. **Multi-User Scenarios** - Multiple users with separate queues
3. **Shared Projects** - Cancellation in shared project contexts
4. **Performance Scenarios** - Large-scale batch operations
5. **Race Conditions** - Concurrent cancellation attempts
6. **Error Scenarios** - Network failures, timeouts, invalid data
7. **Security Scenarios** - Unauthorized access attempts

### Mock Data Generators

The test utilities provide comprehensive mock data generation:

```typescript
// Frontend test data
import { TestDataGenerator } from '@/test/utils/cancelTestUtils';

const mockImages = TestDataGenerator.generateMockImages(100, {
  statuses: ['queued', 'processing', 'completed'],
});

// Backend test data
import { DataGenerator } from '../../test/utils/cancelTestUtils';

const testScenario = DataGenerator.buildPerformanceScenario('large');
```

## Continuous Integration

### Automated Test Execution

```bash
# Run all cancel functionality tests
make test-cancel

# Run tests with coverage reporting
make test-cancel-coverage

# Run performance benchmarks
make test-cancel-performance
```

### Test Reports

Tests generate detailed reports including:

- Coverage metrics (target: >90%)
- Performance benchmarks
- Security validation results
- Integration test results

## Debugging Test Issues

### Common Issues and Solutions

#### 1. Frontend Tests Fail with "TypeError: .filter is not a function"

**Solution:** This is the exact bug being tested. Ensure tests verify the fix:

```typescript
it('should handle malformed queue API response gracefully', async () => {
  vi.mocked(apiClient.default.get).mockResolvedValueOnce({ data: null });
  // Test should pass without TypeError
});
```

#### 2. WebSocket Tests Timeout

**Solution:** Increase timeout and verify WebSocket setup:

```bash
# Run with extended timeout
docker exec -it spheroseg-backend npm run test -- --testTimeout=30000 websocket.queueCancellation.test.ts
```

#### 3. Performance Tests Fail

**Solution:** Check Docker resource allocation:

```bash
# Increase Docker memory if needed
docker system info | grep Memory

# Optimize storage
make optimize-storage
```

#### 4. Integration Tests Database Conflicts

**Solution:** Ensure test database isolation:

```bash
# Reset test environment
make test-db-reset

# Use transaction rollbacks in tests
```

### Debug Commands

```bash
# View detailed test output
docker exec -it spheroseg-backend npm run test -- --verbose --reporter=verbose

# Debug specific test case
docker exec -it spheroseg-backend npm run test -- --debug --testNamePattern="should cancel batch segmentation"

# Check WebSocket connections
docker exec -it spheroseg-backend npm run test -- --verbose websocket

# Monitor memory usage during tests
docker stats spheroseg-backend
```

## Test Maintenance

### Adding New Cancel Tests

1. **Identify Test Category** - Unit, Integration, Performance, or Security
2. **Use Test Utilities** - Leverage existing mock generators
3. **Follow Naming Convention** - `describe('Feature') → it('should behavior')`
4. **Update This Guide** - Document new test scenarios

### Test Data Management

```bash
# Clean test artifacts
make clean-test

# Reset test database
make test-db-reset

# Update test fixtures
npm run test:update-fixtures
```

## Success Criteria

### Test Passing Requirements

- ✅ All unit tests pass (Frontend: 40+ tests, Backend: 60+ tests)
- ✅ Integration tests complete end-to-end workflows
- ✅ Performance tests meet benchmarks (< 2s for 1000 items)
- ✅ Security tests validate authorization
- ✅ Coverage > 90% for cancel functionality
- ✅ No memory leaks in large-scale tests
- ✅ WebSocket events work correctly
- ✅ Race conditions handled properly

### Performance Benchmarks

| Operation          | Target Performance | Test Coverage        |
| ------------------ | ------------------ | -------------------- |
| Cancel 100 items   | < 500ms            | ✅ Unit Tests        |
| Cancel 1000 items  | < 2s               | ✅ Performance Tests |
| Cancel 10000 items | < 10s              | ✅ Stress Tests      |
| WebSocket events   | > 1000/s           | ✅ WebSocket Tests   |
| Concurrent users   | 10+ users          | ✅ Integration Tests |
| Memory usage       | < 50MB             | ✅ Performance Tests |

### Regression Prevention

The test suite specifically prevents:

- ✅ TypeError when API returns non-array data
- ✅ "No objects to cancel" when items exist
- ✅ Processing continues after cancel request
- ✅ 404 errors from cancelled segmentation
- ✅ Race conditions between cancel types
- ✅ Unauthorized access to other users' queues
- ✅ Memory leaks in large operations

## Conclusion

This comprehensive test suite ensures the cancel functionality works reliably across all user scenarios. The tests follow TDD principles, provide extensive coverage, and include performance and security validation.

**Next Steps After Testing:**

1. Implement the actual cancel functionality to make tests pass
2. Run continuous integration pipeline
3. Monitor production performance metrics
4. Update tests as new features are added

**For Support:**

- Check test output logs for specific failure details
- Use debug commands to investigate issues
- Refer to mock utilities for test data generation
- Ensure Docker environment is properly configured

---

_Generated for SpheroSeg Cell Segmentation Hub_
_Following TDD principles - Write tests first, implement to pass_

## Running All Tests at Once

```bash
# Frontend tests
docker exec -it spheroseg-frontend npm run test src/pages/__tests__/ProjectDetail.cancel.test.tsx

# Backend tests (run in sequence to avoid conflicts)
docker exec -it spheroseg-backend npm run test backend/src/api/controllers/__tests__/queueController.cancel.test.ts
docker exec -it spheroseg-backend npm run test backend/src/services/__tests__/queueService.cancel.test.ts
docker exec -it spheroseg-backend npm run test backend/src/services/__tests__/websocket.queueCancellation.test.ts
docker exec -it spheroseg-backend npm run test backend/src/test/integration/queueCancellation.test.ts
docker exec -it spheroseg-backend npm run test backend/src/test/performance/cancelPerformance.test.ts
docker exec -it spheroseg-backend npm run test backend/src/test/security/cancelSecurity.test.ts

# Generate coverage report
docker exec -it spheroseg-frontend npm run test:coverage
docker exec -it spheroseg-backend npm run test:coverage
```
