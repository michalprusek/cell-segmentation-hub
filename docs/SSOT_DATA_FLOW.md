# SSOT Data Flow: Project Updates

## Current Data Flow (With Full Refetch - SLOW)

```
┌─────────────────────────────────────────────────────────────────┐
│  User Action: Delete Image in Project Detail Page              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  useProjectImageActions.handleDeleteImage()                     │
│  - Calls apiClient.deleteImage(projectId, imageId)             │
│  - Emits: 'project-image-deleted' event                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard.tsx Event Listener                                   │
│  - Receives 'project-image-deleted' event                       │
│  - Calls: debouncedFetchProjects()                              │
│  - Waits: 300ms (debounce)                                      │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼ (300ms delay)
┌─────────────────────────────────────────────────────────────────┐
│  useDashboardProjects.fetchProjects()                           │
│  - Calls: apiClient.getProjects()                               │
│  - Calls: apiClient.getSharedProjects()                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼ (100-500ms network latency)
┌─────────────────────────────────────────────────────────────────┐
│  Backend API Response                                            │
│  - Returns: ALL projects with current image counts              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  useDashboardProjects State Update                              │
│  - setProjects(allProjects) → REPLACES ENTIRE ARRAY            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  React Re-renders                                                │
│  - Dashboard component re-renders                                │
│  - ProjectsList re-renders                                       │
│  - ALL ProjectCard/ProjectListItem components re-render          │
└─────────────────────────────────────────────────────────────────┘

Total Time: 400-800ms + network latency
API Calls: 2 (getProjects + getSharedProjects)
Re-renders: ALL project cards (~10-50 components)
```

---

## Optimized Data Flow (With Optimistic Update - FAST)

```
┌─────────────────────────────────────────────────────────────────┐
│  User Action: Delete Image in Project Detail Page              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  useProjectImageActions.handleDeleteImage()                     │
│  - Calls apiClient.deleteImage(projectId, imageId)             │
│  - Emits: 'project-image-deleted' event with projectId         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard.tsx Event Listener                                   │
│  - Receives 'project-image-deleted' event                       │
│  - Extracts: projectId from event.detail                        │
│  - Calls: updateProjectImageCount(projectId, -1)                │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼ (<1ms - synchronous)
┌─────────────────────────────────────────────────────────────────┐
│  useDashboardProjects.updateProjectImageCount()                 │
│  - Updates state with map():                                    │
│    setProjects(prevProjects =>                                  │
│      prevProjects.map(p =>                                      │
│        p.id === projectId                                       │
│          ? { ...p, imageCount: p.imageCount - 1 }               │
│          : p                                                    │
│      )                                                          │
│    )                                                            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  React Re-renders (Optimized)                                    │
│  - Dashboard: No re-render (same reference)                      │
│  - ProjectsList: No re-render (shallow equal props)              │
│  - Only affected ProjectCard re-renders (imageCount changed)    │
└─────────────────────────────────────────────────────────────────┘

Total Time: <16ms (single React frame)
API Calls: 0 (already done in delete action)
Re-renders: 1 project card only
```

---

## State Structure Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  useDashboardProjects Hook (SSOT)                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  State: projects: Project[]                                 │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  Project {                                            │  │ │
│  │  │    id: "project-1",                                   │  │ │
│  │  │    title: "Cell Analysis",                            │  │ │
│  │  │    imageCount: 5,  ◄── UPDATE THIS OPTIMISTICALLY    │  │ │
│  │  │    ...                                                 │  │ │
│  │  │  }                                                     │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Methods:                                                        │
│  ✅ removeProjectOptimistically(projectId) - EXISTS             │
│  ❌ updateProjectOptimistically(projectId, updates) - MISSING   │
│  ❌ updateProjectImageCount(projectId, delta) - MISSING         │
└───────────────────────┬──────────────────────────────────────────┘
                        │ (props flow down)
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Dashboard Component                                             │
│  - Subscribes to custom events                                   │
│  - Calls update methods                                          │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  ProjectsList Component                                          │
│  - Receives: projects[] as prop                                  │
│  - Maps to: ProjectCard[] or ProjectListItem[]                   │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  ProjectCard / ProjectListItem                                   │
│  - Displays: project.imageCount                                  │
│  - Re-renders only when props change                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Event Flow Comparison

### Current Event Flow (All Trigger Full Refetch)

```
Event Name              Emitter                   Handler               Action
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
project-created         NewProject.tsx       →   Dashboard.tsx    →   fetchProjects() ❌
project-deleted         ProjectActions.tsx   →   Dashboard.tsx    →   removeOptimistically() ✅
project-unshared        ProjectActions.tsx   →   Dashboard.tsx    →   removeOptimistically() ✅
project-images-updated  ???                  →   Dashboard.tsx    →   fetchProjects() ❌
project-image-deleted   useProjectImageActs  →   Dashboard.tsx    →   fetchProjects() ❌ ⚠️
project-refetch-needed  ProjectActions.tsx   →   useDashboardProj →   fetchProjects(true) ✅
```

### Optimized Event Flow

```
Event Name              Emitter                   Handler               Action
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
project-created         NewProject.tsx       →   Dashboard.tsx    →   addProjectOptimistically() ✅
project-deleted         ProjectActions.tsx   →   Dashboard.tsx    →   removeOptimistically() ✅
project-unshared        ProjectActions.tsx   →   Dashboard.tsx    →   removeOptimistically() ✅
project-images-updated  ???                  →   Dashboard.tsx    →   updateProjectImageCount() ✅
project-image-deleted   useProjectImageActs  →   Dashboard.tsx    →   updateProjectImageCount(-1) ✅
project-refetch-needed  ProjectActions.tsx   →   useDashboardProj →   fetchProjects(true) ✅
```

---

## Update Method Comparison

### Existing: removeProjectOptimistically

```typescript
// File: /src/hooks/useDashboardProjects.ts:370-374

const removeProjectOptimistically = useCallback((projectId: string) => {
  setProjects(prevProjects =>
    prevProjects.filter(project => project.id !== projectId)
  );
}, []);

// Usage in Dashboard:
onProjectUpdate?.(projectId, 'delete');
// ↓
removeProjectOptimistically(projectId);
```

**Pattern:**

- ✅ Functional update (`prevProjects =>`)
- ✅ Immutable operation (`.filter()`)
- ✅ ID-based targeting
- ✅ No API call needed

### New: updateProjectImageCount (Recommended)

```typescript
// File: /src/hooks/useDashboardProjects.ts (NEW)

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

// Usage in Dashboard:
window.addEventListener('project-image-deleted', (event: CustomEvent) => {
  const { projectId } = event.detail;
  updateProjectImageCount(projectId, -1);
});
```

**Same Pattern:**

- ✅ Functional update (`prevProjects =>`)
- ✅ Immutable operation (`.map()` + spread)
- ✅ ID-based targeting
- ✅ No API call needed

### New: updateProjectOptimistically (General Purpose)

```typescript
// File: /src/hooks/useDashboardProjects.ts (NEW)

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

// Usage examples:
updateProjectOptimistically('project-1', { imageCount: 10 });
updateProjectOptimistically('project-1', { title: 'New Title' });
updateProjectOptimistically('project-1', {
  imageCount: 5,
  thumbnail: '/new.jpg',
});
```

**Same Pattern + Flexibility:**

- ✅ Functional update
- ✅ Immutable operation
- ✅ ID-based targeting
- ✅ Accepts any partial updates

---

## Re-render Optimization

### Current (Full Refetch)

```
setProjects(newProjects)  // Entire new array
  ↓
React detects projects array changed
  ↓
Dashboard re-renders
  ↓
ProjectsList re-renders
  ↓
ALL ProjectCard components re-render
  ↓
ALL ProjectListItem components re-render

Total components re-rendered: 1 + 1 + N (where N = project count)
```

### Optimized (Targeted Update)

```
setProjects(prevProjects.map(...))  // New array, but most items unchanged
  ↓
React detects projects array changed
  ↓
Dashboard re-renders (but shallow equal optimizes children)
  ↓
ProjectsList receives same project objects (except one)
  ↓
React.memo / shouldComponentUpdate skips unchanged cards
  ↓
ONLY affected ProjectCard re-renders

Total components re-rendered: 1 (just the affected card)
```

**Why It Works:**

```typescript
// Unchanged projects keep same reference
prevProjects.map(
  project =>
    project.id === projectId
      ? { ...project, imageCount: newCount } // New object
      : project // ← Same reference!
);
```

---

## Type Definitions Reference

### Project Interface (Dashboard)

```typescript
// File: /src/components/ProjectsList.tsx:10-22

export interface Project {
  id: string; // Primary key for updates
  title: string; // Display name
  description: string; // Optional description
  thumbnail: string; // Image path
  date: string; // Last updated
  imageCount: number; // ⭐ Target for optimization
  isOwned?: boolean; // Ownership flag
  isShared?: boolean; // Sharing flag
  sharedBy?: { email: string }; // Share metadata
  owner?: { email: string; name?: string }; // Owner info
  shareId?: string; // Share ID for revocation
}
```

### Update Method Signatures

```typescript
// Current (exists)
type RemoveProjectOptimistically = (projectId: string) => void;

// New (recommended)
type UpdateProjectOptimistically = (
  projectId: string,
  updates: Partial<Project>
) => void;

type UpdateProjectImageCount = (
  projectId: string,
  delta: number // +1 for add, -1 for delete
) => void;
```

---

## Implementation Code Blocks

### 1. Add to useDashboardProjects.ts

```typescript
// After line 374 (after removeProjectOptimistically)

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

// Update return statement (line 419-425)
return {
  projects,
  loading,
  fetchError,
  fetchProjects,
  removeProjectOptimistically,
  updateProjectOptimistically, // ADD
  updateProjectImageCount, // ADD
};
```

### 2. Update Dashboard.tsx

```typescript
// Update hook call (line 30-41)
const {
  projects,
  loading,
  fetchError,
  fetchProjects,
  removeProjectOptimistically,
  updateProjectImageCount, // ADD THIS
} = useDashboardProjects({
  sortField,
  sortDirection,
  userId: user?.id,
  userEmail: user?.email,
});

// Replace event listener (line 143-159)
// REMOVE project-image-deleted from debounced handler

useEffect(() => {
  const debouncedFetchProjects = (() => {
    let timeoutId: NodeJS.Timeout;
    return () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fetchProjects();
      }, 300);
    };
  })();

  const handleProjectUpdate = debouncedFetchProjects;

  window.addEventListener('project-created', handleProjectUpdate);
  window.addEventListener('project-deleted', handleProjectUpdate);
  window.addEventListener('project-unshared', handleProjectUpdate);
  window.addEventListener('project-images-updated', handleProjectUpdate);
  // REMOVED: window.addEventListener('project-image-deleted', handleProjectUpdate);

  return () => {
    window.removeEventListener('project-created', handleProjectUpdate);
    window.removeEventListener('project-deleted', handleProjectUpdate);
    window.removeEventListener('project-unshared', handleProjectUpdate);
    window.removeEventListener('project-images-updated', handleProjectUpdate);
    // REMOVED: window.removeEventListener('project-image-deleted', handleProjectUpdate);
  };
}, [fetchProjects]);

// ADD new dedicated handler for image deletion
useEffect(() => {
  const handleImageDeleted = (event: Event) => {
    const customEvent = event as CustomEvent;
    const { projectId } = customEvent.detail;
    updateProjectImageCount(projectId, -1);
  };

  window.addEventListener('project-image-deleted', handleImageDeleted);

  return () => {
    window.removeEventListener('project-image-deleted', handleImageDeleted);
  };
}, [updateProjectImageCount]);
```

---

## Performance Metrics

### Before Optimization

| Metric                 | Value     | Notes                           |
| ---------------------- | --------- | ------------------------------- |
| Time to UI Update      | 400-800ms | Includes debounce + API call    |
| API Calls per Delete   | 2         | getProjects + getSharedProjects |
| Data Transferred       | ~10-50KB  | All projects JSON               |
| Components Re-rendered | 10-50+    | All project cards               |
| Network Requests       | High      | Every image deletion            |

### After Optimization

| Metric                 | Value   | Notes              |
| ---------------------- | ------- | ------------------ |
| Time to UI Update      | <16ms   | Single React frame |
| API Calls per Delete   | 0       | No network needed  |
| Data Transferred       | 0 bytes | Local state update |
| Components Re-rendered | 1       | Only affected card |
| Network Requests       | None    | Eliminated         |

**Performance Improvement:** 25-50x faster perceived performance

---

## Validation & Sync Strategy

### Optimistic Update with Background Validation

```
User Action (Delete Image)
  ↓
Immediate UI Update (optimistic)
  ↓                              ↓
Continue User Flow        Background WebSocket
                          monitors segmentation
                                  ↓
                          Periodic Refetch
                          (validates counts)
```

**Existing Validation Mechanisms:**

1. **WebSocket Updates** (already exists)

   ```typescript
   // Dashboard.tsx:162-174
   useEffect(() => {
     if (lastUpdate && lastUpdate.status === 'segmented') {
       setTimeout(() => fetchProjects(), 500);
     }
   }, [lastUpdate]);
   ```

2. **Refetch on Navigation** (already exists)
   - User navigates away and back
   - Hook re-fetches on mount

3. **Error Fallback** (recommended to add)

   ```typescript
   const updateProjectImageCount = useCallback(
     (projectId: string, delta: number) => {
       setProjects(prevProjects => {
         const project = prevProjects.find(p => p.id === projectId);

         if (!project) {
           // Fallback: refetch if project not found
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

## Summary

### Key Points

1. **SSOT is maintained** - `useDashboardProjects` is single source of truth
2. **Pattern exists** - `removeProjectOptimistically` shows the way
3. **Simple fix** - Add `updateProjectImageCount` method
4. **Big impact** - 25-50x performance improvement
5. **Low risk** - Existing validation mechanisms prevent sync issues

### Files to Change

1. `/src/hooks/useDashboardProjects.ts` (~40 lines)
2. `/src/pages/Dashboard.tsx` (~30 lines)
3. Tests (~30 lines)

**Total Effort:** 1-2 hours
**Impact:** High (much better UX)
**Risk:** Low (well-established pattern)
