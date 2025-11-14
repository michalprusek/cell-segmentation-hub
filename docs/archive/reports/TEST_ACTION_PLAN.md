# Test Coverage Action Plan

**Generated:** 2025-10-07
**Current Coverage:** 85% (2,869 tests across 159 files)
**Target Coverage:** 95%
**Timeline:** 8 weeks

---

## Week 1: Critical Mobile UI Components (HIGH PRIORITY)

### Task 1.1: PolygonListPanel Tests ⚠️ CRITICAL
**File:** `/src/pages/segmentation/components/__tests__/PolygonListPanel.test.tsx`
**Estimated Time:** 3-4 hours
**Impact:** HIGH - Mobile UI, user-facing

**Test Scenarios:**
```typescript
describe('PolygonListPanel', () => {
  // Rendering tests
  it('renders empty state correctly')
  it('renders list with polygons')
  it('shows loading state')
  it('displays polygon count')

  // Interaction tests
  it('selects polygon on click')
  it('renames polygon')
  it('confirms rename with Enter key')
  it('cancels rename with Escape')
  it('deletes polygon with confirmation')
  it('toggles polygon visibility')

  // Edge cases
  it('handles long polygon names')
  it('handles rapid selection changes')
  it('maintains scroll position')
  it('handles empty polygon name')

  // Mobile specific
  it('responds to touch events')
  it('shows mobile-optimized controls')
})
```

**Files to Reference:**
- `/src/pages/segmentation/components/__tests__/CanvasPolygon.test.tsx` (similar patterns)
- `/src/test-utils/polygonTestUtils.ts` (test data)
- `/src/test-utils/reactTestUtils.tsx` (mobile testing utilities)

**Acceptance Criteria:**
- [ ] 12+ tests covering all interactions
- [ ] Mobile responsiveness tested
- [ ] Accessibility tested
- [ ] Edge cases covered
- [ ] All tests passing
- [ ] Coverage > 85%

---

### Task 1.2: MobileMenu Tests ⚠️ CRITICAL
**File:** `/src/components/header/__tests__/MobileMenu.test.tsx`
**Estimated Time:** 2-3 hours
**Impact:** HIGH - Mobile navigation

**Test Scenarios:**
```typescript
describe('MobileMenu', () => {
  // Rendering tests
  it('renders menu button')
  it('opens menu on button click')
  it('closes menu on backdrop click')
  it('closes menu on item selection')

  // Navigation tests
  it('shows correct links when logged out')
  it('shows correct links when logged in')
  it('navigates to selected route')
  it('closes menu after navigation')

  // Authentication state
  it('shows login button when logged out')
  it('shows logout button when logged in')
  it('shows user profile link when logged in')
  it('handles logout correctly')

  // Accessibility
  it('is keyboard navigable')
  it('has proper ARIA labels')
  it('traps focus when open')

  // Mobile specific
  it('responds to swipe gestures')
  it('shows mobile-optimized layout')
})
```

**Files to Reference:**
- `/src/components/__tests__/Navbar.test.tsx` (navigation patterns)
- `/src/contexts/__tests__/AuthContext.test.tsx` (auth state mocking)

**Acceptance Criteria:**
- [ ] 15+ tests covering all states
- [ ] Authentication scenarios tested
- [ ] Keyboard navigation tested
- [ ] Mobile gestures tested
- [ ] All tests passing
- [ ] Coverage > 90%

---

### Task 1.3: Clean Up Debug Statements
**Files:** 5 frontend test files, ML service tests
**Estimated Time:** 1 hour
**Impact:** MEDIUM - Code quality

**Files to Clean:**
1. `/src/pages/segmentation/__tests__/PolygonPerformanceRegression.test.tsx` (lines 552, 617)
2. `/src/pages/segmentation/__tests__/PolygonIdValidation.test.tsx` (lines 24, 74, 88)
3. ML service tests (~40 print statements)

**Action:**
```bash
# Find all console.log
grep -rn "console\.log" ./src --include="*.test.ts" --include="*.test.tsx"

# Find all print statements
grep -rn "print(" ./backend/segmentation/tests --include="*.py"
```

**Replace with:**
- Frontend: Remove or use proper test debugging
- ML: Replace with `logging.debug()` or remove

**Acceptance Criteria:**
- [ ] Zero console.log in frontend tests
- [ ] ML print statements replaced with logging
- [ ] All tests still passing
- [ ] No debug output in CI

---

### Task 1.4: Fix Skipped Tests
**Files:** 4 skipped tests
**Estimated Time:** 2-3 hours
**Impact:** MEDIUM - Test coverage

**Tests to Fix:**
1. **src/components/__tests__/NewProject.test.tsx:18**
   - Currently: `describe.skip('NewProject', () => {`
   - Action: Investigate why skipped, fix or document

2. **backend/src/services/metrics/__tests__/metricsCalculator.test.ts:254**
   - Currently: `it.skip('should generate correct units in Excel export'`
   - Action: Implement Excel export units test

3. **backend/segmentation/tests/unit/ml/test_parallel_inference.py:334**
   - Currently: `@pytest.mark.skipif(not torch.cuda.is_available())`
   - Action: Document as expected (CUDA-conditional)

4. **tests/performance/segmentation-performance.spec.ts**
   - Action: Investigate and fix or document

**Acceptance Criteria:**
- [ ] All non-conditional skips removed
- [ ] Tests fixed or documented
- [ ] All tests passing
- [ ] Zero unexplained skips

---

**Week 1 Deliverables:**
- ✅ PolygonListPanel fully tested (12+ tests)
- ✅ MobileMenu fully tested (15+ tests)
- ✅ All debug statements removed
- ✅ All skipped tests fixed/documented
- ✅ Coverage increased by ~2%

**Total Estimated Time:** 10-12 hours

---

## Week 2-3: Segmentation Editor UI Components

### Task 2.1: EnhancedSegmentationEditor Tests ⚠️ HIGH PRIORITY
**File:** `/src/pages/segmentation/components/__tests__/EnhancedSegmentationEditor.test.tsx`
**Estimated Time:** 6-8 hours
**Impact:** HIGH - Main editor component

**Test Categories:**
1. **Initial Load (4 tests)**
   - Renders loading state
   - Loads segmentation data
   - Handles load errors
   - Shows empty state

2. **Mode Management (6 tests)**
   - Switches between modes (View, Edit, Add, Delete, Slice)
   - Maintains mode state
   - Disables invalid mode transitions
   - Shows correct mode UI

3. **Polygon Operations (8 tests)**
   - Creates new polygon
   - Selects polygon
   - Edits polygon vertices
   - Deletes polygon
   - Renames polygon
   - Toggles polygon visibility
   - Handles undo/redo
   - Validates polygon operations

4. **WebSocket Updates (4 tests)**
   - Receives real-time updates
   - Updates polygon list
   - Shows update notifications
   - Handles connection errors

5. **Save/Export (4 tests)**
   - Saves changes
   - Exports data
   - Handles save errors
   - Shows save confirmation

6. **Performance (3 tests)**
   - Handles large polygon counts (500+)
   - Renders efficiently
   - Doesn't cause memory leaks

**Acceptance Criteria:**
- [ ] 29+ comprehensive tests
- [ ] All modes tested
- [ ] WebSocket integration tested
- [ ] Performance tests included
- [ ] Coverage > 80%

---

### Task 2.2: SegmentationErrorBoundary Tests ⚠️ HIGH PRIORITY
**File:** `/src/pages/segmentation/components/__tests__/SegmentationErrorBoundary.test.tsx`
**Estimated Time:** 1-2 hours
**Impact:** HIGH - Error handling

**Test Scenarios:**
```typescript
describe('SegmentationErrorBoundary', () => {
  it('renders children when no error')
  it('catches rendering errors')
  it('catches lifecycle errors')
  it('displays error UI')
  it('logs error to monitoring service')
  it('provides recovery options')
  it('resets state on recovery')
  it('handles nested errors')
})
```

**Acceptance Criteria:**
- [ ] 8+ tests covering error scenarios
- [ ] Error logging tested
- [ ] Recovery tested
- [ ] All tests passing

---

### Task 2.3: Editor Toolbar Tests
**Files:**
- EnhancedEditorToolbar.test.tsx
- TopToolbar.test.tsx
- VerticalToolbar.test.tsx

**Estimated Time:** 4-6 hours total
**Impact:** MEDIUM - UI controls

**Combined Tests:** ~25-30 tests covering:
- Mode selection buttons
- Tool activation
- Keyboard shortcuts
- Disabled states
- Tooltips
- Mobile layout

---

**Week 2-3 Deliverables:**
- ✅ EnhancedSegmentationEditor tested (29+ tests)
- ✅ SegmentationErrorBoundary tested (8+ tests)
- ✅ All editor toolbars tested (25-30 tests)
- ✅ Coverage increased by ~3%

**Total Estimated Time:** 15-20 hours

---

## Week 4: Header & Supporting Components

### Task 3.1: Header Components Tests
**Files:**
- NotificationsDropdown.test.tsx (3 hours)
- UserProfileDropdown.test.tsx (2 hours)
- Logo.test.tsx (1 hour)

**Total Tests:** ~20-25 tests
**Impact:** MEDIUM - Navigation components

### Task 3.2: Supporting Components Tests
**Files:**
- RegionPanel.test.tsx (2-3 hours)
- StatusBar.test.tsx (1-2 hours)
- EditorHelpTips.test.tsx (1-2 hours)
- KeyboardShortcutsHelp.test.tsx (1-2 hours)

**Total Tests:** ~15-20 tests
**Impact:** MEDIUM - Editor support

---

**Week 4 Deliverables:**
- ✅ All header components tested
- ✅ Editor support components tested
- ✅ Coverage increased by ~2%

**Total Estimated Time:** 12-15 hours

---

## Week 5-6: Test Quality Improvements

### Task 4.1: Refactor High-Assertion Tests
**Files to Refactor:**
1. metricsCalculator.test.ts (57 assertions / 13 tests = 4.4 avg)
2. webSocketIntegration.test.ts (55 assertions / 19 tests = 2.9 avg)
3. AuthContext.test.tsx (56 assertions / 21 tests = 2.7 avg)

**Estimated Time:** 2-3 hours per file
**Impact:** MEDIUM - Test maintainability

**Strategy:**
- Split tests with 4+ assertions into multiple focused tests
- Extract common setup into beforeEach
- Use test.each for parameterized tests

**Example Refactor:**
```typescript
// BEFORE
it('calculates all metrics correctly', () => {
  expect(metrics.area).toBe(100);
  expect(metrics.perimeter).toBe(40);
  expect(metrics.centroid).toEqual({ x: 50, y: 50 });
  expect(metrics.feretDiameter).toBe(14.14);
  // ... 10 more assertions
});

// AFTER
describe('Metric Calculations', () => {
  it('calculates area correctly', () => {
    expect(metrics.area).toBe(100);
  });

  it('calculates perimeter correctly', () => {
    expect(metrics.perimeter).toBe(40);
  });

  it('calculates centroid correctly', () => {
    expect(metrics.centroid).toEqual({ x: 50, y: 50 });
  });
  // ... separate focused tests
});
```

---

### Task 4.2: Fix Flaky Test Patterns
**Files with setTimeout Issues:**
1. webSocketRealtimeWorkflows.test.ts (9 setTimeout calls)
2. QueueStatsPanel.cancel.test.tsx (2 setTimeout calls)
3. ImageUploader.cancel.test.tsx (2 setTimeout calls)
4. DashboardHeader.test.tsx (setInterval usage)

**Estimated Time:** 4-6 hours total
**Impact:** HIGH - Test reliability

**Strategy:**
```typescript
// BEFORE (Flaky)
it('updates after delay', () => {
  setTimeout(() => {
    expect(value).toBe('updated');
  }, 100);
});

// AFTER (Reliable)
it('updates after delay', async () => {
  await waitFor(() => {
    expect(value).toBe('updated');
  }, { timeout: 1000 });
});

// OR use fake timers
it('updates after delay', () => {
  vi.useFakeTimers();
  updateWithDelay();
  vi.advanceTimersByTime(100);
  expect(value).toBe('updated');
  vi.useRealTimers();
});
```

---

### Task 4.3: Add Missing Test Documentation
**Estimated Time:** 2-3 hours
**Impact:** LOW - Developer experience

**Actions:**
- Add JSDoc comments to complex test utilities
- Document test data factories
- Create test writing guidelines
- Document mock strategies

---

**Week 5-6 Deliverables:**
- ✅ 3 high-assertion test files refactored
- ✅ 4 flaky test files fixed
- ✅ Test utilities documented
- ✅ Test stability improved

**Total Estimated Time:** 12-15 hours

---

## Week 7-8: ML Service & Final Gaps

### Task 5.1: Expand ML Service Coverage
**Estimated Time:** 4-6 hours
**Impact:** MEDIUM - ML reliability

**New Tests Needed:**
1. **Model Switching** (test_model_switching.py)
   - Switch between HRNet, CBAM-ResUNet, U-Net
   - Validate output consistency
   - Test memory cleanup

2. **Edge Cases** (test_edge_cases.py)
   - Very large images (>4K)
   - Very small images (<100px)
   - Corrupted images
   - Out of memory scenarios

3. **Concurrent Processing** (test_concurrent_processing.py)
   - Multiple simultaneous requests
   - Queue management
   - Resource contention

**Total New Tests:** ~15-20 tests

---

### Task 5.2: Main UI Components
**Files:**
- LazyComponentWrapper.test.tsx
- LoadingSpinner.test.tsx
- PageLoadingFallback.test.tsx
- PageTransition.test.tsx
- ProjectSelector.test.tsx

**Estimated Time:** 3-4 hours total
**Impact:** LOW - Simple components

**Total Tests:** ~12-15 tests

---

### Task 5.3: Remaining Segmentation Components
**Files:**
- PolygonItem.test.tsx (1-2 hours)

**Estimated Time:** 1-2 hours
**Impact:** LOW - Small component

---

**Week 7-8 Deliverables:**
- ✅ ML service coverage expanded
- ✅ All main UI components tested
- ✅ Final segmentation components tested
- ✅ Coverage target reached (95%)

**Total Estimated Time:** 10-12 hours

---

## Summary Timeline

| Week | Focus | Tests Added | Time | Coverage Gain |
|------|-------|-------------|------|---------------|
| 1 | Critical Mobile UI | 27+ | 10-12h | +2% |
| 2-3 | Segmentation Editor | 60+ | 15-20h | +3% |
| 4 | Header & Support | 40+ | 12-15h | +2% |
| 5-6 | Quality Improvements | - | 12-15h | +1% |
| 7-8 | ML & Final Gaps | 30+ | 10-12h | +2% |
| **Total** | | **~160 tests** | **60-75h** | **+10%** |

**Current Coverage:** 85% (2,869 tests)
**Target Coverage:** 95% (3,030+ tests)
**Tests to Add:** ~160 tests
**Total Effort:** 60-75 hours (1.5-2 months at 10h/week)

---

## Success Metrics

### Quantitative
- [ ] Test count: 3,030+ (current: 2,869)
- [ ] Coverage: 95%+ (current: 85%)
- [ ] Zero skipped tests (current: 4)
- [ ] Zero debug statements (current: 45)
- [ ] Zero flaky tests (current: ~4 files)

### Qualitative
- [ ] All critical UI components tested
- [ ] All user workflows covered by E2E
- [ ] Test execution time < 10 minutes
- [ ] Test reliability > 99% (no flaky failures)
- [ ] Clear test documentation available

---

## Risk Mitigation

### Risks & Mitigation Strategies

1. **Risk:** Tests take longer than estimated
   - **Mitigation:** Start with highest priority items first (Week 1)
   - **Buffer:** 8-week timeline with built-in flexibility

2. **Risk:** Flaky tests are hard to fix
   - **Mitigation:** Use proper async utilities (waitFor, findBy)
   - **Fallback:** Document flaky tests, run multiple times in CI

3. **Risk:** Coverage targets not met
   - **Mitigation:** Focus on critical paths first
   - **Acceptance:** 90% coverage still excellent

4. **Risk:** Tests become maintenance burden
   - **Mitigation:** Write focused, simple tests
   - **Strategy:** Prefer integration tests over unit tests for UI

---

## Post-Implementation Review

### After Week 4 (Checkpoint 1)
- Review progress
- Adjust timeline if needed
- Celebrate wins
- Address blockers

### After Week 8 (Final Review)
- Measure final coverage
- Document remaining gaps
- Create maintenance plan
- Update CI/CD pipelines

---

## Maintenance Plan (Ongoing)

### New Feature Testing
- **Requirement:** All new features must have tests
- **Review:** Test coverage checked in PR reviews
- **CI:** Tests must pass before merge

### Test Quality Reviews
- **Frequency:** Quarterly
- **Focus:** Remove obsolete tests, refactor complex tests
- **Goal:** Maintain >95% coverage

### Flaky Test Monitoring
- **Tool:** Track test failures in CI
- **Action:** Fix or disable flaky tests within 1 week
- **Goal:** <1% flaky test rate

---

**Next Steps:**
1. Review this plan with team
2. Assign tasks to team members
3. Start Week 1 tasks immediately
4. Track progress weekly
5. Adjust plan as needed

---

**Related Documents:**
- TEST_FILE_MAPPING_REPORT.md - Complete test inventory
- TEST_COVERAGE_SUMMARY.md - Quick reference
- TEST_INTEGRATION_MAPPING.md - Integration guide
