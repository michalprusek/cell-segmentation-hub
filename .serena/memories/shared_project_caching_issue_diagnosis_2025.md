# Shared Project Caching Issue Diagnosis

## Problem Summary

When a user removes a project from shared projects, the project still appears in dashboard with 0 images and no thumbnail. Console shows 403 Forbidden errors when fetching thumbnails. First load shows "Shared projects count: 1", second load shows "Shared projects count: 0".

## Root Causes Identified

### 1. Missing ProjectThumbnail Access Error Callback in ProjectCard

**Location**: `/src/components/ProjectCard.tsx` lines 79-83

**Issue**: ProjectThumbnail component has `onAccessError` prop support (line 12 in ProjectThumbnail.tsx), but ProjectCard doesn't pass a callback to handle 403 errors.

```typescript
// Current implementation (MISSING onAccessError callback)
<ProjectThumbnail
  projectId={id}
  fallbackSrc={thumbnail}
  imageCount={imageCount}
/>
```

**Impact**: When ProjectThumbnail gets 403 errors, it can't notify parent components to remove the stale project from the UI.

### 2. Missing onProjectUpdate Callback in ProjectCard

**Location**: `/src/components/ProjectCard.tsx` lines 85-91

**Issue**: ProjectActions receives optimistic update callback, but ProjectCard doesn't pass it through.

```typescript
// Current implementation (MISSING onProjectUpdate callback)
<ProjectActions
  projectId={id}
  projectTitle={title}
  onDialogStateChange={setIsDialogOpen}
  isShared={isShared}
  shareId={shareId}
/>
```

**Impact**: Optimistic updates don't work because the callback chain is broken.

### 3. No Connection Between Dashboard and ProjectCard

**Location**: `/src/pages/Dashboard.tsx` lines 146-200

**Issue**: Dashboard doesn't pass access error handlers or project update callbacks to ProjectsList/ProjectCard.

**Impact**: UI components can't communicate back to remove stale projects.

### 4. Race Condition in useDashboardProjects

**Location**: `/src/hooks/useDashboardProjects.ts` lines 75-108

**Issue**: The hook fetches owned and shared projects simultaneously, but if shared API fails (403), owned projects still get processed.

```typescript
// This can cause race condition
const ownedResponse = await apiClient.getProjects();
let sharedResponse = [];
try {
  const response = await apiClient.getSharedProjects();
  // If this fails with 403, we get empty array but owned projects continue
  sharedResponse = response.data || response.projects || [];
} catch (shareError) {
  // Logs error but continues - this can leave stale "owned" projects
  sharedResponse = [];
}
```

### 5. Incomplete State Cleanup on Access Errors

**Location**: `/src/hooks/useDashboardProjects.ts` lines 382-390

**Issue**: The `removeProjectOptimistically` function exists but is not exposed to components that need it.

```typescript
// This function exists but is not connected to the UI
const removeProjectOptimistically = useCallback((projectId: string) => {
  setProjects(prevProjects =>
    prevProjects.filter(project => project.id !== projectId)
  );
}, []);
```

## The Flow of the Bug

1. User unshares project via ProjectActions
2. Backend processes unshare correctly (403 for subsequent access)
3. Dashboard refetches projects via event listener (line 113)
4. useDashboardProjects gets owned projects, shared projects API fails
5. Project appears as "owned" with 0 images
6. ProjectThumbnail tries to fetch images, gets 403
7. No callback exists to remove project from UI
8. Project persists with broken state

## Required Fixes

### Fix 1: Add Access Error Handling to ProjectCard

```typescript
// Add onAccessError callback
<ProjectThumbnail
  projectId={id}
  fallbackSrc={thumbnail}
  imageCount={imageCount}
  onAccessError={(projectId, error) => {
    // Remove project from UI when access denied
    onProjectUpdate?.(projectId, 'access-denied');
  }}
/>
```

### Fix 2: Connect Dashboard to ProjectCard

```typescript
// In Dashboard component, pass callback to ProjectsList
<ProjectsList
  projects={projects}
  viewMode={viewMode}
  onOpenProject={handleOpenProject}
  loading={loading}
  showCreateCard={user?.role === 'user'}
  onProjectUpdate={removeProjectOptimistically} // ADD THIS
/>
```

### Fix 3: Expose removeProjectOptimistically

```typescript
// In useDashboardProjects.ts return statement
return {
  projects,
  loading,
  fetchError,
  fetchProjects,
  removeProjectOptimistically, // ADD THIS
};
```

### Fix 4: Enhanced Error Handling in Project Fetching

```typescript
// Better error handling for stale shares
if (sharedProjectIds.has(p.id)) {
  // Double-check access before adding to projectMap
  try {
    await apiClient.getProject(p.id);
    // If successful, it's legitimately shared
  } catch (accessError) {
    if (accessError?.response?.status === 403) {
      // Access revoked, skip this project entirely
      return;
    }
  }
}
```

## Technical Details

- **State Management**: React state not properly synchronized with backend changes
- **Event Propagation**: Events fired but no listeners at component level
- **Error Boundaries**: 403 errors handled but not propagated to UI updates
- **Optimistic Updates**: Callback chain broken between Dashboard → ProjectsList → ProjectCard → ProjectActions

## Prevention Strategies

1. Always provide access error callbacks in thumbnail components
2. Implement proper callback chains for optimistic updates
3. Add access validation before adding projects to UI state
4. Use proper error boundaries for access-denied scenarios
