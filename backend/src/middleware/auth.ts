import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import {
  verifyAccessToken,
  extractTokenFromHeader,
  JwtPayload,
} from '../auth/jwt';
import { ResponseHelper } from '../utils/response';
import { logger } from '../utils/logger';

// Extend Express Request interface to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      email: string;
      emailVerified: boolean;
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
    const token = extractTokenFromHeader(req.headers.authorization);

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
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
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
      profile: user.profile,
    };

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
    const token = extractTokenFromHeader(req.headers.authorization);

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
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        profile: true,
      },
    });

    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        profile: user.profile,
      };
    }

    return next();
  } catch (error) {
    logger.error('Optional authentication error:', error as Error, 'Auth');
    return next(); // Error occurred, continue without user
  }
};
