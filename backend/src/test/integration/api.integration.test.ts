import request from 'supertest'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

// Import app with error handling
let app: any
let prisma: PrismaClient

beforeAll(async () => {
  try {
    // Set test environment first
    process.env.NODE_ENV = 'test'
    
    // Import app after setting environment
    const serverModule = await import('../../server')
    app = serverModule.default
    
    // Initialize Prisma client
    prisma = new PrismaClient()
    
    // Connect to database
    await prisma.$connect()
    
    console.log('✓ Test environment initialized successfully')
  } catch (error) {
    console.error('✗ Failed to initialize test environment:', error)
    throw error
  }
})

afterAll(async () => {
  try {
    if (prisma) {
      await prisma.$disconnect()
    }
    console.log('✓ Test environment cleanup completed')
  } catch (error) {
    console.error('✗ Failed to cleanup test environment:', error)
  }
})

describe('API Integration Tests', () => {
  let authToken: string
  let refreshToken: string
  let testUser: any
  let testProject: any

  beforeEach(async () => {
    if (!prisma) {
      throw new Error('Prisma client not initialized')
    }
    
    // Clean database before each test
    try {
      await prisma.$transaction([
        prisma.segmentation.deleteMany(),
        prisma.image.deleteMany(),
        prisma.project.deleteMany(),
        prisma.user.deleteMany(),
      ])
    } catch (error) {
      console.warn('Database cleanup warning:', error)
      // Continue with tests even if cleanup partially fails
    }
  })

  describe('Authentication Flow', () => {
    it('should register a new user', async () => {
      if (!app) {
        throw new Error('App not initialized')
      }
      
      const userData = {
        email: 'integration@test.com',
        password: 'password123',
        // Note: firstName/lastName moved to Profile model
      }

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.data.user.email).toBe(userData.email)
      expect(response.body.data.accessToken).toBeDefined()
      expect(response.body.data.refreshToken).toBeDefined()

      authToken = response.body.data.accessToken
      refreshToken = response.body.data.refreshToken
      testUser = response.body.data.user
    })

    it('should not register user with existing email', async () => {
      if (!app) {
        throw new Error('App not initialized')
      }
      
      const userData = {
        email: 'integration@test.com', // Same email
        password: 'password123',
        // Note: firstName/lastName moved to Profile model
      }

      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(409)
    })

    it('should login with correct credentials', async () => {
      if (!app) {
        throw new Error('App not initialized')
      }
      
      const loginData = {
        email: 'integration@test.com',
        password: 'password123'
      }

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.user.email).toBe(loginData.email)
      expect(response.body.data.accessToken).toBeDefined()
    })

    it('should not login with incorrect credentials', async () => {
      if (!app) {
        throw new Error('App not initialized')
      }
      
      const loginData = {
        email: 'integration@test.com',
        password: 'wrongpassword'
      }

      await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401)
    })

    it('should refresh access token', async () => {
      if (!app || !refreshToken) {
        throw new Error('App or refresh token not available')
      }
      
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.accessToken).toBeDefined()
      expect(response.body.data.refreshToken).toBeDefined()
    })
  })

  describe('Project Management Flow', () => {
    it('should create a new project', async () => {
      if (!app || !authToken) {
        throw new Error('App or auth token not available')
      }
      
      const projectData = {
        title: 'Integration Test Project',
        description: 'A test project for integration testing'
      }

      const response = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .send(projectData)
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.data.title).toBe(projectData.title)
      expect(response.body.data.userId).toBe(testUser.id)

      testProject = response.body.data
    })

    it('should get user projects', async () => {
      if (!app || !authToken) {
        throw new Error('App or auth token not available')
      }
      
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].id).toBe(testProject.id)
    })

    it('should get specific project', async () => {
      if (!app || !authToken || !testProject) {
        throw new Error('App, auth token, or test project not available')
      }
      
      const response = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testProject.id)
    })

    it('should update project', async () => {
      if (!app || !authToken || !testProject) {
        throw new Error('App, auth token, or test project not available')
      }
      
      const updateData = {
        title: 'Updated Integration Test Project',
        description: 'Updated description'
      }

      const response = await request(app)
        .put(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.title).toBe(updateData.title)
      expect(response.body.data.description).toBe(updateData.description)
    })

    it('should not access other user project', async () => {
      if (!app || !authToken || !prisma) {
        throw new Error('App, auth token, or Prisma not available')
      }
      
      // Create another user and project
      const anotherUser = await prisma.user.create({
        data: {
          email: 'another@test.com',
          password: await bcrypt.hash('password', 10),
          // Note: firstName/lastName moved to Profile model
        }
      })

      const anotherProject = await prisma.project.create({
        data: {
          title: 'Another User Project',
          description: 'Should not be accessible',
          userId: anotherUser.id
        }
      })

      await request(app)
        .get(`/api/projects/${anotherProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
    })
  })

  describe('File Upload Flow', () => {
    it('should upload image to project', async () => {
      if (!app || !authToken || !testProject) {
        throw new Error('App, auth token, or test project not available')
      }
      
      // Create a simple test image buffer
      const testImageBuffer = Buffer.from('fake-image-data')

      const response = await request(app)
        .post(`/api/projects/${testProject.id}/images`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('image', testImageBuffer, 'test-image.jpg')
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.data.name).toBeDefined()
      expect(response.body.data.projectId).toBe(testProject.id)
    })

    it('should not upload without authentication', async () => {
      if (!app || !testProject) {
        throw new Error('App or test project not available')
      }
      
      const testImageBuffer = Buffer.from('fake-image-data')

      await request(app)
        .post(`/api/projects/${testProject.id}/images`)
        .attach('image', testImageBuffer, 'test-image.jpg')
        .expect(401)
    })

    it('should not upload non-image file', async () => {
      if (!app || !authToken || !testProject) {
        throw new Error('App, auth token, or test project not available')
      }
      
      const testTextBuffer = Buffer.from('This is not an image')

      await request(app)
        .post(`/api/projects/${testProject.id}/images`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', testTextBuffer, 'test.txt')
        .expect(400)
    })
  })

  describe('Health and Status Endpoints', () => {
    it('should return healthy status', async () => {
      if (!app) {
        throw new Error('App not available')
      }
      
      const response = await request(app)
        .get('/health')
        .expect(200)

      expect(response.body.status).toBe('healthy')
      expect(response.body.timestamp).toBeDefined()
      expect(response.body.version).toBeDefined()
    })

    it('should return API endpoints list', async () => {
      if (!app) {
        throw new Error('App not available')
      }
      
      const response = await request(app)
        .get('/api/endpoints')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.endpoints).toBeInstanceOf(Array)
      expect(response.body.data.count).toBeGreaterThan(0)
    })

    it('should return health status of endpoints', async () => {
      if (!app) {
        throw new Error('App not available')
      }
      
      const response = await request(app)
        .get('/api/health/endpoints')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.endpoints).toBeInstanceOf(Array)
    })
  })

  describe('Error Handling', () => {
    it('should handle 404 for non-existent endpoints', async () => {
      if (!app) {
        throw new Error('App not available')
      }
      
      await request(app)
        .get('/api/non-existent')
        .expect(404)
    })

    it('should handle malformed JSON', async () => {
      if (!app) {
        throw new Error('App not available')
      }
      
      await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "test@test.com", "password":}') // Malformed JSON
        .expect(400)
    })

    it('should handle request size limit', async () => {
      if (!app || !authToken) {
        throw new Error('App or auth token not available')
      }
      
      const largePayload = {
        data: 'x'.repeat(10 * 1024 * 1024) // 10MB
      }

      await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .send(largePayload)
        .expect(413) // Payload Too Large
    })
  })

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      if (!app) {
        throw new Error('App not available')
      }
      
      // Make many requests quickly to trigger rate limit
      const requests = Array.from({ length: 20 }, () =>
        request(app).get('/api/endpoints')
      )

      const responses = await Promise.all(requests)
      const statusCodes = responses.map(r => r.status)

      // Should have at least one 429 (Too Many Requests)
      expect(statusCodes).toContain(429)
    })
  })

  describe('CORS Headers', () => {
    it('should include proper CORS headers', async () => {
      if (!app) {
        throw new Error('App not available')
      }
      
      const response = await request(app)
        .options('/api/endpoints')
        .expect(200)

      expect(response.headers['access-control-allow-origin']).toBeDefined()
      expect(response.headers['access-control-allow-methods']).toBeDefined()
      expect(response.headers['access-control-allow-headers']).toBeDefined()
    })
  })

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      if (!app) {
        throw new Error('App not available')
      }
      
      const response = await request(app)
        .get('/health')
        .expect(200)

      expect(response.headers['x-frame-options']).toBeDefined()
      expect(response.headers['x-content-type-options']).toBeDefined()
      expect(response.headers['x-xss-protection']).toBeDefined()
    })
  })

  describe('Database Transactions', () => {
    it('should rollback transaction on error', async () => {
      if (!app || !authToken || !prisma) {
        throw new Error('App, auth token, or Prisma not available')
      }
      
      // This test would need to simulate a scenario where a database
      // operation fails partway through a transaction
      const initialProjectCount = await prisma.project.count()

      try {
        // Attempt to create a project with invalid data that will fail
        await request(app)
          .post('/api/projects')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            title: null, // This should cause validation error
            description: 'Test description'
          })
          .expect(400)
      } catch (error) {
        // Expected to fail
      }

      // Project count should remain the same
      const finalProjectCount = await prisma.project.count()
      expect(finalProjectCount).toBe(initialProjectCount)
    })
  })

  describe('Cleanup', () => {
    it('should delete project', async () => {
      if (!app || !authToken || !testProject) {
        throw new Error('App, auth token, or test project not available')
      }
      
      await request(app)
        .delete(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      // Verify project is deleted
      await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404)
    })

    it('should logout user', async () => {
      if (!app || !refreshToken) {
        throw new Error('App or refresh token not available')
      }
      
      const response = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken })
        .expect(200)

      expect(response.body.success).toBe(true)
    })
  })
})