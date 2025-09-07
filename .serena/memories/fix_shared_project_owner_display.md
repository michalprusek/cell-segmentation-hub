# Fix for Shared Project Owner Display Issue

## Problem Description

When users accept a share invitation, the project shows the current user as the owner instead of the actual project owner. This occurs even though the database has the correct ownership information.

## Root Causes

1. **Backend didn't include owner data**: Share validation and acceptance endpoints didn't include the project owner in responses
2. **Frontend mapping issue**: The frontend expected owner data in `project.owner` but backend sent it as `project.user`
3. **Security issue**: Initial fix exposed sensitive user data (password hash)

## Solution Implemented

### Backend Changes

#### 1. Modified SharingService (`/backend/src/services/sharingService.ts`)

**Share validation and acceptance queries** - Include project owner with limited fields:

```typescript
include: {
  project: {
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    }
  },
  sharedBy: true,
  sharedWith: true
}
```

**Changes made to functions**:

- `validateShareToken()` - lines 617-630
- `acceptShareInvitation()` - lines 181-194, 215-230, 243-251

#### 2. Modified SharingController (`/backend/src/api/controllers/sharingController.ts`)

**Added owner to response objects**:

```typescript
project: {
  id: result.share.project.id,
  title: result.share.project.title,
  description: result.share.project.description,
  owner: result.share.project.user  // Include the project owner
}
```

**Changes made to endpoints**:

- `validateShareToken()` - line 365
- `acceptShareInvitation()` - lines 406 and 424

### Frontend Changes

#### Modified useDashboardProjects hook (`/src/hooks/useDashboardProjects.ts`)

**Fixed owner mapping for both owned and shared projects**:

```typescript
// For owned projects (line 87)
owner: p.user || p.owner || currentUser;

// For shared projects (line 109)
owner: p.project?.user || p.project?.owner;
```

## Key Features

1. **Security**: Only exposes `id` and `email` fields of the owner (no passwords)
2. **Consistency**: All share-related endpoints now return owner information
3. **Already accepted shares**: Handled properly - returns existing share with full data
4. **Frontend compatibility**: Works with both `user` and `owner` field names

## Testing

- Share validation endpoint: `GET /api/share/validate/:token`
- Share acceptance endpoint: `POST /api/share/accept/:token`
- Both now return: `project.owner: { id, email }`

## Verification

```bash
# Test validation endpoint
curl -X GET "http://localhost:3001/api/share/validate/[TOKEN]" | jq '.data.project.owner'
# Should return: { "id": "...", "email": "owner@example.com" }
```

## Result

- Projects shared with a user now correctly display the actual owner's email
- Share acceptance flow includes complete owner information
- No sensitive data is exposed in API responses
