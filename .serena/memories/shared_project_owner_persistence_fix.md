# Shared Project Owner Persistence Fix

## Problem

After logout and re-login, shared projects incorrectly displayed the current user as the owner instead of the actual project owner. This happened because the shared project data wasn't being properly mapped from the backend response structure.

## Root Cause

The backend API sends shared projects with this structure:

```javascript
{
  project: {
    id: "...",
    name: "...",
    title: "...",
    owner: { id: "...", email: "..." }  // Owner info is here
  },
  sharedBy: { id: "...", email: "..." },
  shareId: "...",
  status: "accepted"
}
```

However, the frontend code in `useDashboardProjects.ts` was incorrectly trying to get the owner from `p.project?.user || p.project?.owner`, when the owner was actually at `p.project.owner`.

## Solution

Fixed the mapping in `/src/hooks/useDashboardProjects.ts` (lines 92-122):

1. Properly extract the project data: `const project = p.project || p;`
2. Use the correct owner field: `owner: project.owner`
3. Added better debug logging to track the data structure

## Files Modified

- `/src/hooks/useDashboardProjects.ts` - Fixed owner mapping for shared projects

## Testing

To verify the fix:

1. User A shares a project with User B
2. User B accepts the invitation (project shows as shared with correct owner)
3. User B logs out and logs back in
4. The shared project should still show as shared with User A as the owner (not User B)

## Related Issues

- Route mismatch for shared projects endpoint (fixed)
- Race conditions in share acceptance flow (fixed)
- Queue permissions for shared projects (fixed)
