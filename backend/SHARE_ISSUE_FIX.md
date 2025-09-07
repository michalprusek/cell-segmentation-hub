# Backend Fix for Share Acceptance Owner Data Corruption

## Issue Analysis
After authentication redirect, shared projects show current user as owner instead of actual project owner.

## Root Cause
The backend correctly returns owner data, but there's a timing/context issue in the authentication flow that affects frontend state management.

## Required Backend Fixes

### 1. Enhanced Debugging in ShareController

Add comprehensive logging to track owner data flow:

```typescript
// In acceptShareInvitation() method - line 397
export const acceptShareInvitation = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  if (!token) {
    ResponseHelper.badRequest(res, 'Token is required');
    return;
  }

  // ADD THIS: Enhanced debugging
  logger.info('SHARE_DEBUG: Accept invitation called', {
    token: token.substring(0, 8) + '...',
    hasAuth: !!req.user,
    userId: req.user?.id,
    userEmail: req.user?.email,
    timestamp: new Date().toISOString()
  });

  try {
    const result = await SharingService.acceptShareInvitation(token, req.user?.id);
    
    // ADD THIS: Log owner data before response
    logger.info('SHARE_DEBUG: About to return response', {
      hasProjectOwner: !!result.share?.project?.user,
      projectOwnerId: result.share?.project?.user?.id,
      projectOwnerEmail: result.share?.project?.user?.email,
      currentUserId: req.user?.id,
      ownerMatchesCurrentUser: result.share?.project?.user?.id === req.user?.id
    });
    
    if (result.needsLogin) {
      ResponseHelper.success(
        res,
        {
          project: {
            id: result.share.project.id,
            title: result.share.project.title,
            description: result.share.project.description,
            owner: result.share.project.user  // Include the project owner
          },
          sharedBy: {
            email: result.share.sharedBy.email
          },
          needsLogin: true
        },
        'Please log in to accept this invitation'
      );
      return;
    }

    ResponseHelper.success(
      res,
      {
        project: {
          id: result.share.project.id,
          title: result.share.project.title,
          description: result.share.project.description,
          owner: result.share.project.user  // Include the project owner
        },
        shareId: result.share.id,
        sharedWithId: result.share.sharedWithId,
        status: result.share.status,
        accepted: true
      },
      'Share invitation accepted successfully'
    );
  } catch (error) {
    // existing error handling...
  }
});
```

### 2. Enhanced Service Layer Debugging

Add debugging in `sharingService.ts` acceptShareInvitation method:

```typescript
// In acceptShareInvitation() method around line 259
export async function acceptShareInvitation(token: string, userId?: string) {
  try {
    logger.info('SHARE_DEBUG: Service acceptShareInvitation called', {
      token: token.substring(0, 8) + '...',
      userId,
      hasUserId: !!userId
    });

    // Find the share by token
    const share = await prisma.projectShare.findFirst({
      where: {
        shareToken: token,
        status: 'pending'
      },
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
        sharedBy: true
      }
    });

    if (!share) {
      throw new Error('Invalid or expired share link');
    }

    // ADD THIS: Log original owner data
    logger.info('SHARE_DEBUG: Found share with owner data', {
      projectId: share.project.id,
      projectTitle: share.project.title,
      originalOwnerId: share.project.user.id,
      originalOwnerEmail: share.project.user.email,
      currentUserId: userId,
      shareId: share.id
    });

    // Rest of the method remains the same...
    
    // Before return, log final owner data
    const finalResult = { share: updatedShare || existingAcceptedShare, needsLogin: false };
    
    logger.info('SHARE_DEBUG: Final result owner data', {
      finalOwnerId: finalResult.share.project.user.id,
      finalOwnerEmail: finalResult.share.project.user.email,
      currentUserId: userId,
      dataIntegrity: finalResult.share.project.user.id !== userId ? 'CORRECT' : 'SUSPICIOUS'
    });
    
    return finalResult;
  } catch (error) {
    // existing error handling...
  }
}
```

### 3. Response Validation Middleware

Add middleware to validate owner data integrity:

```typescript
// Create new file: /backend/src/middleware/shareResponseValidation.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const validateShareResponse = (req: Request, res: Response, next: NextFunction) => {
  // Store original json method
  const originalJson = res.json;
  
  // Override json method to validate share responses
  res.json = function(data: any) {
    // Check if this is a share acceptance response
    if (data?.data?.project?.owner && req.user) {
      const projectOwnerId = data.data.project.owner.id;
      const currentUserId = req.user.id;
      
      if (projectOwnerId === currentUserId) {
        logger.warn('SHARE_VALIDATION: Suspicious owner data detected', {
          endpoint: req.path,
          projectOwnerId,
          currentUserId,
          projectTitle: data.data.project.title,
          userEmail: req.user.email,
          potentialDataCorruption: true
        });
      } else {
        logger.info('SHARE_VALIDATION: Owner data integrity confirmed', {
          endpoint: req.path,
          projectOwnerId,
          currentUserId,
          ownerEmail: data.data.project.owner.email,
          dataIntegrity: 'CORRECT'
        });
      }
    }
    
    // Call original json method
    return originalJson.call(this, data);
  };
  
  next();
};
```

## Testing Commands

```bash
# 1. Enable debug logging
make logs-be | grep SHARE_DEBUG

# 2. Test share acceptance flow
curl -X POST "http://localhost:3001/api/share/accept/[TOKEN]" -H "Authorization: Bearer [JWT_TOKEN]"

# 3. Monitor response validation
make logs-be | grep SHARE_VALIDATION
```

## Expected Results

With these fixes, you should see logs showing:
1. Original owner data from database (correct)
2. Owner data in service response (should be correct)
3. Owner data in controller response (should be correct)
4. Any point where current user ID overwrites owner ID (bug location)

## Next Steps

1. Deploy these debugging fixes
2. Reproduce the issue with logging enabled
3. Identify exact point where owner data gets corrupted
4. Apply targeted fix based on log analysis