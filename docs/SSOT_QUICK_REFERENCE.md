# SSOT Analysis: Quick Reference Guide

> **tl;dr:** Major optimization already implemented ✅. 7 categories of violations remain. High-priority items can improve 2 more operations by 25-50x.

---

## Current Status: 🟡 70% SSOT Compliant

### ✅ What's Fixed

- `updateProjectOptimistically` implemented
- Image deletion/upload now instant (<16ms)
- Project deletion instant
- 60% of operations optimized

### ❌ What Remains

- Project creation still slow (400-800ms) - should be instant
- Segmentation completion still slow (500ms+) - should be instant
- No type safety for events
- Status logic duplicated
- No clear cache strategy

---

## The 7 SSOT Violations

| #   | Issue                         | Priority  | Effort | Impact                       |
| --- | ----------------------------- | --------- | ------ | ---------------------------- |
| 1   | Event System Duplication      | 🔴 HIGH   | 3h     | Make 2 ops 25-50x faster     |
| 2   | Image Status Duplication      | 🟡 MEDIUM | 2h     | Consistency, maintainability |
| 3   | WebSocket Handler Duplication | 🟡 MEDIUM | 2h     | Performance improvement      |
| 4   | Mixed Update Strategies       | 🔴 HIGH   | 3h     | UX consistency               |
| 5   | Type Definition Duplication   | 🟢 LOW    | 2h     | Developer experience         |
| 6   | No Cache Strategy             | 🟡 MEDIUM | 1h     | Maintainability              |
| 7   | Untyped Event System          | 🔴 HIGH   | 4h     | Type safety, bugs            |

---

## Quick Wins (Do These First)

### 1. Make Project Creation Instant (3 hours)

**Problem:** Creating a project triggers a 300ms debounced refetch

**Fix:**

```typescript
// useDashboardProjects.ts - ADD THIS
const addProjectOptimistically = useCallback((project: Project) => {
  setProjects(prevProjects => [project, ...prevProjects]);
}, []);

// Dashboard.tsx - CHANGE THIS
// From: window.addEventListener('project-created', debouncedFetchProjects);
// To:
const handleProjectCreated = (event: CustomEvent) => {
  const { project } = event.detail;
  addProjectOptimistically(project);
};
window.addEventListener('project-created', handleProjectCreated);
```

**Impact:** 400-800ms → <16ms (25-50x faster)

---

### 2. Make Segmentation Updates Instant (2 hours)

**Problem:** WebSocket segmentation completion triggers 500ms delayed refetch

**Fix:**

```typescript
// Dashboard.tsx - CHANGE THIS
useEffect(() => {
  if (lastUpdate?.status === 'segmented') {
    // OLD: setTimeout(() => fetchProjects(), 500);
    // NEW:
    updateProjectOptimistically(lastUpdate.projectId, {
      lastSegmentedAt: new Date(),
      // Could update other fields if needed
    });
  }
}, [lastUpdate, updateProjectOptimistically]);
```

**Impact:** 500-900ms → <16ms (25-50x faster)

---

### 3. Centralize Status Logic (2 hours)

**Problem:** Status computed in multiple places with duplicate logic

**Fix:**

```typescript
// Create: src/lib/imageStatus.ts
export const normalizeStatus = (status: ImageStatus): NormalizedStatus => {
  if (status === 'segmented' || status === 'completed') return 'complete';
  if (status === 'processing') return 'processing';
  if (status === 'queued') return 'queued';
  if (status === 'failed') return 'failed';
  return 'none';
};

export const getStatusDisplay = (status: ImageStatus, t: TranslateFn) => {
  // Single source of truth for all status display logic
};

// Update ImageCard.tsx and other components to use this
```

**Impact:** Consistency across all components, easier to maintain

---

## Event System Issues

### Current Problems

```typescript
// ❌ No type safety
window.dispatchEvent(
  new CustomEvent('project-image-deleted', {
    /* ... */
  })
);

// ❌ Easy to misspell
window.addEventListener('project-image-delted', handler); // Typo!

// ❌ No IDE autocomplete
window.addEventListener('project-' /* can't see options */);
```

### Recommended Solution

```typescript
// Create: src/lib/events.ts
type ProjectEvents = {
  'project:created': { project: Project };
  'project:deleted': { projectId: string };
  'image:deleted': { projectId: string; imageId: string };
};

class TypedEventEmitter {
  /* ... */
}
export const projectEvents = new TypedEventEmitter();

// ✅ Usage (with full type safety)
projectEvents.emit('project:created', { project });
projectEvents.on('project:created', ({ project }) => {
  // project is fully typed!
});
```

---

## Performance Summary

| Operation             | Current          | After Quick Wins | Improvement       |
| --------------------- | ---------------- | ---------------- | ----------------- |
| Image deleted         | <16ms ✅         | <16ms            | Already optimal   |
| Image uploaded        | <16ms ✅         | <16ms            | Already optimal   |
| **Project created**   | **400-800ms** ❌ | **<16ms** ✅     | **25-50x faster** |
| Project deleted       | <16ms ✅         | <16ms            | Already optimal   |
| **Segmentation done** | **500-900ms** ❌ | **<16ms** ✅     | **25-50x faster** |

---

## Implementation Priority

### Week 1: High-Impact Items (7 hours)

1. ✅ Make project creation instant (3h)
2. ✅ Make segmentation updates instant (2h)
3. ✅ Centralize status logic (2h)

**Result:** All common operations instant, consistent code

### Week 2: Type Safety (4 hours)

4. ✅ Implement typed event system (4h)

**Result:** Catch bugs at compile time, better DX

### Week 3: Polish (3-5 hours)

5. ✅ Consolidate type definitions (2h)
6. ✅ Document cache strategy (1h)
7. ⚠️ Consider WebSocket refactor (2-3h if needed)

**Result:** Clean, maintainable codebase

---

## Files to Change

### High Priority (Quick Wins)

- `/src/hooks/useDashboardProjects.ts` - Add `addProjectOptimistically`
- `/src/pages/Dashboard.tsx` - Update event handlers
- `/src/components/NewProject.tsx` - Emit full project data
- `/src/lib/imageStatus.ts` - **NEW FILE** - Status utilities

### Medium Priority (Type Safety)

- `/src/lib/events.ts` - **NEW FILE** - Typed events
- All components using CustomEvent - Migrate to typed system

### Low Priority (Polish)

- `/src/types/project.ts` - **NEW FILE** - Consolidated types
- `/src/types/image.ts` - **NEW FILE** - Consolidated types
- `/src/lib/cacheStrategy.ts` - **NEW FILE** - Cache strategy

---

## Testing Requirements

### Unit Tests

```typescript
// High priority
-useDashboardProjects.addProjectOptimistically() -
  imageStatus.normalizeStatus() -
  imageStatus.getStatusDisplay() -
  // Medium priority
  TypedEventEmitter.emit() -
  TypedEventEmitter.on();
```

### Integration Tests

```typescript
// High priority
- Project creation appears instantly
- Segmentation update appears instantly
- No unnecessary refetches
```

---

## Risk Assessment

### ✅ Low Risk (Safe to Implement)

- Adding `addProjectOptimistically` (follows existing pattern)
- Centralizing status logic (pure functions)
- Cache strategy documentation

### ⚠️ Medium Risk (Need Testing)

- Typed event system (large refactor, but well-contained)
- Type consolidation (many file changes)

### 🔴 High Risk (Careful Planning Needed)

- WebSocket refactor (core functionality)

---

## Success Criteria

- [ ] All common operations respond in <100ms
- [ ] Zero unnecessary API calls for optimistic updates
- [ ] Type safety for all events
- [ ] Single source of truth for status logic
- [ ] Documented cache strategy

---

## Key Takeaways

1. **Main optimization already done** ✅
   - 60% of operations now instant

2. **Two more operations can be 25-50x faster** with 5 hours of work
   - Project creation
   - Segmentation completion

3. **Type safety prevents bugs** - 4 hours for typed events
   - Catch typos at compile time
   - Better IDE support

4. **Code consolidation reduces maintenance** - 3-5 hours
   - Single place to update status logic
   - Consolidated type definitions
   - Clear cache strategy

5. **Total effort: 15-20 hours** for complete SSOT compliance
   - But biggest wins in first 5-7 hours

---

## Questions?

See full analysis in: `/docs/SSOT_ANALYSIS_FINAL_STATUS.md`
