# SSOT Analysis Summary: Project Updates Without Full Refetch

## Quick Reference Guide

### Current State

**Problem:** Dashboard refetches all projects when a single image is deleted
**Impact:** Unnecessary API calls, slower UX (400-800ms delay vs <16ms)
**Root Cause:** Missing optimistic update method in `useDashboardProjects`

---

## Existing Patterns to Follow

### ✅ Pattern 1: Remove Item from Array (Already Exists)

**File:** `/src/hooks/useDashboardProjects.ts:370-374`

```typescript
const removeProjectOptimistically = useCallback((projectId: string) => {
  setProjects(prevProjects =>
    prevProjects.filter(project => project.id !== projectId)
  );
}, []);
```

### ✅ Pattern 2: Update Item in Array (From useProjectData)

**File:** `/src/hooks/useProjectData.tsx:433-445`

```typescript
setImages(prevImages =>
  prevImages.map(img => {
    if (img.id === imageId) {
      return {
        ...img,
        segmentationResult: {
          /* updates */
        },
      };
    }
    return img;
  })
);
```

### ✅ Pattern 3: Ternary Syntax (From useProjectImageActions)

**File:** `/src/hooks/useProjectImageActions.tsx:83-88`

```typescript
const updatedImages = images.map(img =>
  img.id === imageId ? { ...img, segmentationStatus: 'processing' } : img
);
```

---

## Recommended Implementation

### Step 1: Add to `useDashboardProjects` hook

```typescript
// General-purpose update method
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

// Specific method for image count (convenience)
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

// Return in hook
return {
  projects,
  loading,
  fetchError,
  fetchProjects,
  removeProjectOptimistically,
  updateProjectOptimistically, // NEW
  updateProjectImageCount, // NEW
};
```

### Step 2: Update Dashboard Event Handler

**File:** `/src/pages/Dashboard.tsx`

Replace this:

```typescript
// OLD - Triggers full refetch
window.addEventListener('project-image-deleted', handleProjectUpdate);
```

With this:

```typescript
// NEW - Optimistic update
useEffect(() => {
  const handleImageDeleted = (event: CustomEvent) => {
    const { projectId } = event.detail;
    updateProjectImageCount(projectId, -1);
  };

  window.addEventListener('project-image-deleted', handleImageDeleted);
  return () => {
    window.removeEventListener('project-image-deleted', handleImageDeleted);
  };
}, [updateProjectImageCount]);
```

---

## Event System Map

| Event Name               | Emitter                | Current Action       | Recommended Action |
| ------------------------ | ---------------------- | -------------------- | ------------------ |
| `project-image-deleted`  | useProjectImageActions | Full refetch ❌      | Update count ✅    |
| `project-created`        | NewProject             | Full refetch ⚠️      | Could add to list  |
| `project-deleted`        | ProjectActions         | Optimistic remove ✅ | Already optimal    |
| `project-unshared`       | ProjectActions         | Optimistic remove ✅ | Already optimal    |
| `project-images-updated` | ❓ Unknown             | Full refetch ⚠️      | Investigate usage  |

---

## SSOT Compliance Status

### ✅ Single Source of Truth (Compliant)

```
useDashboardProjects.projects → Dashboard → ProjectsList → ProjectCard/ProjectListItem
                                                              ↓
                                                        imageCount displayed
```

**Truth Source:** `useDashboardProjects` state
**Update Flow:** Single direction, no duplicate state

### ❌ Update Mechanism (Non-Compliant - Fixed by Implementation)

**Current:** Multiple events → Full refetch → Replace entire array
**Recommended:** Specific events → Targeted updates → Partial updates only

---

## Code Locations Reference

### Files to Modify

1. **`/src/hooks/useDashboardProjects.ts`**
   - Add `updateProjectOptimistically` method
   - Add `updateProjectImageCount` method
   - Export new methods

2. **`/src/pages/Dashboard.tsx`**
   - Update `project-image-deleted` event handler (line ~149)
   - Use `updateProjectImageCount` instead of `handleProjectUpdate`

### Files Already Using Similar Patterns

- ✅ `/src/hooks/useProjectData.tsx` - Image updates
- ✅ `/src/hooks/useProjectImageActions.tsx` - Status updates
- ✅ `/src/hooks/useDashboardProjects.ts` - Project removal

---

## Performance Impact

### Before (Current)

```
Delete Image
  ↓
Event fired
  ↓
Debounced (300ms wait)
  ↓
API call (/api/projects) [100-500ms]
  ↓
Parse response
  ↓
Replace entire projects array
  ↓
All project cards re-render

Total: 400-800ms + network latency
```

### After (Optimized)

```
Delete Image
  ↓
Event fired
  ↓
updateProjectImageCount() [<1ms]
  ↓
Only affected project re-renders

Total: <16ms (single frame)
```

**Improvement:** 25-50x faster

---

## Testing Strategy

### Unit Tests (Add to useDashboardProjects.test.ts)

```typescript
describe('updateProjectOptimistically', () => {
  it('should update project properties', () => {
    const { result } = renderHook(() => useDashboardProjects(options));

    act(() => {
      result.current.updateProjectOptimistically('project-1', {
        imageCount: 10,
      });
    });

    expect(result.current.projects[0].imageCount).toBe(10);
  });
});

describe('updateProjectImageCount', () => {
  it('should decrement image count', () => {
    const { result } = renderHook(() => useDashboardProjects(options));

    act(() => {
      result.current.updateProjectImageCount('project-1', -1);
    });

    expect(result.current.projects[0].imageCount).toBe(4); // was 5
  });

  it('should never go below 0', () => {
    const { result } = renderHook(() => useDashboardProjects(options));

    act(() => {
      result.current.updateProjectImageCount('project-1', -100);
    });

    expect(result.current.projects[0].imageCount).toBe(0);
  });
});
```

### Integration Tests

```typescript
it('should update count when image deleted', async () => {
  render(<Dashboard />);

  const initialCount = screen.getByText('5 images');

  // Trigger image deletion
  window.dispatchEvent(new CustomEvent('project-image-deleted', {
    detail: { projectId: 'project-1' }
  }));

  await waitFor(() => {
    expect(screen.getByText('4 images')).toBeInTheDocument();
  });

  // Should NOT make API call
  expect(apiClient.getProjects).not.toHaveBeenCalled();
});
```

---

## Implementation Checklist

- [ ] **Phase 1: Add methods to useDashboardProjects**
  - [ ] Add `updateProjectOptimistically`
  - [ ] Add `updateProjectImageCount`
  - [ ] Export methods from hook
  - [ ] Add TypeScript types

- [ ] **Phase 2: Update Dashboard**
  - [ ] Update `project-image-deleted` handler
  - [ ] Remove from debounced handler list
  - [ ] Test immediate update

- [ ] **Phase 3: Testing**
  - [ ] Unit test `updateProjectOptimistically`
  - [ ] Unit test `updateProjectImageCount`
  - [ ] Integration test image deletion
  - [ ] Test edge cases (0 count, missing project)

- [ ] **Phase 4: Verification**
  - [ ] Verify no API call on image delete
  - [ ] Verify count updates immediately
  - [ ] Verify only one card re-renders
  - [ ] Test with multiple rapid deletions

---

## Risk Mitigation

### Risk: Count gets out of sync

**Mitigation:** Keep existing WebSocket listener that triggers refetch on segmentation complete

```typescript
// Already exists in Dashboard.tsx:162-174
useEffect(() => {
  if (lastUpdate && lastUpdate.status === 'segmented') {
    setTimeout(() => fetchProjects(), 500);
  }
}, [lastUpdate]);
```

This acts as a periodic sync mechanism.

### Risk: Project not in list

**Mitigation:** Add existence check

```typescript
const updateProjectImageCount = useCallback(
  (projectId: string, delta: number) => {
    setProjects(prevProjects => {
      const project = prevProjects.find(p => p.id === projectId);

      if (!project) {
        // Project not found - trigger refetch as fallback
        console.warn('Project not found, refetching');
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

## Future Enhancements

After successful implementation of imageCount updates:

1. **Add optimistic updates for project creation**
   - Add to list instead of full refetch
   - Optimistic new project with "creating..." state

2. **Optimize other full refetch events**
   - `project-images-updated` - update count instead
   - WebSocket segmentation - update status instead

3. **Add background validation**
   - Periodic count validation (every 5 minutes)
   - Only when tab is visible
   - Silent correction if mismatch

4. **Create typed event system**
   ```typescript
   type ProjectEvent =
     | { type: 'image-deleted'; projectId: string }
     | { type: 'image-added'; projectId: string; count?: number }
     | {
         type: 'metadata-updated';
         projectId: string;
         updates: Partial<Project>;
       };
   ```

---

## Questions Answered

### Q: Does `useDashboardProjects` have update methods besides `removeProjectOptimistically`?

**A:** No. Only `removeProjectOptimistically` exists. No general update method.

### Q: Are there patterns for updating nested properties?

**A:** Yes, in `useProjectData` (line 433-445). Uses spread operator for immutable updates.

### Q: Which components emit `project-image-*` events?

**A:** `useProjectImageActions.tsx` emits `project-image-deleted` on line 49-52.

### Q: Where should updates happen?

**A:** In `useDashboardProjects` hook - it's the SSOT for project list state.

### Q: Is there duplication in project state?

**A:** No. Single source: `useDashboardProjects.projects`. Properly flows down to children.

---

## Conclusion

**SSOT Compliance:** ✅ Structure is compliant, ⚠️ Update mechanism needs improvement

**Recommended Action:** Implement `updateProjectImageCount` following existing `removeProjectOptimistically` pattern

**Estimated Effort:** 1-2 hours (implementation + tests)

**Expected Impact:**

- 25-50x faster UI updates
- Reduced API load
- Better user experience
- Maintains SSOT principles

**Files to Change:** 2 files, ~80 lines total

1. `/src/hooks/useDashboardProjects.ts` (~40 lines)
2. `/src/pages/Dashboard.tsx` (~20 lines)
3. Tests (~20 lines)
