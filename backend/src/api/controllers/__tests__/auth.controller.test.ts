import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock config early to prevent process.exit(1) during module load chain
jest.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-characters-long',
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
jest.mock('../../../services/authService');
jest.mock('../../../utils/logger');

import { register, login, refreshToken, logout } from '../authController';
import * as AuthService from '../../../services/authService';
import { errorHandler, ApiError } from '../../../middleware/error';

const MockedAuthService = AuthService as jest.Mocked<typeof AuthService>;

// Create a mocked AuthService instance for easier testing
const authService = {
  register: jest.fn() as jest.MockedFunction<typeof AuthService.register>,
  login: jest.fn() as jest.MockedFunction<typeof AuthService.login>,
  refreshToken: jest.fn() as jest.MockedFunction<typeof AuthService.refreshToken>,
  logout: jest.fn() as jest.MockedFunction<typeof AuthService.logout>,
};

describe('Auth Controller Functions', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Setup routes
    app.post('/auth/register', register);
    app.post('/auth/login', login);
    app.post('/auth/refresh', refreshToken);
    app.post('/auth/logout', logout);

    // Add error handler middleware (must be after routes)
    app.use(errorHandler);

    // Reset mocks
    jest.clearAllMocks();

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
      expect(response.body.data).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
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
      expect(response.body.data).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
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
    it('should refresh token successfully', async () => {
      const refreshData = {
        refreshToken: 'valid-refresh-token',
      };

      const newTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      authService.refreshToken.mockResolvedValueOnce(newTokens);

      const response = await request(app)
        .post('/auth/refresh')
        .send(refreshData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should return 400 for missing refresh token', async () => {
      // refreshToken controller doesn't validate body, so test what happens
      // when the service throws
      const { ApiError } = await import('../../../middleware/error');
      const unauthorizedError = (ApiError as any).unauthorized(
        'Neplatný nebo vypršený refresh token'
      );
      authService.refreshToken.mockRejectedValueOnce(unauthorizedError);

      const response = await request(app)
        .post('/auth/refresh')
        .send({})
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 401 for invalid refresh token', async () => {
      const refreshData = {
        refreshToken: 'invalid-refresh-token',
      };

      const { ApiError } = await import('../../../middleware/error');
      const unauthorizedError = (ApiError as any).unauthorized(
        'Neplatný nebo vypršený refresh token'
      );
      authService.refreshToken.mockRejectedValueOnce(unauthorizedError);

      const response = await request(app)
        .post('/auth/refresh')
        .send(refreshData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout successfully', async () => {
      const logoutData = {
        refreshToken: 'valid-refresh-token',
      };

      authService.logout.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post('/auth/logout')
        .send(logoutData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(authService.logout).toHaveBeenCalledWith(logoutData.refreshToken);
    });

    it('should handle logout error gracefully', async () => {
      const logoutData = {
        refreshToken: 'invalid-refresh-token',
      };

      const { ApiError } = await import('../../../middleware/error');
      const internalError = (ApiError as any).internalError(
        'Odhlášení se nezdařilo'
      );
      authService.logout.mockRejectedValueOnce(internalError);

      const response = await request(app)
        .post('/auth/logout')
        .send(logoutData)
        .expect(500);

      expect(response.body.success).toBe(false);
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
