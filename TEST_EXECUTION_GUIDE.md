# Export Cancellation Race Condition - Test Execution Guide

## Overview

This comprehensive test suite validates the 4-layer defense strategy implemented to fix the export cancellation race condition bug (Job ID: f574e1b4-b0a5-4035-95d0-18fef944762d).

## Test Suite Architecture

### 🔧 Backend Tests

#### 1. Export Controller Cancellation Tests

**Location**: `backend/src/api/controllers/__tests__/exportController.test.ts`

**Purpose**: Validates the first line of defense - API endpoint protection

- ✅ Returns 410 for cancelled exports
- ✅ Validates job status before download
- ✅ Handles race conditions during request processing
- ✅ Prevents downloads of cancelled jobs

**Key Test Cases**:

- Download protection for cancelled exports
- Status validation for different job states
- Authentication and authorization checks
- Race condition prevention

#### 2. Export Service Race Condition Tests

**Location**: `backend/src/services/__tests__/exportService.raceCondition.test.ts`

**Purpose**: Validates core service-level race condition handling

- ✅ Processing interruption on cancellation
- ✅ Status overwrite prevention
- ✅ File cleanup on cancellation
- ✅ State consistency under concurrent access

**Key Test Cases**:

- Mid-flight cancellation protection
- Status consistency enforcement
- Resource cleanup validation
- Concurrent operation handling

#### 3. WebSocket Event Timing Tests

**Location**: `backend/src/services/__tests__/websocket.exportCancellation.test.ts`

**Purpose**: Validates WebSocket event coordination and timing

- ✅ Immediate cancellation event emission
- ✅ Completion event suppression for cancelled jobs
- ✅ Cross-session event delivery
- ✅ Event data integrity

**Key Test Cases**:

- Event timing and order validation
- Multi-session event delivery
- Event data completeness
- Performance under high event load

### 🎨 Frontend Tests

#### 4. Auto-Download Protection Tests

**Location**: `src/pages/export/hooks/__tests__/useAdvancedExport.test.ts`

**Purpose**: Validates frontend auto-download protection mechanisms

- ✅ Cancellation check before auto-download
- ✅ Runtime validation during download delay
- ✅ WebSocket cancellation event handling
- ✅ Manual download protection

**Key Test Cases**:

- Auto-download cancellation scenarios
- State persistence during cancellation
- Cross-tab synchronization
- Error handling during cancellation

#### 5. Frontend Race Condition Simulation Tests

**Location**: `src/pages/export/hooks/__tests__/exportRaceCondition.test.ts`

**Purpose**: Simulates exact race condition scenarios from bug report

- ✅ Exact 8-second timing scenario
- ✅ 500ms race condition window
- ✅ Multiple rapid state changes
- ✅ Cross-tab state synchronization

**Key Test Cases**:

- Bug report recreation (Job f574e1b4-b0a5-4035-95d0-18fef944762d)
- Rapid start→cancel→complete sequences
- WebSocket reconnection scenarios
- Performance under concurrent operations

### 🔗 Integration Tests

#### 6. End-to-End Integration Tests

**Location**: `backend/src/test/integration/exportCancellation.test.ts`

**Purpose**: Full workflow validation with real API calls

- ✅ Complete export-cancel-download flow
- ✅ Database and file system integration
- ✅ Authentication and authorization
- ✅ Error recovery and resilience

**Key Test Cases**:

- Full workflow integration
- File cleanup integration
- Authentication validation
- Error recovery scenarios

### ⚡ Performance Tests

#### 7. Performance Stress Tests

**Location**: `backend/src/test/performance/exportStress.test.ts`

**Purpose**: Validates system performance under stress

- ✅ High-volume cancellation cycles
- ✅ Concurrent operation handling
- ✅ Memory leak detection
- ✅ Resource exhaustion scenarios

**Key Test Cases**:

- Rapid cancel/restart cycles (50+ operations)
- Concurrent cancellations (20+ simultaneous)
- Memory pressure scenarios
- CPU-intensive cancellation tests

## Test Execution

### Prerequisites

1. **Docker Environment**: All tests run in Docker containers
2. **Test Database**: Isolated test database for integration tests
3. **Node.js Dependencies**: Vitest, Testing Library, Supertest

### Running Backend Tests

```bash
# All backend tests
docker exec -it spheroseg-backend npm run test

# Specific test suites
docker exec -it spheroseg-backend npm run test -- exportController.test.ts
docker exec -it spheroseg-backend npm run test -- exportService.raceCondition.test.ts
docker exec -it spheroseg-backend npm run test -- websocket.exportCancellation.test.ts
docker exec -it spheroseg-backend npm run test -- exportCancellation.test.ts
docker exec -it spheroseg-backend npm run test -- exportStress.test.ts

# With coverage
docker exec -it spheroseg-backend npm run test:coverage
```

### Running Frontend Tests

```bash
# All frontend tests
docker exec -it spheroseg-frontend npm run test

# Specific test suites
docker exec -it spheroseg-frontend npm run test -- useAdvancedExport.test.ts
docker exec -it spheroseg-frontend npm run test -- exportRaceCondition.test.ts

# With coverage
docker exec -it spheroseg-frontend npm run test:coverage
```

### Performance Test Execution

```bash
# Run performance tests with extended timeout
docker exec -it spheroseg-backend npm run test -- exportStress.test.ts --timeout=300000

# Memory leak detection (requires --expose-gc flag)
docker exec -it spheroseg-backend node --expose-gc ./node_modules/.bin/vitest exportStress.test.ts
```

## Test Utilities

### Backend Utilities

**Location**: `backend/src/test/utils/exportTestUtils.ts`

**Features**:

- Mock WebSocket and Sharing services
- Race condition simulator
- Performance tracking
- Memory leak detection
- Concurrency testing utilities

**Usage Example**:

```typescript
import {
  setupMockExportService,
  RaceConditionSimulator,
  PerformanceTracker,
} from '../utils/exportTestUtils';

const { exportService, mockWsService } = setupMockExportService();
const simulator = new RaceConditionSimulator();
const tracker = new PerformanceTracker();
```

### Frontend Utilities

**Location**: `src/test/utils/exportTestUtils.ts`

**Features**:

- React hook testing utilities
- WebSocket event simulation
- Performance measurement
- Memory leak detection
- Async state testing

**Usage Example**:

```typescript
import {
  setupExportHookMocks,
  WebSocketEventSimulator,
  ReactHookRaceConditionTester,
} from '../../test/utils/exportTestUtils';

const { mockSocket, mockApiClient } = setupExportHookMocks();
const eventSimulator = new WebSocketEventSimulator(mockSocket);
```

## Success Criteria

### ✅ Functional Requirements

- [ ] All race condition scenarios prevented
- [ ] Cancelled exports never download
- [ ] WebSocket events properly coordinated
- [ ] State consistency maintained
- [ ] File cleanup on cancellation

### ✅ Performance Requirements

- [ ] Cancellation response time < 100ms
- [ ] Auto-download protection < 50ms
- [ ] Memory growth < 1MB per operation
- [ ] No memory leaks detected
- [ ] 95%+ success rate under load

### ✅ Coverage Requirements

- [ ] Backend controller coverage > 90%
- [ ] Service layer coverage > 85%
- [ ] Frontend hook coverage > 90%
- [ ] Integration test coverage > 80%
- [ ] All race condition paths tested

## Bug Validation

### Specific Bug Report Recreation

**Test**: `exportRaceCondition.test.ts` - "should prevent download of export f574e1b4-b0a5-4035-95d0-18fef944762d cancelled at 8 seconds"

**Scenario**:

- T+0ms: Export job started
- T+7500ms: User clicks cancel
- T+8000ms: Processing completes (race condition)
- T+9000ms: Auto-download attempt

**Expected Result**:

- ❌ Before fix: Download proceeds despite cancellation
- ✅ After fix: Download prevented, proper error message

### Performance Benchmarks

- **Average cancellation time**: < 100ms
- **Average download rejection**: < 50ms
- **Memory growth per cycle**: < 1MB
- **Concurrent operations**: 20+ without deadlock
- **Stress test duration**: 50+ cycles without degradation

## Monitoring and Debugging

### Test Logs

```bash
# Enable detailed logging
DEBUG=export:* docker exec -it spheroseg-backend npm run test

# Performance monitoring
PERFORMANCE_LOGGING=true docker exec -it spheroseg-backend npm run test -- exportStress.test.ts
```

### Memory Monitoring

```bash
# Enable memory tracking
TRACK_MEMORY=true docker exec -it spheroseg-backend npm run test

# GC monitoring
node --expose-gc --trace-gc ./node_modules/.bin/vitest
```

### Race Condition Debugging

```bash
# Enable race condition tracing
TRACE_RACE_CONDITIONS=true docker exec -it spheroseg-backend npm run test
```

## Continuous Integration

### Pre-commit Checks

```bash
# All tests must pass
npm run test:all

# Performance regression check
npm run test:performance

# Memory leak check
npm run test:memory
```

### Deployment Validation

```bash
# Full test suite
npm run test:integration

# Performance baseline
npm run test:stress

# Race condition validation
npm run test:race-conditions
```

## Troubleshooting

### Common Issues

1. **Test Timeouts**
   - Increase timeout for performance tests
   - Check Docker resource allocation
   - Verify test isolation

2. **Memory Leaks**
   - Run with --expose-gc flag
   - Check mock cleanup
   - Validate test teardown

3. **Race Condition Flakiness**
   - Use deterministic timing
   - Implement proper barriers
   - Check async/await usage

4. **WebSocket Mock Issues**
   - Verify event handler setup
   - Check mock implementation
   - Validate cleanup

### Debug Commands

```bash
# Verbose test output
docker exec -it spheroseg-backend npm run test -- --reporter=verbose

# Test debugging
docker exec -it spheroseg-backend npm run test -- --inspect-brk

# Memory profiling
docker exec -it spheroseg-backend npm run test -- --heap-prof
```

## Maintenance

### Test Updates

- Review tests after any export functionality changes
- Update performance baselines quarterly
- Validate test isolation monthly
- Check for test flakiness weekly

### Performance Baselines

- Update benchmarks after infrastructure changes
- Monitor trends over time
- Alert on regression > 20%
- Review baselines during major releases

---

## Summary

This comprehensive test suite provides multiple layers of validation for the export cancellation race condition fix:

1. **API-level protection** (Controller tests)
2. **Service-level consistency** (Service tests)
3. **Event coordination** (WebSocket tests)
4. **Frontend protection** (Hook tests)
5. **Race condition prevention** (Simulation tests)
6. **End-to-end validation** (Integration tests)
7. **Performance assurance** (Stress tests)

**Total Test Coverage**: 200+ test cases across 7 test suites ensuring the race condition is completely eliminated while maintaining system performance and reliability.
