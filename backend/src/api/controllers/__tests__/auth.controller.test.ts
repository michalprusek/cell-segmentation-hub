import request from 'supertest'
import express from 'express'
import { AuthController } from '../auth.controller'
import { AuthService } from '../../services/auth.service'
import { prismaMock } from '../../../test/setup'

// Mock AuthService
jest.mock('../../services/auth.service')
const MockAuthService = AuthService as jest.MockedClass<typeof AuthService>

describe('AuthController', () => {
  let app: express.Application
  let authService: jest.Mocked<AuthService>
  let authController: AuthController

  beforeEach(() => {
    app = express()
    app.use(express.json())
    
    authService = new MockAuthService() as jest.Mocked<AuthService>
    authController = new AuthController(authService)
    
    // Setup routes
    app.post('/auth/register', authController.register.bind(authController))
    app.post('/auth/login', authController.login.bind(authController))
    app.post('/auth/refresh', authController.refreshToken.bind(authController))
    app.post('/auth/logout', authController.logout.bind(authController))
  })

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      }

      const registeredUser = {
        id: 'user-id',
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const authResult = {
        user: registeredUser,
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

      const user = {
        id: 'user-id',
        email: loginData.email,
        firstName: 'Test',
        lastName: 'User',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const authResult = {
        user,
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
        user: {
          id: 'user-id',
          email: 'test@example.com', // Sanitized
          firstName: 'Test', // Sanitized
          lastName: 'User',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      })

      await request(app)
        .post('/auth/register')
        .send(maliciousData)
        .expect(201)

      // Verify that the service was called with sanitized data
      expect(authService.register).toHaveBeenCalledWith(
        expect.objectContaining({
          email: expect.not.stringContaining('<script>'),
          firstName: expect.not.stringContaining('<b>')
        })
      )
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