# Backend 404 Error: Shared Project Image Loading Critical Fix Analysis

## Root Cause Confirmed

The `getProjectImagesWithThumbnails` function in `/backend/src/api/controllers/imageController.ts` (lines 604-614) only validates project **ownership**, completely ignoring shared project access permissions.

### Current Problematic Code (Lines 604-614)

```typescript
// Verify project ownership - ONLY CHECKS OWNERSHIP, NOT SHARED ACCESS
const project = await prisma.project.findFirst({
  where: {
    id: projectId,
    userId, // ❌ This ONLY finds projects owned by the user
  },
});

if (!project) {
  ResponseHelper.notFound(res, 'Projekt nenalezen nebo nemáte oprávnění');
  return;
}
```

## Standard Shared Project Validation Pattern

### ✅ Correct Pattern (Used in Export/Sharing Controllers)

```typescript
// Import the sharing service
import * as SharingService from '../../services/sharingService';

// Replace ownership check with shared access check
const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
if (!accessCheck.hasAccess) {
  ResponseHelper.notFound(res, 'Projekt nenalezen nebo nemáte oprávnění');
  return;
}
```

## Evidence from Other Controllers

### ✅ Export Service (Lines 200-203)

```typescript
const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
if (!accessCheck.hasAccess) {
  throw new Error(
    'Access denied: You do not have permission to export this project'
  );
}
```

### ✅ Sharing Controller (Lines 207-223)

```typescript
const accessCheck = await SharingService.hasProjectAccess(
  projectId,
  req.user.id
);
if (!accessCheck.hasAccess) {
  ResponseHelper.notFound(res, 'Project not found');
  return;
}
```

### ✅ Project Service (Lines 251-254)

```typescript
const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
if (!accessCheck.hasAccess) {
  return null;
}
```

## hasProjectAccess Function Analysis

The `SharingService.hasProjectAccess()` function returns:

```typescript
{
  hasAccess: boolean;    // true if user owns OR has shared access
  isOwner: boolean;      // true only if user is the actual owner
  shareId?: string;      // present if access is via sharing
}
```

### Logic:

1. **First** checks if user is project owner
2. **Then** checks if project is shared with user via `ProjectShare` table
3. **Returns** `hasAccess: true` for BOTH cases

## Required Fix

### Exact Code Changes Needed

**File**: `/backend/src/api/controllers/imageController.ts`

**Add Import** (line 2-11 area):

```typescript
import * as SharingService from '../../services/sharingService';
```

**Replace Lines 604-614** with:

```typescript
// Check if user has access to this project (owner or shared)
const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
if (!accessCheck.hasAccess) {
  ResponseHelper.notFound(res, 'Projekt nenalezen nebo nemáte oprávnění');
  return;
}
```

## Impact Assessment

### ✅ Benefits

- **Fixes 404 errors** for shared project image loading
- **Aligns with standard pattern** used across the application
- **No performance impact** (hasProjectAccess is already optimized)
- **Maintains security** (still validates permissions)

### ✅ No Breaking Changes

- **Same error message** for unauthorized access
- **Same HTTP status codes**
- **Same response format**
- **Only changes** who gets access (adds shared users)

## Database Query Impact

- **Current**: 1 query (ownership check)
- **After fix**: 2-3 queries in hasProjectAccess (owner check + share check)
- **Performance**: Negligible impact (queries are indexed)

## Testing Verification Required

1. **Owner access**: Still works (hasAccess returns true for owners)
2. **Shared access**: Now works (hasAccess returns true for shared users)
3. **No access**: Still blocked (hasAccess returns false)
4. **Invalid project**: Still returns 404

## Critical Priority

This is a **blocking bug** preventing shared project functionality from working properly. The fix is **safe**, **minimal**, and **follows established patterns**.
