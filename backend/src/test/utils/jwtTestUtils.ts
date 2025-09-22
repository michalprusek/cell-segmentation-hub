import {
  generateTokenPair,
  verifyAccessToken,
  JwtPayload,
} from '../../auth/jwt';
import { prisma as _prisma } from '../../db';

/**
 * JWT Test Utilities for ML Authentication Tests
 * Provides helper functions for testing JWT authentication scenarios
 */

export interface TestUser {
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
}

export interface TestTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Default test user for authentication tests
 */
export const defaultTestUser: TestUser = {
  id: 'test-user-id-12345',
  email: 'test@spheroseg.com',
  emailVerified: true,
  profile: {
    id: 'profile-id-12345',
    userId: 'test-user-id-12345',
    username: 'testuser',
    avatarUrl: null,
    avatarPath: null,
    avatarMimeType: null,
    avatarSize: null,
    bio: 'Test user for ML authentication',
    organization: 'SpheroSeg Testing',
    location: 'Test Environment',
    title: 'Test Engineer',
    publicProfile: false,
    preferredModel: 'hrnetv2',
    modelThreshold: 0.5,
    preferredLang: 'en',
    preferredTheme: 'light',
    emailNotifications: true,
    consentToMLTraining: true,
    consentToAlgorithmImprovement: true,
    consentToFeatureDevelopment: true,
    consentUpdatedAt: new Date('2025-01-01T00:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
};

/**
 * Creates a test user with optional overrides
 */
export function createTestUser(overrides?: Partial<TestUser>): TestUser {
  return {
    ...defaultTestUser,
    ...overrides,
    profile: overrides?.profile
      ? { ...defaultTestUser.profile, ...overrides.profile }
      : defaultTestUser.profile,
  };
}

/**
 * Creates valid JWT tokens for testing
 * @param user - User data to encode in the token
 * @param rememberMe - Whether to create long-lived tokens
 * @returns Promise containing access and refresh tokens
 */
export async function createTestTokens(
  user: TestUser = defaultTestUser,
  rememberMe = false
): Promise<TestTokens> {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
  };

  return generateTokenPair(payload, rememberMe);
}

/**
 * Creates an expired access token for testing expired token scenarios
 */
export function createExpiredToken(): string {
  // This would need to be implemented by modifying the JWT creation process
  // For testing purposes, we'll return a token that would be expired
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXItaWQiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJlbWFpbFZlcmlmaWVkIjp0cnVlLCJpYXQiOjE2MDk0NTkyMDAsImV4cCI6MTYwOTQ1OTIwMH0.expired-token-signature';
}

/**
 * Creates a malformed JWT token for testing invalid token scenarios
 */
export function createMalformedToken(): string {
  return 'invalid.jwt.token.format';
}

/**
 * Creates a JWT token with tampered signature
 */
export function createTamperedToken(): string {
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXItaWQiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJlbWFpbFZlcmlmaWVkIjp0cnVlLCJpYXQiOjE2MDk0NTkyMDAsImV4cCI6MTYwOTQ1OTIwMH0.tampered-signature';
}

/**
 * Creates test user session in database
 */
export async function createTestSession(
  tokens: TestTokens,
  user: TestUser = defaultTestUser,
  rememberMe = false
): Promise<Record<string, unknown>> {
  const sessionData = {
    userId: user.id,
    refreshToken: tokens.refreshToken,
    isValid: true,
    expiresAt: new Date(
      Date.now() + (rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)
    ), // 30 days or 1 day
    rememberMe,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return sessionData;
}

/**
 * Authentication test scenarios for different use cases
 */
export const authTestScenarios = {
  /**
   * Valid authentication scenario
   */
  validAuth: {
    name: 'Valid Authentication',
    user: defaultTestUser,
    shouldSucceed: true,
    expectedStatus: 200,
    description: 'User with valid token and verified email',
  },

  /**
   * No token provided scenario
   */
  noToken: {
    name: 'No Token',
    user: null,
    token: null,
    shouldSucceed: false,
    expectedStatus: 401,
    expectedMessage: 'Chybí autentizační token',
    description: 'Request without Authorization header',
  },

  /**
   * Invalid token format scenario
   */
  invalidTokenFormat: {
    name: 'Invalid Token Format',
    user: null,
    token: 'invalid-format',
    shouldSucceed: false,
    expectedStatus: 401,
    expectedMessage: 'Neplatný token',
    description: 'Malformed JWT token',
  },

  /**
   * Expired token scenario
   */
  expiredToken: {
    name: 'Expired Token',
    user: defaultTestUser,
    token: createExpiredToken(),
    shouldSucceed: false,
    expectedStatus: 401,
    expectedMessage: 'Token vypršel',
    description: 'Valid JWT token that has expired',
  },

  /**
   * Tampered token scenario
   */
  tamperedToken: {
    name: 'Tampered Token',
    user: defaultTestUser,
    token: createTamperedToken(),
    shouldSucceed: false,
    expectedStatus: 401,
    expectedMessage: 'Neplatný token',
    description: 'JWT token with invalid signature',
  },

  /**
   * User not found scenario
   */
  userNotFound: {
    name: 'User Not Found',
    user: createTestUser({ id: 'non-existent-user-id' }),
    shouldSucceed: false,
    expectedStatus: 401,
    expectedMessage: 'Uživatel nenalezen',
    description: 'Valid token but user no longer exists in database',
  },

  /**
   * Unverified email scenario
   */
  unverifiedEmail: {
    name: 'Unverified Email',
    user: createTestUser({ emailVerified: false }),
    shouldSucceed: true, // Auth succeeds but might be restricted by other middleware
    expectedStatus: 200,
    description: 'User with valid token but unverified email',
  },

  /**
   * User without profile scenario
   */
  noProfile: {
    name: 'No Profile',
    user: createTestUser({ profile: null }),
    shouldSucceed: true,
    expectedStatus: 200,
    description: 'User with valid token but no profile data',
  },
};

/**
 * Creates authorization header for testing
 */
export function createAuthHeader(token: string): string {
  return `Bearer ${token}`;
}

/**
 * Mock authentication middleware factory for testing
 */
export function createMockAuthMiddleware(
  scenario: (typeof authTestScenarios)[keyof typeof authTestScenarios]
) {
  return (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
    next: () => void
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = res as any;
    if (!scenario.shouldSucceed) {
      return response.status(scenario.expectedStatus).json({
        success: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message: (scenario as any).expectedMessage,
        source: 'Auth',
      });
    }

    if (scenario.user) {
      req.user = scenario.user;
    }

    next();
  };
}

/**
 * Validates JWT token payload for testing
 */
export function validateTestTokenPayload(token: string): JwtPayload | null {
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

/**
 * Creates mock Prisma user responses for different scenarios
 */
export function createMockUserResponses() {
  return {
    validUser: defaultTestUser,
    userNotFound: null,
    unverifiedUser: createTestUser({ emailVerified: false }),
    userWithoutProfile: createTestUser({ profile: null }),

    // Mock database errors
    databaseError: () => {
      throw new Error('Database connection failed');
    },

    // Mock timeout
    timeoutError: () => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database timeout')), 100);
      });
    },
  };
}

/**
 * Security test vectors for JWT validation
 */
export const securityTestVectors = {
  // Common JWT attack vectors
  nullBytes: 'Bearer valid.token.with\x00nullbyte',
  sqlInjection: "Bearer '; DROP TABLE users; --",
  xssAttempt: 'Bearer <script>alert("xss")</script>',
  pathTraversal: 'Bearer ../../../etc/passwd',
  longToken: 'Bearer ' + 'a'.repeat(10000),

  // Malformed Authorization headers
  malformedHeaders: [
    'Bearer',
    'Bearer ',
    'InvalidScheme token',
    'Bearer token with spaces',
    'Bearer token\nwith\nnewlines',
    'Basic dXNlcjpwYXNzd29yZA==', // Basic auth instead of Bearer
    'Bearer token\ttab\tcharacters',
  ],

  // Edge cases
  emptyToken: 'Bearer ',
  onlySpaces: 'Bearer    ',
  unicodeToken: 'Bearer 🚀💾🔐',

  // JWT structure attacks
  missingSignature:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0In0',
  noneAlgorithm: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJ0ZXN0In0.',
  wrongAlgorithm:
    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0In0.invalid',
};

/**
 * Performance test utilities
 */
export const performanceTestUtils = {
  /**
   * Creates multiple concurrent authentication requests
   */
  createConcurrentRequests: (count: number, token: string) => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      token: token,
      headers: { Authorization: createAuthHeader(token) },
    }));
  },

  /**
   * Measures authentication time
   */
  measureAuthTime: async (authFunction: () => Promise<unknown>) => {
    const start = Date.now();
    await authFunction();
    return Date.now() - start;
  },

  /**
   * Creates test load scenarios
   */
  loadTestScenarios: {
    light: { concurrentUsers: 10, requestsPerUser: 5 },
    moderate: { concurrentUsers: 50, requestsPerUser: 10 },
    heavy: { concurrentUsers: 100, requestsPerUser: 20 },
    stress: { concurrentUsers: 500, requestsPerUser: 50 },
  },
};

/**
 * Cleanup utilities for tests
 */
export const testCleanup = {
  /**
   * Cleans up test sessions
   */
  cleanupTestSessions: async (_userId: string) => {
    // This would interact with your actual database cleanup
    // For now, it's a placeholder
    // Cleanup placeholder - no console logs in production code
  },

  /**
   * Cleans up test users
   */
  cleanupTestUsers: async (_userIds: string[]) => {
    // Cleanup placeholder - userIds: ${userIds.length} users
  },

  /**
   * General test cleanup
   */
  cleanupAll: async () => {
    // Performing general test cleanup
  },
};
