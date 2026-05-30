import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

// Mock config early to prevent process.exit(1) during module load chain
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
    UPLOAD_DIR: './test-uploads',
    MAX_FILE_SIZE: 10485760,
    STORAGE_TYPE: 'local',
    SESSION_SECRET: 'test-session-secret',
    REDIS_URL: 'redis://localhost:6379',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test Platform',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

// Mock AuthService
vi.mock('../../../services/authService');
vi.mock('../../../utils/logger');

import { register, login, refreshToken, logout } from '../authController';
import * as AuthService from '../../../services/authService';
import { errorHandler, ApiError } from '../../../middleware/error';

const MockedAuthService = AuthService as Mocked<typeof AuthService>;

// Create a mocked AuthService instance for easier testing
const authService = {
  register: vi.fn() as MockedFunction<typeof AuthService.register>,
  login: vi.fn() as MockedFunction<typeof AuthService.login>,
  refreshToken: vi.fn() as MockedFunction<typeof AuthService.refreshToken>,
  logout: vi.fn() as MockedFunction<typeof AuthService.logout>,
};

describe('Auth Controller Functions', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Tokens travel in httpOnly cookies now, so the test app needs the same
    // cookie parser the real server uses (server.ts) to populate req.cookies.
    app.use(cookieParser());

    // Setup routes
    app.post('/auth/register', register);
    app.post('/auth/login', login);
    app.post('/auth/refresh', refreshToken);
    app.post('/auth/logout', logout);

    // Add error handler middleware (must be after routes)
    app.use(errorHandler);

    // Reset mocks
    vi.clearAllMocks();

    // Mock static methods on AuthService
    MockedAuthService.register = authService.register;
    MockedAuthService.login = authService.login;
    MockedAuthService.refreshToken = authService.refreshToken;
    MockedAuthService.logout = authService.logout;
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
      };

      const authResult = {
        message: 'Uživatel byl úspěšně zaregistrován a přihlášen.',
        user: {
          id: 'user-id',
          email: userData.email,
          emailVerified: false,
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      authService.register.mockResolvedValueOnce(authResult);

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      // Body carries only the user — never tokens.
      expect(response.body.data).toMatchObject({
        user: { id: 'user-id', email: userData.email },
      });
      expect(response.body.data.accessToken).toBeUndefined();
      expect(response.body.data.refreshToken).toBeUndefined();
      // Tokens are delivered as httpOnly cookies; the non-secret hint cookie
      // is intentionally NOT httpOnly (the SPA must read it).
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const accessCookie = cookies.find(c => c.startsWith('access_token='));
      const refreshCookie = cookies.find(c => c.startsWith('refresh_token='));
      const hintCookie = cookies.find(c => c.startsWith('authenticated='));
      expect(accessCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(hintCookie).toBeDefined();
      expect(hintCookie).not.toMatch(/HttpOnly/i);
    });

    it('should return 400 for invalid email', async () => {
      const invalidUserData = {
        email: 'invalid-email',
        password: 'password123',
      };

      const response = await request(app)
        .post('/auth/register')
        .send(invalidUserData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 for short password', async () => {
      const userData = {
        email: 'test@example.com',
        password: '123', // too short (min 6)
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 409 if user already exists', async () => {
      const userData = {
        email: 'existing@example.com',
        password: 'password123',
      };

      const conflictError = ApiError.conflict(
        'Uživatel s tímto emailem již existuje'
      );
      authService.register.mockRejectedValueOnce(conflictError);

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(409);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/login', () => {
    it('should login user successfully', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
      };

      const authResult = {
        user: {
          id: 'user-id',
          email: loginData.email,
          emailVerified: true,
          profile: null,
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      authService.login.mockResolvedValueOnce(authResult);

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      // Body carries only the user — never tokens.
      expect(response.body.data).toMatchObject({
        user: { id: 'user-id', email: loginData.email },
      });
      expect(response.body.data.accessToken).toBeUndefined();
      expect(response.body.data.refreshToken).toBeUndefined();
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const accessCookie = cookies.find(c => c.startsWith('access_token='));
      const refreshCookie = cookies.find(c => c.startsWith('refresh_token='));
      expect(accessCookie).toMatch(/HttpOnly/i);
      expect(accessCookie).toMatch(/SameSite=Strict/i);
      expect(accessCookie).toMatch(/Path=\//i);
      // The refresh cookie is path-scoped to the auth endpoints.
      expect(refreshCookie).toMatch(/Path=\/api\/auth/i);
    });

    it('should return 400 for missing email', async () => {
      const loginData = {
        password: 'password123',
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 401 for invalid credentials', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrong-password',
      };

      const { ApiError } = await import('../../../middleware/error');
      const unauthorizedError = (ApiError as any).unauthorized(
        'Neplatné přihlašovací údaje'
      );
      authService.login.mockRejectedValueOnce(unauthorizedError);

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh token successfully (reading the refresh cookie)', async () => {
      const newTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      authService.refreshToken.mockResolvedValueOnce(newTokens);

      const response = await request(app)
        .post('/auth/refresh')
        .set('Cookie', 'refresh_token=valid-refresh-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      // The new tokens go back as cookies, not in the body.
      expect(response.body.data?.accessToken).toBeUndefined();
      expect(response.body.data?.refreshToken).toBeUndefined();
      // The service is called with the token read from the cookie.
      expect(authService.refreshToken).toHaveBeenCalledWith({
        refreshToken: 'valid-refresh-token',
      });
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.some(c => c.startsWith('access_token='))).toBe(true);
      expect(cookies.some(c => c.startsWith('refresh_token='))).toBe(true);
    });

    it('should return 401 when the refresh cookie is missing (no service call)', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({})
        .expect(401);

      expect(response.body.success).toBe(false);
      // Short-circuits before touching the service — no cookie, no refresh.
      expect(authService.refreshToken).not.toHaveBeenCalled();
    });

    it('should return 401 for an invalid refresh cookie', async () => {
      const { ApiError } = await import('../../../middleware/error');
      const unauthorizedError = (ApiError as any).unauthorized(
        'Neplatný nebo vypršený refresh token'
      );
      authService.refreshToken.mockRejectedValueOnce(unauthorizedError);

      const response = await request(app)
        .post('/auth/refresh')
        .set('Cookie', 'refresh_token=invalid-refresh-token')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout successfully (revoking the cookie token and clearing cookies)', async () => {
      authService.logout.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post('/auth/logout')
        .set('Cookie', 'refresh_token=valid-refresh-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(authService.logout).toHaveBeenCalledWith('valid-refresh-token');
      // Both cookies are cleared (Max-Age=0 / Expires in the past).
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.some(c => c.startsWith('access_token=;'))).toBe(true);
      expect(cookies.some(c => c.startsWith('refresh_token=;'))).toBe(true);
    });

    it('clears cookies and returns 200 even if session revocation fails', async () => {
      // Logout must always end the client session — a revocation error is
      // logged but the cookies are still cleared and the response is 200.
      const { ApiError } = await import('../../../middleware/error');
      authService.logout.mockRejectedValueOnce(
        (ApiError as any).internalError('Odhlášení se nezdařilo')
      );

      const response = await request(app)
        .post('/auth/logout')
        .set('Cookie', 'refresh_token=invalid-refresh-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.some(c => c.startsWith('refresh_token=;'))).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject invalid email format', async () => {
      const maliciousData = {
        email: 'not-an-email',
        password: 'password123',
      };

      const response = await request(app)
        .post('/auth/register')
        .send(maliciousData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(authService.register).not.toHaveBeenCalled();
    });

    it('should handle SQL injection attempts as invalid email', async () => {
      const sqlInjectionData = {
        email: "'; DROP TABLE users; --@example.com",
        password: 'password123',
      };

      // The validation should catch this as an invalid email and return 400
      const response = await request(app)
        .post('/auth/login')
        .send(sqlInjectionData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(authService.login).not.toHaveBeenCalled();
    });
  });
});
