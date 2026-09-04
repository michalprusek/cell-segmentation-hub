import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { verifyAccessToken, JwtPayload } from '../auth/jwt';
import { ResponseHelper } from '../utils/response';
import { logger } from '../utils/logger';
import { ACCESS_TOKEN_COOKIE } from '../utils/authCookies';

// Extend Express Request interface to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      email: string;
      emailVerified: boolean;
      /**
       * Platform administrator. Read fresh from the `users` row on EVERY
       * request (see `authenticate`), never from the token — so revoking the
       * flag takes effect on the next request rather than when the access
       * token happens to expire.
       */
      isAdmin: boolean;
      profile?: {
        id: string;
        userId: string;
        username?: string | null;
        avatarUrl?: string | null;
        avatarPath?: string | null;
        avatarMimeType?: string | null;
        avatarSize?: number | null;
        bio?: string | null;
        organization?: string | null;
        location?: string | null;
        title?: string | null;
        publicProfile: boolean;
        preferredModel: string;
        modelThreshold: number;
        preferredLang: string;
        preferredTheme: string;
        emailNotifications: boolean;
        consentToMLTraining: boolean;
        consentToAlgorithmImprovement: boolean;
        consentToFeatureDevelopment: boolean;
        consentUpdatedAt?: Date | null;
        createdAt: Date;
        updatedAt: Date;
      } | null;
    };
    /**
     * Set only while an admin is acting AS someone else. `req.user` stays the
     * impersonated user — that is what makes every ownership check downstream
     * work unchanged — so this is the ONLY place the real actor is recorded.
     *
     * Anything that attributes an action to a person must prefer it: see
     * `accessLogger`, which would otherwise write the target's e-mail into
     * access.log for requests the target never made.
     */
    impersonator?: {
      id: string;
      email: string;
      /** Correlates with the `impersonation_logs` rows for this session. */
      sessionId: string;
    };
  }
}

/**
 * Middleware to authenticate user using JWT token
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.cookies?.[ACCESS_TOKEN_COOKIE];

    if (!token) {
      ResponseHelper.unauthorized(res, 'Chybí autentizační token', 'Auth');
      return;
    }

    // Verify the token
    let payload: JwtPayload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('expired')) {
        ResponseHelper.unauthorized(res, 'Token vypršel', 'Auth');
        return;
      } else {
        ResponseHelper.unauthorized(res, 'Neplatný token', 'Auth');
        return;
      }
    }

    // Get user from database
    // `select`, not `include`: this is the highest-frequency query in the
    // backend (every authenticated request), and the default User shape ships
    // the bcrypt hash, verificationToken, resetToken and resetTokenExpiry —
    // four columns nothing below reads. Same narrowing #476 applied to the
    // colder call sites in queueController and sharingService.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        isAdmin: true,
        profile: true,
      },
    });

    if (!user) {
      ResponseHelper.unauthorized(res, 'Uživatel nenalezen', 'Auth');
      return;
    }

    // Add user to request object
    req.user = {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      isAdmin: user.isAdmin,
      profile: user.profile,
    };

    // Impersonated session: the token names an admin who is really acting.
    // The claim is signed, so it cannot be forged — but the ADMIN FLAG behind
    // it can be revoked, and this row is re-read here for the same reason
    // `req.user` is: a session must not outlive the privilege that created
    // it. A revoked admin's impersonated session is refused outright rather
    // than quietly downgraded to the target's own session, which would leave
    // the operator logged in as someone else with no banner and no way back.
    if (payload.impersonatorId) {
      const impersonator = await prisma.user.findUnique({
        where: { id: payload.impersonatorId },
        select: { id: true, email: true, isAdmin: true },
      });

      if (!impersonator?.isAdmin) {
        ResponseHelper.unauthorized(
          res,
          'Impersonace byla ukončena: účet již nemá práva administrátora',
          'Auth'
        );
        return;
      }

      // The two claims are minted together and must arrive together. Falling
      // back to '' would be worse than rejecting: `revokeImpersonatedSession('')`
      // silently deletes nothing, and every audit row would be written with an
      // empty `sessionId`, so start and stop could no longer be correlated —
      // a session that is live but unaddressable and untraceable.
      if (!payload.impersonationSessionId) {
        logger.warn(
          `Impersonation token for ${impersonator.email} carries no session id; rejecting`,
          'Auth'
        );
        ResponseHelper.unauthorized(res, 'Neplatný token', 'Auth');
        return;
      }

      req.impersonator = {
        id: impersonator.id,
        email: impersonator.email,
        sessionId: payload.impersonationSessionId,
      };
    }

    return next();
  } catch (error) {
    logger.error('Authentication middleware error:', error as Error, 'Auth');
    ResponseHelper.internalError(
      res,
      error as Error,
      'Chyba autentizace',
      'Auth'
    );
    return;
  }
};

/**
 * Middleware to require email verification
 */
export const requireEmailVerification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'Auth');
    return;
  }

  if (!req.user.emailVerified) {
    ResponseHelper.forbidden(res, 'Email není ověřen', 'Auth');
    return;
  }

  return next();
};

/**
 * Gate for the `/api/admin` routes. Must run AFTER `authenticate`, which is
 * what puts the freshly-read `isAdmin` on `req.user`.
 *
 * Two refusals, not one:
 *
 *   1. `req.user.isAdmin` is false — the ordinary case.
 *   2. `req.impersonator` is set — the session is someone acting AS a user,
 *      so it must not reach an admin route even when the impersonated account
 *      happens to be an admin itself. Without this the privilege check would
 *      pass on the TARGET's flag, and an admin session would be able to walk
 *      from one account into the next while every audit row and access-log
 *      line named the wrong actor. `POST /impersonate/stop` is deliberately
 *      NOT behind this middleware — it is the one thing an impersonated
 *      session must be able to do.
 *
 * There is no client-side counterpart to this check; the frontend's admin
 * gate only decides what to render.
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'Auth');
    return;
  }

  if (req.impersonator) {
    logger.warn(
      `Admin route refused for impersonated session: ${req.impersonator.email} acting as ${req.user.email}`,
      'Auth'
    );
    ResponseHelper.forbidden(
      res,
      'Během impersonace nejsou administrátorské akce povoleny',
      'Auth'
    );
    return;
  }

  if (!req.user.isAdmin) {
    // Logged, not written to `impersonation_logs`: that table records what
    // admins DID, and a row per 403 would mean a database write on every
    // stale tab hitting the admin surface. access.log already carries the
    // request; this line names the reason.
    logger.warn(
      `Admin route refused for non-admin account ${req.user.email}`,
      'Auth'
    );
    ResponseHelper.forbidden(res, 'Vyžadována práva administrátora', 'Auth');
    return;
  }

  return next();
};

/**
 * Middleware to check if user owns resource
 */
export const requireResourceOwnership = (
  resourceModel: string,
  resourceUserIdField = 'userId'
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'Auth');
      return;
    }

    // Get resource ID from params
    const resourceId = req.params.id;
    if (!resourceId) {
      ResponseHelper.validationError(res, 'Chybí ID zdroje', 'Auth');
      return;
    }

    try {
      // Validate that the provided resource model exists in Prisma
      if (!(resourceModel in prisma)) {
        throw new Error(`Invalid resource model: ${resourceModel}`);
      }

      // Dynamic access to Prisma model with proper typing
      const model = (
        prisma as unknown as Record<
          string,
          {
            findUnique: (args: {
              where: { id: string };
              select: Record<string, boolean>;
            }) => Promise<Record<string, unknown> | null>;
          }
        >
      )[resourceModel];

      // Check if model is valid
      if (!model || typeof model.findUnique !== 'function') {
        ResponseHelper.badRequest(res, 'Invalid resource model', 'Auth');
        return;
      }

      const resource = await model.findUnique({
        where: { id: resourceId },
        select: { [resourceUserIdField]: true },
      });

      if (!resource) {
        ResponseHelper.notFound(res, 'Zdroj nenalezen', 'Auth');
        return;
      }

      // Check if the resource has the expected field
      if (!(resourceUserIdField in resource)) {
        ResponseHelper.internalError(
          res,
          new Error(`Resource missing field: ${resourceUserIdField}`),
          'Invalid resource structure',
          'Auth'
        );
        return;
      }

      if (resource[resourceUserIdField] !== req.user.id) {
        ResponseHelper.forbidden(res, 'Nedostatečná oprávnění', 'Auth');
        return;
      }

      return next();
    } catch (error) {
      logger.error('Resource ownership check failed:', error as Error, 'Auth');
      ResponseHelper.internalError(
        res,
        error as Error,
        'Chyba kontroly oprávnění',
        'Auth'
      );
      return;
    }
  };
};

/**
 * Optional authentication middleware - adds user to request if token is valid, but doesn't require it
 */
export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.cookies?.[ACCESS_TOKEN_COOKIE];

    if (!token) {
      return next(); // No token, continue without user
    }

    // Verify the token
    let payload: JwtPayload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return next(); // Invalid token, continue without user
    }

    // Get user from database
    // `select`, not `include`: this is the highest-frequency query in the
    // backend (every authenticated request), and the default User shape ships
    // the bcrypt hash, verificationToken, resetToken and resetTokenExpiry —
    // four columns nothing below reads. Same narrowing #476 applied to the
    // colder call sites in queueController and sharingService.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        isAdmin: true,
        profile: true,
      },
    });

    if (user) {
      // An impersonated token reaching an optionally-authenticated route (the
      // share-invitation endpoints) must still be attributed to the real
      // actor, and must still stop working when the admin flag is revoked.
      // Unlike `authenticate` this path cannot reject — its contract is
      // "continue without a user" — so a revoked impersonation degrades to
      // anonymous rather than silently becoming the target's own session.
      if (payload.impersonatorId) {
        const impersonator = await prisma.user.findUnique({
          where: { id: payload.impersonatorId },
          select: { id: true, email: true, isAdmin: true },
        });
        // Same pairing rule as `authenticate`; here the contract is "continue
        // without a user", so a malformed impersonation degrades to anonymous.
        if (!impersonator?.isAdmin || !payload.impersonationSessionId) {
          return next();
        }
        req.impersonator = {
          id: impersonator.id,
          email: impersonator.email,
          sessionId: payload.impersonationSessionId,
        };
      }

      req.user = {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        isAdmin: user.isAdmin,
        profile: user.profile,
      };
    }

    return next();
  } catch (error) {
    logger.error('Optional authentication error:', error as Error, 'Auth');
    return next(); // Error occurred, continue without user
  }
};
