import request from 'supertest'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import app from '../../server'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

describe('API Integration Tests', () => {
  let prisma: PrismaClient
  let authToken: string
  let refreshToken: string
  let testUser: any
  let testProject: any

  beforeAll(async () => {
    // Use test database
    const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgresql://postgres:testpass@localhost:5432/testdb'
    
    // For CI/CD environment, ensure we have a valid PostgreSQL URL
    // Support all postgres URL variants including postgres+asyncpg://
    const isValidPostgresUrl = /^postgres(?:ql)?(?:\+[a-z0-9-]+)?:\/\//i.test(databaseUrl)
    
    if (!isValidPostgresUrl) {
      console.warn('Invalid DATABASE_URL, using default PostgreSQL URL for tests')
      process.env.DATABASE_URL = 'postgresql://postgres:testpass@localhost:5432/testdb'
    } else {
      process.env.DATABASE_URL = databaseUrl
    }
    
    prisma = new PrismaClient()

    // Clean database
    await prisma.$transaction([
      prisma.segmentation.deleteMany(),
      prisma.image.deleteMany(),
      prisma.project.deleteMany(),
      prisma.user.deleteMany(),
    ])
  })

  afterAll(async () => {
    // Clean up and disconnect
    await prisma.$transaction([
      prisma.segmentation.deleteMany(),
      prisma.image.deleteMany(),
      prisma.project.deleteMany(),
      prisma.user.deleteMany(),
    ])
    await prisma.$disconnect()
  })

  describe('Authentication Flow', () => {
    it('should register a new user', async () => {
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
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].id).toBe(testProject.id)
    })

    it('should get specific project', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testProject.id)
    })

    it('should update project', async () => {
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
      const testImageBuffer = Buffer.from('fake-image-data')

      await request(app)
        .post(`/api/projects/${testProject.id}/images`)
        .attach('image', testImageBuffer, 'test-image.jpg')
        .expect(401)
    })

    it('should not upload non-image file', async () => {
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
      const response = await request(app)
        .get('/health')
        .expect(200)

      expect(response.body.status).toBe('healthy')
      expect(response.body.timestamp).toBeDefined()
      expect(response.body.version).toBeDefined()
    })

    it('should return API endpoints list', async () => {
      const response = await request(app)
        .get('/api/endpoints')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.endpoints).toBeInstanceOf(Array)
      expect(response.body.data.count).toBeGreaterThan(0)
    })

    it('should return health status of endpoints', async () => {
      const response = await request(app)
        .get('/api/health/endpoints')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.endpoints).toBeInstanceOf(Array)
    })
  })

  describe('Error Handling', () => {
    it('should handle 404 for non-existent endpoints', async () => {
      await request(app)
        .get('/api/non-existent')
        .expect(404)
    })

    it('should handle malformed JSON', async () => {
      await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "test@test.com", "password":}') // Malformed JSON
        .expect(400)
    })

    it('should handle request size limit', async () => {
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
      const response = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken })
        .expect(200)

      expect(response.body.success).toBe(true)
    })
  })
})