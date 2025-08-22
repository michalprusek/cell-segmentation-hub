import { Router } from 'express';
import {
  shareProjectByEmail,
  shareProjectByLink,
  getProjectShares,
  revokeProjectShare,
  acceptShareInvitation,
  getSharedProjects,
  validateShareToken
} from '../controllers/sharingController';
import { authenticate } from '../../middleware/auth';
import { validateBody, validateParams } from '../../middleware/validation';
import {
  shareByEmailSchema,
  shareByLinkSchema,
  projectIdSchema,
  shareIdSchema,
  shareTokenSchema
} from '../../types/validation';

const router = Router();

/**
 * POST /api/projects/:id/share/email
 * Share project via email invitation
 */
router.post(
  '/projects/:id/share/email',
  authenticate,
  validateParams(projectIdSchema),
  validateBody(shareByEmailSchema),
  shareProjectByEmail
);

/**
 * POST /api/projects/:id/share/link
 * Generate shareable link for project
 */
router.post(
  '/projects/:id/share/link',
  authenticate,
  validateParams(projectIdSchema),
  validateBody(shareByLinkSchema),
  shareProjectByLink
);

/**
 * GET /api/projects/:id/shares
 * Get all shares for a project
 */
router.get(
  '/projects/:id/shares',
  authenticate,
  validateParams(projectIdSchema),
  getProjectShares
);

/**
 * DELETE /api/projects/:id/shares/:shareId
 * Revoke a project share
 */
router.delete(
  '/projects/:id/shares/:shareId',
  authenticate,
  validateParams(projectIdSchema.merge(shareIdSchema)),
  revokeProjectShare
);

/**
 * GET /api/shared/projects
 * Get all projects shared with the current user
 */
router.get(
  '/shared/projects',
  authenticate,
  getSharedProjects
);

/**
 * GET /api/share/validate/:token
 * Validate a share token (public endpoint)
 */
router.get(
  '/share/validate/:token',
  validateParams(shareTokenSchema),
  validateShareToken
);

/**
 * POST /api/share/accept/:token
 * Accept a share invitation
 */
router.post(
  '/share/accept/:token',
  validateParams(shareTokenSchema),
  acceptShareInvitation
);

export default router;