# SSOT Data Flow Diagrams - Current State

## Overview: Project & Image Data Management

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SINGLE SOURCE OF TRUTH                          │
│                                                                     │
│  useDashboardProjects Hook                                          │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  const [projects, setProjects] = useState<Project[]>([])      │ │
│  │                                                                │ │
│  │  Methods:                                                      │ │
│  │  ✅ fetchProjects()                                           │ │
│  │  ✅ removeProjectOptimistically(id)                           │ │
│  │  ✅ updateProjectOptimistically(id, updates)                  │ │
│  │  ❌ addProjectOptimistically(project) - MISSING               │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ (props flow down)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DASHBOARD                                  │
│                                                                     │
│  Responsibilities:                                                  │
│  - Subscribe to events                                              │
│  - Call update methods                                              │
│  - Pass projects to children                                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ (projects[] prop)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       PROJECTS LIST                                 │
│                                                                     │
│  Maps projects to cards:                                            │
│  - Grid view: ProjectCard[]                                         │
│  - List view: ProjectListItem[]                                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ (individual project props)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PROJECT CARD / LIST ITEM                         │
│                                                                     │
│  Displays:                                                          │
│  - project.title                                                    │
│  - project.imageCount  ← Can update optimistically                 │
│  - project.thumbnail                                                │
│  - project.updatedAt                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Event Flow Comparison

### Current State: Mixed Strategies ⚠️

```
┌─────────────────────────────────────────────────────────────────┐
│                         EVENT SOURCES                           │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┬─────────────────┐
          │               │               │                 │
          ▼               ▼               ▼                 ▼

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ User Actions │  │Custom Events │  │  WebSocket   │  │    Errors    │
│              │  │              │  │   Updates    │  │              │
│ - Delete img │  │ - proj:create│  │ - segmented  │  │ - API fail   │
│ - Upload img │  │ - img:delete │  │ - processing │  │ - Auth fail  │
│ - Delete proj│  │ - img:upload │  │ - failed     │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │                 │
       │                 │                 │                 │
       └─────────────────┴─────────────────┴─────────────────┘
                                 │
                                 ▼
                ┌────────────────────────────────┐
                │   DASHBOARD EVENT HANDLERS     │
                └────────────────────────────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 │               │               │
                 ▼               ▼               ▼

    ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
    │  OPTIMISTIC UPDATE │  │  DEBOUNCED REFETCH │  │  DELAYED REFETCH   │
    │                    │  │                    │  │                    │
    │  <16ms             │  │  300ms + API call  │  │  500ms + API call  │
    │  ✅ FAST           │  │  ❌ SLOW           │  │  ❌ SLOW           │
    └────────────────────┘  └────────────────────┘  └────────────────────┘
             │                       │                       │
             │                       │                       │
             └───────────────────────┴───────────────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │   UPDATE PROJECTS[]     │
                        │   IN SSOT HOOK          │
                        └─────────────────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │    REACT RE-RENDER      │
                        └─────────────────────────┘
```

### Operation Performance Matrix

| Operation                | Strategy              | Timing        | Components Re-rendered | API Calls |
| ------------------------ | --------------------- | ------------- | ---------------------- | --------- |
| ✅ Image deleted         | Optimistic            | <16ms         | 1 card                 | 0         |
| ✅ Image uploaded        | Optimistic            | <16ms         | 1 card                 | 0         |
| ✅ Project deleted       | Optimistic            | <16ms         | 0 (removed)            | 0         |
| ✅ Project unshared      | Optimistic            | <16ms         | 0 (removed)            | 0         |
| ❌ **Project created**   | **Debounced refetch** | **400-800ms** | **All cards**          | **2**     |
| ❌ **Segmentation done** | **Delayed refetch**   | **500-900ms** | **All cards**          | **2**     |

---

## Detailed Flow: Image Deletion (✅ Optimized)

```
┌────────────────────────────────────────────────────────────────────┐
│  STEP 1: User clicks delete on image in ProjectDetail              │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  useProjectImageActions.handleDeleteImage()                        │
│  - await apiClient.deleteImage(projectId, imageId)                 │
│  - Update local images state (remove from array)                   │
│  - Emit CustomEvent: 'project-image-deleted'                       │
│    detail: { projectId, imageId, remainingCount, newThumbnail }   │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  Dashboard.tsx: handleImageUpdate() listener                       │
│  - Receives event.detail                                           │
│  - Extracts: projectId, remainingCount, newThumbnail               │
│  - Calls: updateProjectOptimistically(projectId, {                 │
│      imageCount: remainingCount,                                   │
│      thumbnail: newThumbnail                                       │
│    })                                                              │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ <1ms (synchronous)
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  useDashboardProjects.updateProjectOptimistically()                │
│  setProjects(prevProjects =>                                       │
│    prevProjects.map(p =>                                           │
│      p.id === projectId                                            │
│        ? { ...p, imageCount: remainingCount, thumbnail: newThumb } │
│        : p  ← Keeps same reference for unchanged projects          │
│    )                                                               │
│  )                                                                 │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  React Reconciliation (Optimized)                                  │
│  - Detects projects array changed                                  │
│  - Compares each project reference                                 │
│  - Only re-renders components with changed props                   │
│  - Result: Only 1 ProjectCard re-renders                           │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  UI Update Complete: <16ms (single frame)                          │
│  - User sees updated count immediately                             │
│  - No loading state                                                │
│  - No network delay                                                │
└────────────────────────────────────────────────────────────────────┘
```

**Total Time:** <16ms
**API Calls:** 0 (delete already happened)
**Components Re-rendered:** 1

---

## Detailed Flow: Project Creation (❌ Not Optimized)

```
┌────────────────────────────────────────────────────────────────────┐
│  STEP 1: User creates new project                                  │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  NewProject.tsx: handleCreateProject()                             │
│  - await apiClient.createProject({ name, description })            │
│  - Receive: projectData { id, name, ... }                          │
│  - Emit CustomEvent: 'project-created'                             │
│    detail: { projectId }  ← Only ID! Not full project              │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  Dashboard.tsx: debouncedFetchProjects() listener                  │
│  - Receives 'project-created' event                                │
│  - Waits 300ms (debounce)                                          │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ ⏱️ 300ms delay
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  useDashboardProjects.fetchProjects()                              │
│  - Calls: apiClient.getProjects()                                  │
│  - Calls: apiClient.getSharedProjects()                            │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ ⏱️ 100-500ms network
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  Backend returns ALL projects                                       │
│  - Fetches from database                                           │
│  - Processes thumbnails                                            │
│  - Returns JSON (~10-50KB)                                         │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  useDashboardProjects processes response                           │
│  setProjects(allProjects)  ← Replaces ENTIRE array                │
│  - All project references change                                   │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  React Reconciliation (Unoptimized)                                │
│  - Detects projects array completely replaced                      │
│  - All project references changed                                  │
│  - Re-renders ALL ProjectCard components                           │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  UI Update Complete: 400-800ms total                               │
│  - User waits for new project to appear                            │
│  - Possible loading state flicker                                  │
│  - All cards flash/re-render                                       │
└────────────────────────────────────────────────────────────────────┘
```

**Total Time:** 400-800ms (300ms debounce + 100-500ms API)
**API Calls:** 2 (getProjects + getSharedProjects)
**Components Re-rendered:** ALL project cards (10-50+)
**Data Transferred:** 10-50KB (entire project list)

---

## Optimized Flow: Project Creation (Recommended)

```
┌────────────────────────────────────────────────────────────────────┐
│  STEP 1: User creates new project                                  │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  NewProject.tsx: handleCreateProject()                             │
│  - await apiClient.createProject({ name, description })            │
│  - Receive: projectData { id, name, description, ... }             │
│  - Emit CustomEvent: 'project-created'                             │
│    detail: { project: projectData }  ← Full project object!        │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  Dashboard.tsx: handleProjectCreated() listener                    │
│  - Receives event.detail.project                                   │
│  - Calls: addProjectOptimistically(project)                        │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ <1ms (synchronous)
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  useDashboardProjects.addProjectOptimistically()                   │
│  setProjects(prevProjects =>                                       │
│    [project, ...prevProjects]  ← Add to beginning                  │
│  )                                                                 │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  React Reconciliation (Optimized)                                  │
│  - Detects projects array changed                                  │
│  - All existing project references unchanged                       │
│  - Only renders 1 new ProjectCard                                  │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  UI Update Complete: <16ms (single frame)                          │
│  - New project appears immediately                                 │
│  - No loading state                                                │
│  - Other cards don't re-render                                     │
└────────────────────────────────────────────────────────────────────┘
```

**Total Time:** <16ms
**API Calls:** 0 (creation already happened)
**Components Re-rendered:** 1 (just the new card)
**Data Transferred:** 0 (already have data from create response)

**Improvement:** 25-50x faster!

---

## WebSocket Flow: Segmentation Complete

### Current (❌ Not Optimized)

```
WebSocket Message
  ↓
useSegmentationQueue.handleSegmentationUpdate()
  ↓
setLastUpdate({ status: 'segmented', projectId, imageId })
  ↓
Dashboard.tsx useEffect detects lastUpdate changed
  ↓
setTimeout(() => fetchProjects(), 500)  ← 500ms delay + API call
  ↓
Fetch ALL projects from API (100-500ms)
  ↓
Replace entire projects array
  ↓
ALL project cards re-render

Total: 600-1000ms, 2 API calls, all cards re-render
```

### Recommended (✅ Optimized)

```
WebSocket Message
  ↓
useSegmentationQueue.handleSegmentationUpdate()
  ↓
setLastUpdate({ status: 'segmented', projectId, imageId })
  ↓
Dashboard.tsx useEffect detects lastUpdate changed
  ↓
updateProjectOptimistically(projectId, {
  lastSegmentedAt: new Date(),
  // Could track segmentedImageCount if needed
})
  ↓
Update single project in array
  ↓
Only affected project card re-renders

Total: <16ms, 0 API calls, 1 card re-render
```

**Improvement:** 37-62x faster!

---

## Event System Architecture

### Current: Untyped CustomEvent (⚠️ Risky)

```
┌─────────────────────────────────────────────────────────────────┐
│                          EMITTER                                │
├─────────────────────────────────────────────────────────────────┤
│  window.dispatchEvent(                                          │
│    new CustomEvent('project-image-deleted', {                   │
│      detail: {                                                  │
│        projectId: 'abc123',  ← No type checking                │
│        imageId: 'xyz789',                                       │
│        remainingCount: 5                                        │
│      }                                                          │
│    })                                                           │
│  )                                                              │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 │ No type safety!
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         LISTENER                                │
├─────────────────────────────────────────────────────────────────┤
│  window.addEventListener(                                       │
│    'project-image-delted',  ← Typo! No compile error          │
│    (event: Event) => {                                         │
│      const detail = (event as CustomEvent).detail;             │
│      const { projectId } = detail;  ← No autocomplete          │
│      // Could access wrong property, no error!                 │
│    }                                                            │
│  )                                                              │
└─────────────────────────────────────────────────────────────────┘
```

**Problems:**

- ❌ Easy to misspell event names
- ❌ No autocomplete for event names
- ❌ No type checking for event data
- ❌ Runtime errors if structure changes
- ❌ Hard to find all usages

### Recommended: Typed Event System (✅ Safe)

```
┌─────────────────────────────────────────────────────────────────┐
│                      TYPE DEFINITIONS                           │
├─────────────────────────────────────────────────────────────────┤
│  type ProjectEvents = {                                         │
│    'project:created': { project: Project };                     │
│    'project:deleted': { projectId: string };                    │
│    'image:deleted': {                                           │
│      projectId: string;                                         │
│      imageId: string;                                           │
│      remainingCount: number;                                    │
│    };                                                           │
│  };                                                             │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 │ Single source of truth!
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                          EMITTER                                │
├─────────────────────────────────────────────────────────────────┤
│  projectEvents.emit('image:deleted', {                          │
│    projectId: 'abc123',  ← Fully typed                         │
│    imageId: 'xyz789',                                           │
│    remainingCount: 5                                            │
│    // wrongField: 'x'  ← Type error!                           │
│  });                                                            │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 │ Type checked!
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         LISTENER                                │
├─────────────────────────────────────────────────────────────────┤
│  projectEvents.on(                                              │
│    'image:deleted',  ← Autocomplete! Type checked!             │
│    ({ projectId, imageId, remainingCount }) => {               │
│      // All parameters fully typed and autocompleted!          │
│      console.log(projectId.toUpperCase());  ← knows it's string│
│    }                                                            │
│  );                                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**

- ✅ Compile-time error for typos
- ✅ Full IDE autocomplete
- ✅ Type checking for event data
- ✅ Refactoring support
- ✅ Easy to find all usages

---

## Summary: Data Flow Principles

### ✅ Following SSOT

1. **Single State Source**

   ```
   useDashboardProjects.projects ← Only source of truth
   ```

2. **Unidirectional Data Flow**

   ```
   Hook → Dashboard → ProjectsList → ProjectCard
   (No reverse data flow, only callbacks)
   ```

3. **Optimistic Updates**
   ```
   Update local state immediately
   Trust the API call already succeeded
   ```

### ⚠️ Not Following SSOT

1. **Mixed Update Strategies**

   ```
   Some events: optimistic (<16ms)
   Other events: refetch (400-800ms)
   No clear rule for which to use
   ```

2. **Duplicate Event Listeners**

   ```
   Multiple listeners for similar operations
   Different timing/delays for each
   ```

3. **No Type Safety**
   ```
   Easy to break with typos
   No compile-time checks
   ```

---

## Performance Comparison Matrix

| Aspect                     | Current (Mixed)        | After Optimization     |
| -------------------------- | ---------------------- | ---------------------- |
| **Operations <100ms**      | 60%                    | 100%                   |
| **Unnecessary API calls**  | ~40% of events         | 0%                     |
| **Components re-rendered** | All cards for some ops | Only affected cards    |
| **Network data**           | 10-50KB per refetch    | Only initial load      |
| **Type safety**            | None                   | 100%                   |
| **Developer errors**       | Easy to make           | Caught at compile time |

---

## Next Steps

1. ✅ Implement `addProjectOptimistically` (3 hours)
2. ✅ Optimize WebSocket updates (2 hours)
3. ✅ Centralize status logic (2 hours)
4. ✅ Add typed event system (4 hours)

**Total:** 11 hours for major improvements

**Result:** All operations <100ms, 100% type safe, maintainable code
