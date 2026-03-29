import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
} from '@jest/globals';
import { Request, Response, NextFunction } from 'express';

// All mocks BEFORE source imports
jest.mock('../../db', () => ({
  __esModule: true,
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../auth/jwt', () => ({
  __esModule: true,
  extractTokenFromHeader: jest.fn(),
  verifyAccessToken: jest.fn(),
}));

jest.mock('../../utils/response', () => ({
  __esModule: true,
  ResponseHelper: {
    unauthorized: jest.fn(),
    forbidden: jest.fn(),
    notFound: jest.fn(),
    validationError: jest.fn(),
    badRequest: jest.fn(),
    internalError: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { prisma } from '../../db';
import {
  extractTokenFromHeader,
  verifyAccessToken,
  JwtPayload,
} from '../../auth/jwt';
import { ResponseHelper } from '../../utils/response';
import {
  authenticate,
  requireEmailVerification,
  requireResourceOwnership,
  optionalAuthenticate,
} from '../auth';

// Typed mock helpers
const mockExtractTokenFromHeader = extractTokenFromHeader as jest.MockedFunction<
  typeof extractTokenFromHeader
>;
const mockVerifyAccessToken = verifyAccessToken as jest.MockedFunction<
  typeof verifyAccessToken
>;
const mockPrismaUserFindUnique = prisma.user.findUnique as jest.MockedFunction<
  typeof prisma.user.findUnique
>;

const buildUser = (overrides: Partial<{
  id: string;
  email: string;
  emailVerified: boolean;
  profile: null;
}> = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  emailVerified: true,
  profile: null,
  ...overrides,
});

const buildPayload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
  userId: 'user-123',
  email: 'test@example.com',
  emailVerified: true,
  ...overrides,
});

describe('Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      headers: {},
      params: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      json: jest.fn().mockReturnThis() as unknown as Response['json'],
      send: jest.fn().mockReturnThis() as unknown as Response['send'],
      headersSent: false,
    };

    mockNext = jest.fn() as NextFunction;
  });

  // -----------------------------------------------------------------------
  // authenticate
  // -----------------------------------------------------------------------
  describe('authenticate', () => {
    it('returns 401 when Authorization header is absent', async () => {
      mockReq.headers = {};
      mockExtractTokenFromHeader.mockReturnValue(null);

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
        mockRes,
        expect.any(String),
        'Auth'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 when token extraction returns null', async () => {
      mockReq.headers = { authorization: 'InvalidHeader' };
      mockExtractTokenFromHeader.mockReturnValue(null);

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.unauthorized).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 with expired-token message when token is expired', async () => {
      mockReq.headers = { authorization: 'Bearer expired.token.here' };
      mockExtractTokenFromHeader.mockReturnValue('expired.token.here');
      mockVerifyAccessToken.mockImplementation(() => {
        throw new Error('Access token expired');
      });

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
        mockRes,
        'Token vypršel',
        'Auth'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 with invalid-token message for other JWT errors', async () => {
      mockReq.headers = { authorization: 'Bearer bad.token' };
      mockExtractTokenFromHeader.mockReturnValue('bad.token');
      mockVerifyAccessToken.mockImplementation(() => {
        throw new Error('Invalid access token');
      });

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
        mockRes,
        'Neplatný token',
        'Auth'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 when user is not found in the database', async () => {
      mockReq.headers = { authorization: 'Bearer valid.token' };
      mockExtractTokenFromHeader.mockReturnValue('valid.token');
      mockVerifyAccessToken.mockReturnValue(buildPayload());
      mockPrismaUserFindUnique.mockResolvedValue(null);

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
        mockRes,
        'Uživatel nenalezen',
        'Auth'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('sets req.user with correct fields on success', async () => {
      mockReq.headers = { authorization: 'Bearer valid.token' };
      mockExtractTokenFromHeader.mockReturnValue('valid.token');
      mockVerifyAccessToken.mockReturnValue(buildPayload());
      const dbUser = buildUser();
      mockPrismaUserFindUnique.mockResolvedValue(dbUser as never);

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.user).toEqual({
        id: dbUser.id,
        email: dbUser.email,
        emailVerified: dbUser.emailVerified,
        profile: dbUser.profile,
      });
    });

    it('calls next() on successful authentication', async () => {
      mockReq.headers = { authorization: 'Bearer valid.token' };
      mockExtractTokenFromHeader.mockReturnValue('valid.token');
      mockVerifyAccessToken.mockReturnValue(buildPayload());
      mockPrismaUserFindUnique.mockResolvedValue(buildUser() as never);

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(ResponseHelper.unauthorized).not.toHaveBeenCalled();
    });

    it('returns 500 on an unexpected error', async () => {
      mockReq.headers = { authorization: 'Bearer valid.token' };
      mockExtractTokenFromHeader.mockReturnValue('valid.token');
      mockVerifyAccessToken.mockReturnValue(buildPayload());
      mockPrismaUserFindUnique.mockRejectedValue(
        new Error('DB connection failed')
      );

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.internalError).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // requireEmailVerification
  // -----------------------------------------------------------------------
  describe('requireEmailVerification', () => {
    it('returns 401 when req.user is undefined', () => {
      mockReq.user = undefined;

      requireEmailVerification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
        mockRes,
        expect.any(String),
        'Auth'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 403 when emailVerified is false', () => {
      mockReq.user = {
        id: 'user-123',
        email: 'test@example.com',
        emailVerified: false,
      };

      requireEmailVerification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(ResponseHelper.forbidden).toHaveBeenCalledWith(
        mockRes,
        'Email není ověřen',
        'Auth'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('calls next() when email is verified', () => {
      mockReq.user = {
        id: 'user-123',
        email: 'test@example.com',
        emailVerified: true,
      };

      requireEmailVerification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(ResponseHelper.forbidden).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // requireResourceOwnership
  // -----------------------------------------------------------------------
  describe('requireResourceOwnership', () => {
    // The middleware accepts a resource model name; we use 'user' since it
    // exists on the prismaMock created in setup.ts. However the auth module
    // uses the `prisma` instance imported from '../../db', which is also
    // mocked. We can spy on it directly.
    const middleware = requireResourceOwnership('user', 'userId');

    it('returns 401 when req.user is not set', async () => {
      mockReq.user = undefined;
      mockReq.params = { id: 'res-123' };

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.unauthorized).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 when the resource is not found', async () => {
      mockReq.user = buildUser();
      mockReq.params = { id: 'nonexistent' };

      // The middleware does dynamic access: (prisma as any)['user'].findUnique
      mockPrismaUserFindUnique.mockResolvedValue(null);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(
        mockRes,
        'Zdroj nenalezen',
        'Auth'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 403 when user does not own the resource', async () => {
      mockReq.user = buildUser({ id: 'user-abc' });
      mockReq.params = { id: 'res-123' };

      mockPrismaUserFindUnique.mockResolvedValue(
        { userId: 'different-owner' } as never
      );

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.forbidden).toHaveBeenCalledWith(
        mockRes,
        'Nedostatečná oprávnění',
        'Auth'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('calls next() when user owns the resource', async () => {
      mockReq.user = buildUser({ id: 'user-123' });
      mockReq.params = { id: 'res-123' };

      mockPrismaUserFindUnique.mockResolvedValue(
        { userId: 'user-123' } as never
      );

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(ResponseHelper.forbidden).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // optionalAuthenticate
  // -----------------------------------------------------------------------
  describe('optionalAuthenticate', () => {
    it('calls next() without setting req.user when no token is present', async () => {
      mockReq.headers = {};
      mockExtractTokenFromHeader.mockReturnValue(null);

      await optionalAuthenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it('sets req.user and calls next() when token is valid', async () => {
      mockReq.headers = { authorization: 'Bearer valid.token' };
      mockExtractTokenFromHeader.mockReturnValue('valid.token');
      mockVerifyAccessToken.mockReturnValue(buildPayload());
      const dbUser = buildUser();
      mockPrismaUserFindUnique.mockResolvedValue(dbUser as never);

      await optionalAuthenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockReq.user).toEqual({
        id: dbUser.id,
        email: dbUser.email,
        emailVerified: dbUser.emailVerified,
        profile: dbUser.profile,
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('calls next() without setting user when token verification throws', async () => {
      mockReq.headers = { authorization: 'Bearer bad.token' };
      mockExtractTokenFromHeader.mockReturnValue('bad.token');
      mockVerifyAccessToken.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await optionalAuthenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it('calls next() without user when database lookup throws', async () => {
      mockReq.headers = { authorization: 'Bearer valid.token' };
      mockExtractTokenFromHeader.mockReturnValue('valid.token');
      mockVerifyAccessToken.mockReturnValue(buildPayload());
      mockPrismaUserFindUnique.mockRejectedValue(new Error('DB error'));

      await optionalAuthenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });
  });
});
