# Fix for 403 Forbidden Error in Project Shares Endpoint

## Problem Description

Users with legitimate shared access to projects were receiving 403 Forbidden errors when trying to view project shares through the ShareDialog component. The error occurred on the endpoint `GET /api/projects/:id/shares`.

## Root Cause

The `getProjectShares` function in `/backend/src/api/controllers/sharingController.ts` had overly restrictive authorization logic that only allowed project owners to view shares, blocking users with accepted shared access.

### Problematic Code (lines 152-155):

```typescript
if (!accessCheck.isOwner) {
  ResponseHelper.forbidden(res, 'Only project owners can view shares');
  return;
}
```

## Solution Implemented

Modified the authorization check to allow both project owners AND users with shared access to view project shares.

### Fixed Code:

```typescript
// Check if user has access to the project (owners and users with shared access can view shares)
const accessCheck = await SharingService.hasProjectAccess(
  projectId,
  req.user.id
);
if (!accessCheck.hasAccess) {
  ResponseHelper.notFound(res, 'Project not found');
  return;
}
// Both owners and users with shared access can view shares - no additional check needed
```

## Key Points

1. **Security Maintained**: Users without any access still receive 404 responses
2. **SSOT Pattern**: Uses existing `SharingService.hasProjectAccess()` as single source of truth
3. **Access Levels**:
   - Project owners: Full access to view all shares
   - Users with accepted shares: Can view share information
   - No access: Receive 404 "Project not found"

## Testing Checklist

- ✅ Project owners can view all shares
- ✅ Users with accepted shared access can view shares
- ✅ Users without access receive 404 (not 403)
- ✅ Authentication still required (401 for unauthenticated requests)

## Files Modified

- `/backend/src/api/controllers/sharingController.ts` (lines 146-155)

## Related Components

- Frontend: `/src/components/project/ShareDialog.tsx`
- API Client: `/src/lib/api.ts` (getProjectShares method)
- Service: `/backend/src/services/sharingService.ts`
- Routes: `/backend/src/api/routes/sharingRoutes.ts`

## Future Considerations

Consider implementing differentiated responses based on user role:

- Owners: Full share details including pending invitations
- Shared users: Limited view showing only accepted shares
  This would provide more granular access control while maintaining usability.
