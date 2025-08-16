import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { verifyAccessToken, extractTokenFromHeader, JwtPayload } from '../auth/jwt';
import { ResponseHelper } from '../utils/response';
import { logger } from '../utils/logger';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        emailVerified: boolean;
        profile?: any;
      };
    }
  }
}

/**
 * Middleware to authenticate user using JWT token
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return ResponseHelper.unauthorized(res, 'Chybí autentizační token', 'Auth');
    }

    // Verify the token
    let payload: JwtPayload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('expired')) {
        return ResponseHelper.unauthorized(res, 'Token vypršel', 'Auth');
      } else {
        return ResponseHelper.unauthorized(res, 'Neplatný token', 'Auth');
      }
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        profile: true
      }
    });

    if (!user) {
      return ResponseHelper.unauthorized(res, 'Uživatel nenalezen', 'Auth');
    }

    // Add user to request object
    req.user = {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      profile: user.profile
    };

    return next();
  } catch (error) {
    logger.error('Authentication middleware error:', error as Error, 'Auth');
    return ResponseHelper.internalError(res, error as Error, 'Chyba autentizace', 'Auth');
  }
};

/**
 * Middleware to require email verification
 */
export const requireEmailVerification = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'Auth');
  }

  if (!req.user.emailVerified) {
    return ResponseHelper.forbidden(res, 'Email není ověřen', 'Auth');
  }

  return next();
};

/**
 * Middleware to check if user owns resource
 */
export const requireResourceOwnership = (resourceModel: string, resourceUserIdField: string = 'userId') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'Auth');
    }

    // Get resource ID from params
    const resourceId = req.params.id;
    if (!resourceId) {
      return ResponseHelper.validationError(res, 'Chybí ID zdroje', 'Auth');
    }

    try {
      // Validate that the provided resource model exists in Prisma
      if (!(resourceModel in prisma)) {
        throw new Error(`Invalid resource model: ${resourceModel}`);
      }

      // Dynamic access to Prisma model
      const model = (prisma as any)[resourceModel];
      
      const resource = await model.findUnique({
        where: { id: resourceId },
        select: { [resourceUserIdField]: true }
      });

      if (!resource) {
        return ResponseHelper.notFound(res, 'Zdroj nenalezen', 'Auth');
      }

      if (resource[resourceUserIdField] !== req.user.id) {
        return ResponseHelper.forbidden(res, 'Nedostatečná oprávnění', 'Auth');
      }

      return next();
    } catch (error) {
      logger.error('Resource ownership check failed:', error as Error, 'Auth');
      return ResponseHelper.internalError(res, error as Error, 'Chyba kontroly oprávnění', 'Auth');
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
) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return next(); // No token, continue without user
    }

    // Verify the token
    let payload: JwtPayload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      return next(); // Invalid token, continue without user
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        profile: true
      }
    });

    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        profile: user.profile
      };
    }

    return next();
  } catch (error) {
    logger.error('Optional authentication error:', error as Error, 'Auth');
    return next(); // Error occurred, continue without user
  }
};