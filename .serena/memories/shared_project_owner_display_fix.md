# Fix for Shared Project Owner Display Issue

## Problem Description

When a user accepts a project share invitation, the shared project appears in their dashboard but incorrectly shows them as the owner instead of the actual project owner.

**Example**: User "prusemic" accepts share from "12bprusek" → project shows owner as "prusemic" instead of "12bprusek"

## Root Cause

The issue was caused by a **route registration mismatch** in the backend:

- Frontend calls: `/api/shared/projects` (correct)
- Backend was registered as: `/api/projects/shared` (incorrect)
- This caused a 404 error, so shared projects never loaded

## Solution Applied

### 1. Fixed Route Registration

**File**: `/backend/src/api/routes/index.ts` line 228
**Change**: Updated path from `/api/projects/shared` to `/api/shared/projects`

```typescript
// Before (incorrect):
registerRoute({
  path: '/api/projects/shared',
  method: 'GET',
  description: 'Projekty sdílené se mnou',
  authenticated: true,
});

// After (correct):
registerRoute({
  path: '/api/shared/projects',
  method: 'GET',
  description: 'Projekty sdílené se mnou',
  authenticated: true,
});
```

## Data Flow Verification

### Backend API Response Structure

The backend correctly returns owner data in the response:

```json
{
  "project": {
    "id": "project-id",
    "title": "Project Name",
    "owner": {
      "id": "owner-user-id",
      "email": "owner@example.com"
    }
  },
  "sharedBy": {
    "id": "sharer-id",
    "email": "sharer@example.com"
  }
}
```

### Frontend Data Mapping

The frontend hook (`useDashboardProjects.ts` line 109) correctly maps the owner:

```typescript
owner: p.project?.user || p.project?.owner;
```

## Key Files Involved

### Backend

- `/backend/src/api/controllers/sharingController.ts` - `getSharedProjects()` method
- `/backend/src/services/sharingService.ts` - Database query with proper includes
- `/backend/src/api/routes/sharingRoutes.ts` - Route definition
- `/backend/src/api/routes/index.ts` - Route registration (FIXED)

### Frontend

- `/src/lib/api.ts` - API client calling `/shared/projects`
- `/src/hooks/useDashboardProjects.ts` - Fetches and processes shared projects
- `/src/components/ProjectCard.tsx` - Displays owner information
- `/src/components/ProjectListItem.tsx` - Shows project ownership

## Testing

After applying the fix:

1. Restart backend: `docker restart spheroseg-backend`
2. Verify endpoint: `curl -I http://localhost:3001/api/shared/projects` returns 401 (not 404)
3. Login and test shared projects appear with correct owner

## SSOT Improvements Identified

### Duplication Found

- ProjectCard and ProjectListItem duplicate owner display logic
- Should extract to shared `UserDisplay` component

### Recommended Refactoring

1. Create `/src/components/shared/UserDisplay.tsx` for consistent user display
2. Create `/src/types/user.ts` for centralized user interfaces
3. Extract user formatting utilities to `/src/lib/userUtils.ts`

## Prevention

- Always verify route registration matches actual route definition
- Use integration tests for critical user flows like sharing
- Implement SSOT patterns to prevent code duplication
