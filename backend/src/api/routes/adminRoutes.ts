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
 * ORDER: both limiters run BEFORE `requireAdmin`, so a REFUSED request still
 * consumes the budget.
 *
 * With the limiter behind the gate, only callers who already passed it are
 * throttled — which is backwards. The traffic most worth slowing is exactly
 * the traffic that gets a 403: an ordinary compromised account walking user
 * ids through `/impersonate/:userId` would otherwise get unlimited attempts,
 * each one free.
 *
 * They are keyed `user:<id>` (see `generateRateLimitKey`), so one caller's
 * probing cannot exhaust anybody else's budget.
 */
router.use('/impersonate', impersonationLimiter);

/**
 * Ending an impersonation is the ONE admin route an impersonated session must
 * be able to reach — the live session belongs to the (non-admin) target, so
 * `requireAdmin` would make the exit unreachable. The controller instead
 * requires `req.impersonator`, which comes from a signed claim and therefore
 * cannot be forged by a user who was never impersonated.
 *
 * Declared BEFORE `/impersonate/:userId`, or Express matches that first and
 * hands the handler `userId === 'stop'`. It is also declared before
 * `adminLimiter` below, so browsing the user list can never exhaust the
 * budget for getting back OUT of an impersonated session.
 */
router.post('/impersonate/stop', adminController.stopImpersonation);

router.use(adminLimiter);

// Everything past here is admin-only AND refused to an impersonated session.
router.use(requireAdmin);

router.get('/users', adminController.listUsers);

router.post('/impersonate/:userId', adminController.impersonate);

export default router;
