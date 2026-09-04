import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import { authenticate, requireAdmin } from '../../middleware/auth';
import {
  adminLimiter,
  impersonationLimiter,
} from '../../middleware/rateLimiter';

const router = Router();

// Every route below is authenticated. `authenticate` re-reads the `users` row
// on each request, so `req.user.isAdmin` and `req.impersonator` are always
// current — a revoked admin flag takes effect immediately rather than when
// the access token happens to expire.
router.use(authenticate);

/**
 * Ending an impersonation is the ONE admin route an impersonated session must
 * be able to reach — the live session belongs to the (non-admin) target, so
 * `requireAdmin` would make the exit unreachable. The controller instead
 * requires `req.impersonator`, which comes from a signed claim and therefore
 * cannot be forged by a user who was never impersonated.
 *
 * Declared BEFORE `/impersonate/:userId`, or Express matches that first and
 * hands the handler `userId === 'stop'`.
 */
router.post(
  '/impersonate/stop',
  impersonationLimiter,
  adminController.stopImpersonation
);

// Everything past here is admin-only AND refused to an impersonated session.
router.use(requireAdmin);

router.get('/users', adminLimiter, adminController.listUsers);

router.post(
  '/impersonate/:userId',
  impersonationLimiter,
  adminController.impersonate
);

export default router;
