# SSOT Analysis: Project List Updates Without Full Refetch

**Analysis Date:** 2025-10-13
**Scope:** Updating individual projects in Dashboard project list (specifically imageCount)
**Current Issue:** Dashboard performs full refetch when images are deleted, instead of updating count optimistically

---

## Executive Summary

The codebase has **one established optimistic update pattern** (`removeProjectOptimistically`) but **lacks a general-purpose method** for updating individual project properties. This analysis identifies existing patterns and provides a roadmap for implementing proper SSOT-compliant project updates.

---

## 1. Current Update Methods in `useDashboardProjects`

### Existing Methods

| Method                        | Purpose                   | Implementation                |
| ----------------------------- | ------------------------- | ----------------------------- |
| `removeProjectOptimistically` | Remove project from list  | ✅ Implemented (line 370-374) |
| `updateProjectOptimistically` | Update project properties | ❌ **MISSING**                |
| `updateProjectImageCount`     | Decrement/increment count | ❌ **MISSING**                |

### Current Implementation (removeProjectOptimistically)

```typescript
// Line 370-374 in useDashboardProjects.ts
const removeProjectOptimistically = useCallback((projectId: string) => {
  setProjects(prevProjects =>
    prevProjects.filter(project => project.id !== projectId)
  );
}, []);
```

**Pattern Identified:** Uses `setProjects` with functional update + filter

---

## 2. Optimistic Update Patterns Found

### Pattern A: useProjectData - Image Updates (Most Relevant)

**Location:** `/src/hooks/useProjectData.tsx:433-445`

```typescript
setImages(prevImages =>
  prevImages.map(img => {
    if (img.id === imageId) {
      return {
        ...img,
        segmentationResult: {
          polygons: segmentationData.polygons || [],
          imageWidth: segmentationData.imageWidth || img.width || null,
          // ... other properties
        },
      };
    }
    return img;
  })
);
```

**Key Features:**

- ✅ Functional state update with `prevImages`
- ✅ Immutable update using spread operator
- ✅ Conditional transformation with `img.id === imageId`
- ✅ Returns unchanged items as-is for performance

### Pattern B: useProjectImageActions - Status Updates

**Location:** `/src/hooks/useProjectImageActions.tsx:83-88`

```typescript
const updatedImages = imagesRef.current.map(img =>
  img.id === imageId
    ? { ...img, segmentationStatus: 'processing' as const }
    : img
);
onImagesChange(updatedImages);
```

**Key Features:**

- ✅ Uses ternary for concise conditional update
- ✅ Immutable spread syntax
- ⚠️ Uses ref instead of state (edge case pattern)

### Pattern C: useDashboardProjects - Remove Project

**Location:** `/src/hooks/useDashboardProjects.ts:370-374`

```typescript
const removeProjectOptimistically = useCallback((projectId: string) => {
  setProjects(prevProjects =>
    prevProjects.filter(project => project.id !== projectId)
  );
}, []);
```

**Key Features:**

- ✅ Functional update
- ✅ Immutable filter operation
- ✅ Wrapped in `useCallback` for performance

---

## 3. Event System Analysis

### Custom Events Found

| Event Name               | Emitted By                 | Listened By             | Purpose                     |
| ------------------------ | -------------------------- | ----------------------- | --------------------------- |
| `project-created`        | NewProject.tsx             | Dashboard.tsx           | Trigger full refetch        |
| `project-deleted`        | ProjectActions.tsx         | Dashboard.tsx           | Trigger full refetch        |
| `project-unshared`       | ProjectActions.tsx         | Dashboard.tsx           | Trigger full refetch        |
| `project-images-updated` | ❓ Not found               | Dashboard.tsx           | Trigger full refetch        |
| `project-image-deleted`  | useProjectImageActions.tsx | Dashboard.tsx           | **Trigger full refetch** ⚠️ |
| `project-refetch-needed` | ProjectActions.tsx         | useDashboardProjects.ts | Force refetch on error      |

### Event Pattern Analysis

**Location:** `/src/pages/Dashboard.tsx:143-159`

```typescript
useEffect(() => {
  const debouncedFetchProjects = (() => {
    let timeoutId: NodeJS.Timeout;
    return () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fetchProjects(); // ⚠️ Full refetch every time
      }, 300);
    };
  })();

  const handleProjectUpdate = debouncedFetchProjects;

  window.addEventListener('project-created', handleProjectUpdate);
  window.addEventListener('project-deleted', handleProjectUpdate);
  window.addEventListener('project-unshared', handleProjectUpdate);
  window.addEventListener('project-images-updated', handleProjectUpdate);
  window.addEventListener('project-image-deleted', handleProjectUpdate); // ⚠️ PROBLEM

  return () => {
    /* cleanup */
  };
}, [fetchProjects]);
```

**Problem Identified:**

- ❌ All events trigger **full refetch** (expensive)
- ❌ `project-image-deleted` causes unnecessary API call
- ❌ No distinction between events requiring full vs. partial updates

---

## 4. Similar Successful Patterns in Codebase

### WebSocket Status Updates (No Full Refetch)

**Location:** `/src/pages/Dashboard.tsx:162-174`

```typescript
useEffect(() => {
  if (
    lastUpdate &&
    (lastUpdate.status === 'segmented' ||
      lastUpdate.status === 'no_segmentation')
  ) {
    const timer = setTimeout(() => {
      fetchProjects(); // Only refetch after segmentation complete
    }, 500);
    return () => clearTimeout(timer);
  }
}, [lastUpdate, fetchProjects]);
```

**Note:** Even this could be optimized to update count instead of full refetch

---

## 5. Type Definitions

### Project Type (Dashboard)

**Location:** `/src/components/ProjectsList.tsx:10-22`

```typescript
export interface Project {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number; // ⭐ This is what we need to update
  isOwned?: boolean;
  isShared?: boolean;
  sharedBy?: { email: string };
  owner?: { email: string; name?: string };
  shareId?: string;
}
```

**Note:** `imageCount` is a simple numeric property - perfect for optimistic updates

---

## 6. SSOT Compliance Assessment

### Single Source of Truth Map

| Data            | Source of Truth                       | Update Method     | SSOT Status       |
| --------------- | ------------------------------------- | ----------------- | ----------------- |
| Project List    | `useDashboardProjects.projects` state | `setProjects`     | ✅ Single source  |
| Project Removal | `removeProjectOptimistically`         | Optimistic filter | ✅ SSOT compliant |
| Project Update  | ❌ N/A - Uses full refetch            | API refetch       | ❌ **VIOLATION**  |
| Image Count     | Backend API                           | Full refetch      | ⚠️ Inefficient    |

### SSOT Violations

1. **No centralized update method** - Forces full refetch pattern
2. **Duplicate logic** - Each event handler could implement own update logic
3. **Inefficient data flow** - API call → Full array replacement for single property change

---

## 7. Missing Utilities

### Missing Methods (Need to Create)

```typescript
// ❌ MISSING - Should exist in useDashboardProjects
const updateProjectOptimistically = useCallback(
  (projectId: string, updates: Partial<Project>) => {
    setProjects(prevProjects =>
      prevProjects.map(project =>
        project.id === projectId ? { ...project, ...updates } : project
      )
    );
  },
  []
);

// ❌ MISSING - Convenience method for common operation
const decrementProjectImageCount = useCallback(
  (projectId: string) => {
    updateProjectOptimistically(projectId, {
      imageCount: Math.max(0, project.imageCount - 1),
    });
  },
  [updateProjectOptimistically]
);
```

### No Immutable Update Utilities Found

The codebase doesn't use libraries like:

- ❌ Immer
- ❌ Immutability-helper
- ❌ Custom immutable utilities

**Pattern Used:** Native JavaScript spread operators (appropriate for this use case)

---

## 8. Recommended Implementation Strategy

### Phase 1: Add Update Methods to useDashboardProjects

**Priority:** HIGH
**Effort:** LOW

```typescript
// Add to useDashboardProjects hook
const updateProjectOptimistically = useCallback(
  (projectId: string, updates: Partial<Project>) => {
    setProjects(prevProjects =>
      prevProjects.map(project =>
        project.id === projectId ? { ...project, ...updates } : project
      )
    );
  },
  []
);

const updateProjectImageCount = useCallback(
  (projectId: string, delta: number) => {
    setProjects(prevProjects =>
      prevProjects.map(project =>
        project.id === projectId
          ? {
              ...project,
              imageCount: Math.max(0, project.imageCount + delta),
            }
          : project
      )
    );
  },
  []
);
```

### Phase 2: Update Event Handlers in Dashboard

**Priority:** HIGH
**Effort:** LOW

```typescript
// Replace full refetch with optimistic update
useEffect(() => {
  const handleImageDeleted = (event: CustomEvent) => {
    const { projectId } = event.detail;
    updateProjectImageCount(projectId, -1); // Decrement by 1
  };

  window.addEventListener('project-image-deleted', handleImageDeleted);

  return () => {
    window.removeEventListener('project-image-deleted', handleImageDeleted);
  };
}, [updateProjectImageCount]);
```

### Phase 3: Update Event Emitters

**Priority:** MEDIUM
**Effort:** LOW

Ensure event payloads include necessary data:

```typescript
// In useProjectImageActions.tsx
const event = new CustomEvent('project-image-deleted', {
  detail: {
    projectId,
    imageId,
    delta: -1, // Optional: explicit count change
  },
});
```

### Phase 4: Add Fallback Refetch on Error

**Priority:** MEDIUM
**Effort:** LOW

```typescript
const updateProjectImageCount = useCallback(
  (projectId: string, delta: number) => {
    setProjects(prevProjects => {
      const project = prevProjects.find(p => p.id === projectId);

      // Validate: ensure project exists and count makes sense
      if (!project) {
        console.warn(`Project ${projectId} not found, triggering refetch`);
        fetchProjects();
        return prevProjects;
      }

      return prevProjects.map(p =>
        p.id === projectId
          ? { ...p, imageCount: Math.max(0, p.imageCount + delta) }
          : p
      );
    });
  },
  [fetchProjects]
);
```

---

## 9. Code Examples: Before vs After

### Before (Current Pattern)

```typescript
// Dashboard.tsx
window.addEventListener('project-image-deleted', handleProjectUpdate);
// → Triggers debouncedFetchProjects()
// → Calls fetchProjects()
// → Makes API call to /api/projects
// → Fetches ALL projects
// → Replaces entire projects array
// → Re-renders all project cards
```

**Issues:**

- ❌ 1 API call per image deletion
- ❌ Full array replacement causes re-renders
- ❌ 300ms delay before update (debounce)
- ❌ Network latency adds delay

### After (Optimized Pattern)

```typescript
// Dashboard.tsx
const handleImageDeleted = (event: CustomEvent) => {
  const { projectId } = event.detail;
  updateProjectImageCount(projectId, -1);
  // → Immediately updates count
  // → Only affected project re-renders
};

window.addEventListener('project-image-deleted', handleImageDeleted);
```

**Benefits:**

- ✅ Instant UI update (0ms)
- ✅ No API call needed
- ✅ Minimal re-renders (1 project card)
- ✅ Better UX

---

## 10. Reusable Patterns Identified

### Pattern: Functional State Update with Map

**Use Cases:** Update single item in array by ID

```typescript
setState(prevState =>
  prevState.map(item => (item.id === targetId ? { ...item, ...updates } : item))
);
```

**Found in:**

- ✅ useProjectData (line 434)
- ✅ useProjectImageActions (line 83)

### Pattern: Functional State Update with Filter

**Use Cases:** Remove single item from array by ID

```typescript
setState(prevState => prevState.filter(item => item.id !== targetId));
```

**Found in:**

- ✅ useDashboardProjects (line 372)

### Pattern: Debounced Event Handler

**Use Cases:** Prevent rapid-fire updates

```typescript
const debouncedHandler = (() => {
  let timeoutId: NodeJS.Timeout;
  return () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      // Handle event
    }, 300);
  };
})();
```

**Found in:**

- ✅ Dashboard.tsx (line 133)

---

## 11. Testing Considerations

### Existing Test Patterns

**Location:** `/src/components/__tests__/ProjectCallbackChain.test.tsx`

The codebase has tests for optimistic updates - ensure new methods follow same pattern:

```typescript
test('should update project optimistically', () => {
  const { result } = renderHook(() => useDashboardProjects(options));

  act(() => {
    result.current.updateProjectImageCount('project-1', -1);
  });

  expect(result.current.projects[0].imageCount).toBe(4); // was 5
});
```

---

## 12. Implementation Checklist

### Step 1: Create Update Methods

- [ ] Add `updateProjectOptimistically` to useDashboardProjects
- [ ] Add `updateProjectImageCount` to useDashboardProjects
- [ ] Export new methods from hook
- [ ] Add TypeScript types for update operations

### Step 2: Update Dashboard Event Handlers

- [ ] Replace `project-image-deleted` full refetch with `updateProjectImageCount`
- [ ] Add error handling for missing projects
- [ ] Keep fallback refetch for errors

### Step 3: Verify Event Emitters

- [ ] Ensure `project-image-deleted` includes projectId
- [ ] Verify event is emitted after successful deletion
- [ ] Check that multiple deletions work correctly

### Step 4: Testing

- [ ] Unit test `updateProjectOptimistically`
- [ ] Unit test `updateProjectImageCount`
- [ ] Integration test: delete image → count decrements
- [ ] Edge case: delete last image → count becomes 0

### Step 5: Documentation

- [ ] Document new methods in useDashboardProjects
- [ ] Update event documentation
- [ ] Add examples to codebase docs

---

## 13. Performance Impact

### Current Performance (Full Refetch)

```
Image Delete → Event → Debounce (300ms) → API Call (~100-500ms) → Full Re-render
Total Delay: 400-800ms + network latency
```

### Optimized Performance (Optimistic Update)

```
Image Delete → Event → State Update (0ms) → Partial Re-render (1 component)
Total Delay: <16ms (single frame)
```

**Expected Improvement:** 25-50x faster perceived performance

---

## 14. Risk Assessment

| Risk                   | Severity | Mitigation                      |
| ---------------------- | -------- | ------------------------------- |
| Count gets out of sync | MEDIUM   | Add periodic background refetch |
| Event lost/not fired   | LOW      | Backend is source of truth      |
| Concurrent deletions   | LOW      | Backend handles atomicity       |
| Project not in list    | LOW      | Add existence check + fallback  |

---

## 15. Future Enhancements

### After Initial Implementation

1. **Add optimistic updates for:**
   - Project creation (add to list instead of refetch)
   - Project title/description changes
   - Thumbnail updates

2. **Create event-driven update system:**

   ```typescript
   type ProjectUpdateEvent =
     | { type: 'image-deleted'; projectId: string; delta: -1 }
     | { type: 'image-added'; projectId: string; delta: 1 }
     | {
         type: 'project-updated';
         projectId: string;
         updates: Partial<Project>;
       };
   ```

3. **Add background sync:**
   ```typescript
   // Periodically verify counts match backend
   useInterval(
     () => {
       if (document.hidden) return; // Skip if tab not visible
       validateProjectCounts();
     },
     5 * 60 * 1000
   ); // Every 5 minutes
   ```

---

## 16. Conclusion

### Key Findings

1. ✅ **SSOT is maintained** - Single state source in useDashboardProjects
2. ⚠️ **Update mechanism is inefficient** - Uses full refetch instead of targeted updates
3. ✅ **Patterns exist** - Similar optimistic updates in useProjectData
4. ❌ **Methods missing** - No general-purpose project update method

### Recommended Immediate Action

**Implement `updateProjectImageCount` method** following the established pattern from `removeProjectOptimistically`. This will:

- Eliminate unnecessary API calls
- Improve perceived performance by 25-50x
- Maintain SSOT principles
- Follow existing codebase patterns
- Require minimal code changes (~50 lines)

### Success Criteria

✅ Image count updates immediately when image deleted
✅ No API call to refetch projects
✅ Only affected project card re-renders
✅ Fallback refetch on error conditions
✅ Tests verify count updates correctly

---

**Analysis Complete**
**Recommended Next Step:** Implement Phase 1 - Add Update Methods
