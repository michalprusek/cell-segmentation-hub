# Fix for Shared Project Removal Dashboard Persistence Bug

## Problem Description

When users removed/unshared a project from their shared projects, the project would still appear in the dashboard and cause 500 Internal Server Error when trying to fetch its images.

### Symptoms

- Removed shared projects still visible in dashboard
- GET /api/projects/{id}/images returns 500 instead of 403
- Dashboard project count not updating after unshare
- ProjectThumbnail component failing with server errors

## Root Causes Identified

### 1. Backend Error Handling Issue

**Location**: `backend/src/services/imageService.ts` and `backend/src/api/controllers/imageController.ts`

- Service layer threw generic `Error` instead of `ApiError`
- Controller had language mismatch (checking Czech patterns for English errors)
- Result: 500 Internal Server Error instead of proper 403 Forbidden

### 2. Frontend State Management Race Conditions

**Location**: `src/hooks/useDashboardProjects.ts`

- No request cancellation for in-flight API calls
- No debouncing for rapid refetch events
- Missing state cleanup before new fetches
- Result: Stale project data persisting in UI

### 3. Missing Optimistic Updates

**Location**: `src/components/project/ProjectActions.tsx`

- No immediate UI feedback on unshare action
- Relied only on API call + event dispatch
- Result: Perceived slowness and confusion

## Solution Implementation

### Backend Fixes

#### 1. imageService.ts

```typescript
// Import ApiError
import { ApiError } from '../middleware/error';

// Replace generic errors with ApiError
if (!project) {
  throw ApiError.forbidden('Access denied to this project');
}
if (!user) {
  throw ApiError.notFound('User not found');
}
```

#### 2. imageController.ts

```typescript
// Add ApiError handling in catch blocks
} catch (error) {
  if (error instanceof ApiError) {
    ResponseHelper.error(res, error, error.statusCode, undefined, 'ImageController');
    return;
  }
  // Fallback error handling
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  if (errorMessage.includes('not found') || errorMessage.includes('nenalezen')) {
    ResponseHelper.notFound(res, errorMessage);
  } else if (errorMessage.includes('access') || errorMessage.includes('oprávnění')) {
    ResponseHelper.forbidden(res, errorMessage);
  } else {
    ResponseHelper.internalError(res, error as Error, 'ImageController');
  }
}
```

### Frontend Fixes

#### 1. useDashboardProjects.ts

```typescript
// Add AbortController for request cancellation
const abortControllerRef = useRef<AbortController | null>(null);

// Add debouncing
const debouncedUserId = useDebounce(userId, 300);
const debouncedSortField = useDebounce(sortField, 200);
const debouncedSortDirection = useDebounce(sortDirection, 200);

// Cancel previous requests
if (abortControllerRef.current) {
  abortControllerRef.current.abort();
}
abortControllerRef.current = new AbortController();

// Clear state before fetching
setAllProjects([]);
setSharedProjects([]);

// Add optimistic removal function
const removeProjectOptimistically = useCallback((projectId: string) => {
  setAllProjects(prev => prev.filter(p => p.id !== projectId));
  setSharedProjects(prev => prev.filter(p => p.id !== projectId));
}, []);
```

#### 2. ProjectActions.tsx

```typescript
// Add optimistic update callback
interface ProjectActionsProps {
  onProjectUpdate?: (projectId: string, action: 'delete' | 'unshare') => void;
}

// In handleDelete
await onProjectUpdate?.(projectId, 'delete');
await apiClient.deleteProject(projectId);

// In handleUnshare
await onProjectUpdate?.(projectId, 'unshare');
await apiClient.revokeProjectShare(projectId, shareId);
```

#### 3. ProjectThumbnail.tsx

```typescript
// Add access error callback
interface ProjectThumbnailProps {
  onAccessError?: (projectId: string) => void;
}

// Better error handling
if ([403, 500].includes(response?.status)) {
  logger.debug(`Project ${projectId} is no longer accessible`);
  onAccessError?.(projectId);
  setImageUrl(null);
  return;
}
```

## Testing Checklist

1. ✅ Create and share a project
2. ✅ Accept the share as another user
3. ✅ Remove/unshare the project
4. ✅ Verify project immediately disappears from dashboard
5. ✅ Verify no 500 errors in console
6. ✅ Check backend returns 403 for revoked shares
7. ✅ Test rapid share/unshare operations
8. ✅ Verify project count updates correctly

## Patterns Applied

### SSOT (Single Source of Truth)

- Used existing `ApiError` class from `backend/src/middleware/error.ts`
- Used existing `ResponseHelper` from `backend/src/utils/response.ts`
- Used existing `useDebounce` hook from `src/hooks/useDebounce.ts`

### Best Practices

- AbortController for request cancellation
- Debouncing for performance optimization
- Optimistic updates for better UX
- Proper error status codes (403 vs 500)
- Graceful error handling with fallbacks

## Files Modified

- `backend/src/services/imageService.ts`
- `backend/src/api/controllers/imageController.ts`
- `src/hooks/useDashboardProjects.ts`
- `src/components/project/ProjectActions.tsx`
- `src/components/project/ProjectThumbnail.tsx`

## Key Learnings

1. **Language Consistency**: Error messages must be consistent across service and controller layers
2. **Proper Error Types**: Always use `ApiError` for HTTP errors instead of generic `Error`
3. **State Management**: Request cancellation and debouncing prevent race conditions
4. **Optimistic Updates**: Immediate UI feedback improves perceived performance
5. **Error Boundaries**: Components should handle access errors gracefully

## Performance Impact

- Reduced unnecessary API calls through debouncing
- Faster UI updates with optimistic mutations
- Prevented memory leaks with proper cleanup
- Better error recovery with appropriate status codes

## Related Issues

- fix_403_forbidden_project_shares.md
- fix_shared_project_owner_display.md
- fix_shared_project_queue_permissions.md
