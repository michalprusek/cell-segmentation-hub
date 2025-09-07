# Shared Project 403 Error Callback Chain Fix

## Problem Description

When users removed projects from shared projects, the projects still appeared in the dashboard with 0 images and no thumbnail, causing 403 Forbidden errors. The backend was correctly revoking access, but the frontend had a broken callback chain preventing UI cleanup.

## Symptoms

- Removed shared projects still visible in dashboard
- GET /api/projects/{id}/images returns 403 Forbidden
- ProjectThumbnail shows error but project remains in UI
- Console logs show "Shared projects count: 1" then "Shared projects count: 0"

## Root Cause

The callback chain from Dashboard → ProjectsTab → ProjectsList → ProjectCard/ProjectListItem → ProjectThumbnail was broken. When ProjectThumbnail detected 403 errors, it couldn't notify parent components to remove the stale project.

## Solution Implementation

### 1. Dashboard Component

**File**: `/src/pages/Dashboard.tsx`

```typescript
// Get removeProjectOptimistically from hook
const {
  projects,
  loading,
  fetchProjects,
  removeProjectOptimistically  // Added this
} = useDashboardProjects(user?.id || '');

// Create handler
const handleProjectUpdate = useCallback((projectId: string, action: string) => {
  if (action === 'access-denied' || action === 'delete' || action === 'unshare') {
    removeProjectOptimistically(projectId);
  }
}, [removeProjectOptimistically]);

// Pass to ProjectsTab
<ProjectsTab
  projects={projects}
  onProjectUpdate={handleProjectUpdate}  // Added this
/>
```

### 2. ProjectsTab Component

**File**: `/src/components/dashboard/ProjectsTab.tsx`

```typescript
interface ProjectsTabProps {
  onProjectUpdate?: (projectId: string, action: string) => void;  // Added
}

// Pass through to ProjectsList
<ProjectsList
  projects={currentProjects}
  onProjectUpdate={onProjectUpdate}  // Added this
/>
```

### 3. ProjectsList Component

**File**: `/src/components/ProjectsList.tsx`

```typescript
interface ProjectsListProps {
  onProjectUpdate?: (projectId: string, action: string) => void;  // Added
}

// Pass to ProjectCard (grid view)
<ProjectCard
  key={project.id}
  {...project}
  onProjectUpdate={onProjectUpdate}  // Added this
/>

// Pass to ProjectListItem (list view)
<ProjectListItem
  key={project.id}
  {...project}
  onProjectUpdate={onProjectUpdate}  // Added this
/>
```

### 4. ProjectCard Component

**File**: `/src/components/ProjectCard.tsx`

```typescript
interface ProjectCardProps {
  onProjectUpdate?: (projectId: string, action: string) => void;  // Added
}

// Handle access errors from thumbnail
const handleAccessError = useCallback((projectId: string) => {
  onProjectUpdate?.(projectId, 'access-denied');
}, [onProjectUpdate]);

// Connect to ProjectThumbnail
<ProjectThumbnail
  projectId={id}
  fallbackSrc={thumbnail}
  imageCount={imageCount}
  onAccessError={handleAccessError}  // Added this
/>

// Pass to ProjectActions
<ProjectActions
  projectId={id}
  onProjectUpdate={onProjectUpdate}  // Added this
/>
```

### 5. ProjectListItem Component

**File**: `/src/components/ProjectListItem.tsx`

```typescript
// Same pattern as ProjectCard
interface ProjectListItemProps {
  onProjectUpdate?: (projectId: string, action: string) => void;  // Added
}

const handleAccessError = useCallback((projectId: string) => {
  onProjectUpdate?.(projectId, 'access-denied');
}, [onProjectUpdate]);

<ProjectThumbnail
  onAccessError={handleAccessError}  // Added this
/>

<ProjectActions
  onProjectUpdate={onProjectUpdate}  // Added this
/>
```

### 6. useDashboardProjects Hook

**File**: `/src/hooks/useDashboardProjects.ts`

```typescript
// Already had removeProjectOptimistically function
// Just needed to expose it in return statement
return {
  projects,
  loading,
  fetchError,
  fetchProjects,
  removeProjectOptimistically, // Added this to exports
};
```

## Testing Verification

### Manual Test Procedure

1. Create a project and share it with another user
2. Accept the share as the other user
3. As owner, revoke the share
4. Verify the shared user's dashboard immediately removes the project
5. Check console for no 403 errors

### Automated Test Coverage

- Unit tests for callback propagation
- Integration tests for access error handling
- E2E tests for complete unshare workflow

## Key Patterns Applied

### SSOT (Single Source of Truth)

- Used existing `removeProjectOptimistically` function
- Reused existing `onAccessError` prop in ProjectThumbnail
- No new state management, just connected existing pieces

### Optional Chaining

- All callbacks use optional chaining (`?.`) for safety
- Maintains backward compatibility

### Event Propagation

- Access errors bubble up through component hierarchy
- Optimistic updates happen at the top level (Dashboard)

## Performance Impact

- **Immediate UI Updates**: Projects removed instantly on access denial
- **Reduced API Calls**: No more repeated 403 errors
- **Better UX**: Clean dashboard without phantom projects

## Related Issues Fixed

- Stale shared projects in dashboard
- 403 errors in console
- Project count inconsistencies
- Thumbnail loading errors for revoked projects

## Files Modified

1. `/src/pages/Dashboard.tsx`
2. `/src/components/dashboard/ProjectsTab.tsx`
3. `/src/components/ProjectsList.tsx`
4. `/src/components/ProjectCard.tsx`
5. `/src/components/ProjectListItem.tsx`
6. `/src/hooks/useDashboardProjects.ts`

## Lessons Learned

1. **Complete Callback Chains**: Always ensure callbacks can propagate from leaf components to state managers
2. **Access Error Handling**: 403 errors should trigger UI cleanup, not just error messages
3. **Optimistic Updates**: Remove items immediately for better UX
4. **Component Communication**: Props should flow down, events should bubble up
