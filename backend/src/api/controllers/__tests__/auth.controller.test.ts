import request from 'supertest'
import express from 'express'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { register, login, refreshToken, logout } from '../authController'
import * as AuthService from '../../../services/authService'
import { prismaMock } from '../../../test/setup'

// Mock AuthService
jest.mock('../../../services/authService')
const MockedAuthService = AuthService as jest.Mocked<typeof AuthService>

// Create a mocked AuthService instance for easier testing
const authService = {
  register: jest.fn() as jest.MockedFunction<typeof AuthService.register>,
  login: jest.fn() as jest.MockedFunction<typeof AuthService.login>,
  refreshToken: jest.fn() as jest.MockedFunction<typeof AuthService.refreshToken>,
  logout: jest.fn() as jest.MockedFunction<typeof AuthService.logout>
}

describe('Auth Controller Functions', () => {
  let app: express.Application

  beforeEach(() => {
    app = express()
    app.use(express.json())
    
    // Setup routes
    app.post('/auth/register', register)
    app.post('/auth/login', login)
    app.post('/auth/refresh', refreshToken)
    app.post('/auth/logout', logout)
    
    // Reset mocks
    jest.clearAllMocks()
    
    // Mock static methods on AuthService
    MockedAuthService.register = authService.register
    MockedAuthService.login = authService.login
    MockedAuthService.refreshToken = authService.refreshToken
    MockedAuthService.logout = authService.logout
  })

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      }

      const authResult = {
        message: 'User registered successfully',
        user: {
          id: 'user-id',
          email: userData.email,
          username: userData.firstName, // Map to username since that's what the service returns
          emailVerified: false
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      }

      authService.register.mockResolvedValueOnce(authResult)

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201)

      expect(response.body).toEqual({
        success: true,
        data: authResult,
        message: 'User registered successfully'
      })

      expect(authService.register).toHaveBeenCalledWith(userData)
    })

    it('should return 400 for invalid email', async () => {
      const invalidUserData = {
        email: 'invalid-email',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      }

      const response = await request(app)
        .post('/auth/register')
        .send(invalidUserData)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.errors).toContain('Valid email is required')
    })

    it('should return 400 for short password', async () => {
      const userData = {
        email: 'test@example.com',
        password: '123',
        firstName: 'Test',
        lastName: 'User'
      }

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.errors).toContain('Password must be at least 6 characters')
    })

    it('should return 409 if user already exists', async () => {
      const userData = {
        email: 'existing@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      }

      authService.register.mockRejectedValueOnce(new Error('User already exists'))

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(409)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('User already exists')
    })
  })

  describe('POST /auth/login', () => {
    it('should login user successfully', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123'
      }

      const authResult = {
        user: {
          id: 'user-id',
          email: loginData.email,
          emailVerified: true,
          profile: {
            username: 'testuser',
            consentToMLTraining: true,
            consentToAlgorithmImprovement: true,
            consentToFeatureDevelopment: true,
            id: 'profile-id',
            userId: 'user-id',
            bio: null,
            organization: null,
            location: null,
            title: null,
            publicProfile: false,
            avatarUrl: null,
            preferredModel: 'hrnet',
            modelThreshold: 0.5,
            preferredLang: 'cs',
            preferredTheme: 'light',
            emailNotifications: true,
            consentUpdatedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      }

      authService.login.mockResolvedValueOnce(authResult)

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        data: authResult,
        message: 'Login successful'
      })

      expect(authService.login).toHaveBeenCalledWith(loginData.email, loginData.password)
    })

    it('should return 400 for missing email', async () => {
      const loginData = {
        password: 'password123'
      }

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.errors).toContain('Email is required')
    })

    it('should return 401 for invalid credentials', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrong-password'
      }

      authService.login.mockRejectedValueOnce(new Error('Invalid credentials'))

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Invalid credentials')
    })
  })

  describe('POST /auth/refresh', () => {
    it('should refresh token successfully', async () => {
      const refreshData = {
        refreshToken: 'valid-refresh-token'
      }

      const newTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token'
      }

      authService.refreshToken.mockResolvedValueOnce(newTokens)

      const response = await request(app)
        .post('/auth/refresh')
        .send(refreshData)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        data: newTokens,
        message: 'Token refreshed successfully'
      })

      expect(authService.refreshToken).toHaveBeenCalledWith(refreshData.refreshToken)
    })

    it('should return 400 for missing refresh token', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .send({})
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.errors).toContain('Refresh token is required')
    })

    it('should return 401 for invalid refresh token', async () => {
      const refreshData = {
        refreshToken: 'invalid-refresh-token'
      }

      authService.refreshToken.mockRejectedValueOnce(new Error('Invalid refresh token'))

      const response = await request(app)
        .post('/auth/refresh')
        .send(refreshData)
        .expect(401)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Invalid refresh token')
    })
  })

  describe('POST /auth/logout', () => {
    it('should logout successfully', async () => {
      const logoutData = {
        refreshToken: 'valid-refresh-token'
      }

      authService.logout.mockResolvedValueOnce(undefined)

      const response = await request(app)
        .post('/auth/logout')
        .send(logoutData)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        message: 'Logout successful'
      })

      expect(authService.logout).toHaveBeenCalledWith(logoutData.refreshToken)
    })

    it('should handle logout error gracefully', async () => {
      const logoutData = {
        refreshToken: 'invalid-refresh-token'
      }

      authService.logout.mockRejectedValueOnce(new Error('Token not found'))

      const response = await request(app)
        .post('/auth/logout')
        .send(logoutData)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Token not found')
    })
  })

  describe('Input validation', () => {
    it('should sanitize and validate input data', async () => {
      const maliciousData = {
        email: '<script>alert("xss")</script>@example.com',
        password: 'password123',
        firstName: '<b>Test</b>',
        lastName: 'User'
      }

      authService.register.mockResolvedValueOnce({
        message: 'User registered successfully',
        user: {
          id: 'user-id',
          email: 'test@example.com', // Sanitized
          username: 'Test', // Sanitized
          emailVerified: false
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      })

      await request(app)
        .post('/auth/register')
        .send(maliciousData)
        .expect(201)

      // Verify that the service was called with sanitized data
      const mockCalls = (authService.register as jest.Mock).mock.calls
      expect(mockCalls.length).toBeGreaterThan(0)
      const actualEmail = (mockCalls[0][0] as any).email
      
      // Verify script tags and their content are removed
      expect(actualEmail).not.toContain('<')
      expect(actualEmail).not.toContain('>')
      expect(actualEmail).not.toContain('script')
      
      // Verify the domain is preserved
      expect(actualEmail).toContain('@example.com')
      
      // Verify it matches a safe email pattern
      expect(actualEmail).toMatch(/^[a-zA-Z0-9._-]+@example\.com$/)
    })

    it('should handle SQL injection attempts', async () => {
      const sqlInjectionData = {
        email: "'; DROP TABLE users; --@example.com",
        password: 'password123'
      }

      // The validation should catch this and return 400
      const response = await request(app)
        .post('/auth/login')
        .send(sqlInjectionData)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(authService.login).not.toHaveBeenCalled()
    })
  })
})