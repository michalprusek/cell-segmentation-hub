import { Request, Response } from 'express';
import * as SharingService from '../../services/sharingService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import { ShareByEmailData, ShareByLinkData } from '../../types/validation';
import { logger } from '../../utils/logger';

/**
 * Share project via email invitation
 * POST /api/projects/:id/share/email
 */
export const shareProjectByEmail = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    ResponseHelper.unauthorized(res, 'User not authenticated', 'SharingController');
    return;
  }

  const projectId = req.params.id;
  if (!projectId) {
    ResponseHelper.badRequest(res, 'Project ID is required');
    return;
  }

  const data: ShareByEmailData = req.body;

  try {
    // Check if user owns the project (only owners can share projects)
    const accessCheck = await SharingService.hasProjectAccess(projectId, req.user.id);
    if (!accessCheck.hasAccess) {
      ResponseHelper.notFound(res, 'Project not found');
      return;
    }
    if (!accessCheck.isOwner) {
      ResponseHelper.forbidden(res, 'Only project owners can share projects');
      return;
    }

    const share = await SharingService.shareProjectByEmail(projectId, req.user!.id, data);
    
    ResponseHelper.success(
      res,
      {
        id: share.id,
        email: share.email,
        status: share.status,
        createdAt: share.createdAt
      },
      'Project shared successfully via email',
      201
    );
  } catch (error) {
    logger.error('Failed to share project by email:', error as Error, 'SharingController', {
      userId: req.user!.id,
      projectId,
      email: data.email
    });

    const errorMessage = (error as Error).message;
    if (errorMessage.includes('not found') || errorMessage.includes('access denied')) {
      ResponseHelper.notFound(res, 'Project not found');
    } else if (errorMessage.includes('already shared') || errorMessage.includes('Cannot share')) {
      ResponseHelper.badRequest(res, errorMessage);
    } else {
      ResponseHelper.internalError(res, error as Error, 'Failed to share project', 'SharingController');
    }
  }
});

/**
 * Generate shareable link for project
 * POST /api/projects/:id/share/link
 */
export const shareProjectByLink = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    ResponseHelper.unauthorized(res, 'User not authenticated', 'SharingController');
    return;
  }

  const projectId = req.params.id;
  if (!projectId) {
    ResponseHelper.badRequest(res, 'Project ID is required');
    return;
  }

  const data: ShareByLinkData = req.body;

  try {
    // Check if user owns the project (only owners can share projects)
    const accessCheck = await SharingService.hasProjectAccess(projectId, req.user.id);
    if (!accessCheck.hasAccess) {
      ResponseHelper.notFound(res, 'Project not found');
      return;
    }
    if (!accessCheck.isOwner) {
      ResponseHelper.forbidden(res, 'Only project owners can share projects');
      return;
    }

    const share = await SharingService.shareProjectByLink(projectId, req.user!.id, data);
    
    const shareUrl = `${process.env.FRONTEND_URL}/share/accept/${share.shareToken}`;
    
    ResponseHelper.success(
      res,
      {
        id: share.id,
        shareToken: share.shareToken,
        shareUrl,
        tokenExpiry: share.tokenExpiry,
        createdAt: share.createdAt
      },
      'Shareable link generated successfully',
      201
    );
  } catch (error) {
    logger.error('Failed to generate shareable link:', error as Error, 'SharingController', {
      userId: req.user!.id,
      projectId
    });

    const errorMessage = (error as Error).message;
    if (errorMessage.includes('not found') || errorMessage.includes('access denied')) {
      ResponseHelper.notFound(res, 'Project not found');
    } else {
      ResponseHelper.internalError(res, error as Error, 'Failed to generate shareable link', 'SharingController');
    }
  }
});

/**
 * Get all shares for a project
 * GET /api/projects/:id/shares
 */
export const getProjectShares = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    ResponseHelper.unauthorized(res, 'User not authenticated', 'SharingController');
    return;
  }

  const projectId = req.params.id;
  if (!projectId) {
    ResponseHelper.badRequest(res, 'Project ID is required');
    return;
  }

  try {
    // Debug logging for the access check
    logger.debug('Starting getProjectShares access check', 'SharingController', {
      userId: req.user.id,
      projectId
    });

    // Check if user has access to the project (owners and users with shared access can view shares)
    const accessCheck = await SharingService.hasProjectAccess(projectId, req.user.id);
    
    logger.debug('hasProjectAccess result', 'SharingController', {
      userId: req.user.id,
      projectId,
      hasAccess: accessCheck.hasAccess,
      isOwner: accessCheck.isOwner
    });

    if (!accessCheck.hasAccess) {
      logger.debug('Access denied - returning 404', 'SharingController', {
        userId: req.user.id,
        projectId
      });
      ResponseHelper.notFound(res, 'Project not found');
      return;
    }
    // Both owners and users with shared access can view shares - no additional check needed

    const shares = await SharingService.getProjectShares(projectId, req.user!.id);
    
    const formattedShares = shares.map(share => ({
      id: share.id,
      email: share.email,
      sharedWith: share.sharedWith ? {
        id: share.sharedWith.id,
        email: share.sharedWith.email
      } : null,
      status: share.status,
      shareToken: share.shareToken,
      shareUrl: `${process.env.FRONTEND_URL}/share/accept/${share.shareToken}`,
      tokenExpiry: share.tokenExpiry,
      createdAt: share.createdAt
    }));

    ResponseHelper.success(
      res,
      formattedShares,
      'Project shares retrieved successfully'
    );
  } catch (error) {
    logger.error('Failed to get project shares:', error as Error, 'SharingController', {
      userId: req.user!.id,
      projectId
    });

    const errorMessage = (error as Error).message;
    if (errorMessage.includes('not found') || errorMessage.includes('access denied')) {
      ResponseHelper.notFound(res, 'Project not found');
    } else {
      ResponseHelper.internalError(res, error as Error, 'Failed to get project shares', 'SharingController');
    }
  }
});

/**
 * Revoke a project share
 * DELETE /api/projects/:id/shares/:shareId
 */
export const revokeProjectShare = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    ResponseHelper.unauthorized(res, 'User not authenticated', 'SharingController');
    return;
  }

  const { shareId } = req.params;
  if (!shareId) {
    ResponseHelper.badRequest(res, 'Share ID is required');
    return;
  }

  try {
    await SharingService.revokeShare(shareId, req.user!.id);
    
    ResponseHelper.success(
      res,
      null,
      'Share revoked successfully'
    );
  } catch (error) {
    logger.error('Failed to revoke share:', error as Error, 'SharingController', {
      userId: req.user!.id,
      shareId
    });

    const errorMessage = (error as Error).message;
    if (errorMessage.includes('not found') || errorMessage.includes('access denied')) {
      ResponseHelper.notFound(res, 'Share not found');
    } else {
      ResponseHelper.internalError(res, error as Error, 'Failed to revoke share', 'SharingController');
    }
  }
});

/**
 * Get all projects shared with the current user
 * GET /api/projects/shared
 */
export const getSharedProjects = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    ResponseHelper.unauthorized(res, 'User not authenticated', 'SharingController');
    return;
  }

  try {
    const shares = await SharingService.getSharedProjects(req.user!.id);
    
    logger.info(`Found ${shares?.length || 0} shared projects for user`, 'SharingController', {
      userId: req.user!.id,
      shareCount: shares?.length || 0
    });
    
    // Handle case when no shares exist
    if (!shares || shares.length === 0) {
      ResponseHelper.success(res, [], 'No shared projects found');
      return;
    }
    
    // Debug log to check data structure
    if (shares.length > 0) {
      logger.info('First share data structure:', 'SharingController', {
        hasProject: !!shares[0].project,
        hasUser: !!shares[0].project?.user,
        projectUserId: shares[0].project?.user?.id,
        projectUserEmail: shares[0].project?.user?.email,
        sharedById: shares[0].sharedBy?.id,
        sharedByEmail: shares[0].sharedBy?.email
      });
    }

    const formattedProjects = shares
      .filter(share => 
        share.project && 
        share.sharedBy &&
        share.project.user &&
        share.project.id &&
        share.project.title &&
        share.sharedBy.id &&
        share.sharedBy.email &&
        share.project.user.id &&
        share.project.user.email
      ) // Filter out shares with missing data or incomplete nested properties
      .map(share => ({
      project: {
        id: share.project.id,
        name: share.project.title, // Use 'name' for consistency with owned projects
        title: share.project.title,
        description: share.project.description,
        createdAt: share.project.createdAt,
        updatedAt: share.project.updatedAt,
        owner: {
          id: share.project.user.id,
          email: share.project.user.email
        },
        image_count: (share.project as any)._count?.images || 0,
        images: (share.project as any).images || [],
        updated_at: share.project.updatedAt
      },
      sharedBy: {
        id: share.sharedBy.id,
        email: share.sharedBy.email
      },
      status: share.status,
      shareId: share.id,
      sharedAt: share.createdAt,
      isShared: true
    }));

    ResponseHelper.success(
      res,
      formattedProjects,
      'Shared projects retrieved successfully'
    );
  } catch (error) {
    logger.error('Failed to get shared projects:', error as Error, 'SharingController', {
      userId: req.user!.id
    });

    ResponseHelper.internalError(res, error as Error, 'Failed to get shared projects', 'SharingController');
  }
});

/**
 * Validate a share token (public endpoint)
 * GET /api/share/validate/:token
 */
export const validateShareToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  if (!token) {
    ResponseHelper.badRequest(res, 'Token is required');
    return;
  }

  try {
    const share = await SharingService.validateShareToken(token);
    
    if (!share) {
      ResponseHelper.notFound(res, 'Invalid or expired share link');
      return;
    }

    ResponseHelper.success(
      res,
      {
        project: {
          id: share.project.id,
          title: share.project.title,
          description: share.project.description,
          owner: share.project.user  // Include the project owner
        },
        sharedBy: {
          email: share.sharedBy.email
        },
        status: share.status,
        email: share.email,
        needsLogin: !req.user
      },
      'Share token validated successfully'
    );
  } catch (error) {
    logger.error('Failed to validate share token:', error as Error, 'SharingController', {
      token
    });

    ResponseHelper.internalError(res, error as Error, 'Failed to validate share token', 'SharingController');
  }
});

/**
 * Accept a share invitation
 * POST /api/share/accept/:token
 */
export const acceptShareInvitation = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  if (!token) {
    ResponseHelper.badRequest(res, 'Token is required');
    return;
  }

  try {
    const result = await SharingService.acceptShareInvitation(token, req.user?.id);
    
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
    logger.error('Failed to accept share invitation:', error as Error, 'SharingController', {
      token,
      userId: req.user?.id
    });

    const errorMessage = (error as Error).message;
    if (errorMessage.includes('Invalid') || errorMessage.includes('expired')) {
      ResponseHelper.notFound(res, errorMessage);
    } else if (errorMessage.includes('different email')) {
      ResponseHelper.badRequest(res, errorMessage);
    } else {
      ResponseHelper.internalError(res, error as Error, 'Failed to accept share invitation', 'SharingController');
    }
  }
});