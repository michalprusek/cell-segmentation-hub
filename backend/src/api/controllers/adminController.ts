import { Request, Response } from 'express';
import { z } from 'zod';
import * as AdminService from '../../services/adminService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import { setAuthCookies } from '../../utils/authCookies';
import { logger } from '../../utils/logger';

/**
 * Same resolution order as `accessLogger.getClientIP`, so an audit row and an
 * access.log line for the same request agree on where it came from.
 */
const clientIp = (req: Request): string => {
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp) {
    return xRealIp;
  }
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  return req.ip || 'unknown';
};

const originOf = (
  req: Request
): { ip: string; userAgent: string | null } => ({
  ip: clientIp(req),
  userAgent: req.get('User-Agent') ?? null,
});

const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(AdminService.MAX_USER_PAGE_SIZE)
    .optional(),
  search: z.string().trim().max(200).optional(),
});

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Seznam registrovaných uživatelů (pouze administrátor)
 */
export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return ResponseHelper.validationError(
      res,
      'Neplatné parametry dotazu',
      'Admin'
    );
  }

  const result = await AdminService.listUsers(parsed.data);

  return ResponseHelper.success(
    res,
    result,
    'Seznam uživatelů byl načten'
  );
});

/**
 * @swagger
 * /admin/impersonate/{userId}:
 *   post:
 *     tags: [Admin]
 *     summary: Přihlásit se jako vybraný uživatel (pouze administrátor)
 *     description: >-
 *       Replaces the caller's auth cookies with a session for the target. The
 *       response body carries the target user so the client can render the
 *       banner without a second round-trip; it carries no token, exactly like
 *       /auth/login.
 */
export const impersonate = asyncHandler(
  async (req: Request, res: Response) => {
    // `requireAdmin` guarantees both of these; the guard is for the type
    // narrowing and to fail loudly if the route is ever re-wired without it.
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován');
    }

    const targetUserId = req.params.userId;
    if (!targetUserId) {
      return ResponseHelper.validationError(res, 'Chybí ID uživatele', 'Admin');
    }

    const result = await AdminService.startImpersonation(
      { id: req.user.id, email: req.user.email },
      targetUserId,
      originOf(req)
    );

    // rememberMe is false: an impersonated session gets the short refresh
    // window. The admin's own cookies are overwritten here — their original
    // session stays valid server-side until its own TTL, which is the same
    // state as being signed in from a second browser.
    setAuthCookies(res, result.accessToken, result.refreshToken, {
      rememberMe: false,
    });

    return ResponseHelper.success(
      res,
      {
        user: result.user,
        impersonatedBy: { id: req.user.id, email: req.user.email },
      },
      'Přihlášení za uživatele proběhlo úspěšně'
    );
  }
);

/**
 * @swagger
 * /admin/impersonate/stop:
 *   post:
 *     tags: [Admin]
 *     summary: Ukončit impersonaci a vrátit se ke svému účtu
 *     description: >-
 *       Deliberately NOT behind `requireAdmin`: the live session belongs to
 *       the impersonated user, who is not an admin, so that gate would make
 *       the exit unreachable — the trap that turns a support tool into a
 *       one-way door. It is not forgeable in its place, because the only
 *       thing that reaches this handler is `req.impersonator`, which
 *       `authenticate` sets from a claim in the SIGNED access token. A user
 *       who was never impersonated has no such claim and gets a 400.
 */
export const stopImpersonation = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován');
    }

    if (!req.impersonator) {
      return ResponseHelper.badRequest(
        res,
        'Tato relace není impersonace',
        'Admin'
      );
    }

    const result = await AdminService.stopImpersonation(
      { id: req.impersonator.id, sessionId: req.impersonator.sessionId },
      { id: req.user.id, email: req.user.email },
      originOf(req)
    );

    setAuthCookies(res, result.accessToken, result.refreshToken, {
      rememberMe: false,
    });

    logger.info(
      `Returned to admin account ${result.admin.email}`,
      'AdminController'
    );

    return ResponseHelper.success(
      res,
      { user: result.admin },
      'Impersonace byla ukončena'
    );
  }
);
