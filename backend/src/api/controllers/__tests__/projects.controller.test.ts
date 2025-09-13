import request from 'supertest'
import express from 'express'
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { createProject, getProjects, getProject, updateProject, deleteProject } from '../projectController'
import * as projectService from '../../../services/projectService'
import { authenticate } from '../../../middleware/auth'

// Mock dependencies
jest.mock('../../../services/projectService')
jest.mock('../../../middleware/auth')

const MockProjectService = projectService as jest.Mocked<typeof projectService>
const mockAuthMiddleware = authenticate as jest.MockedFunction<typeof authenticate>

describe('ProjectController', () => {
  let app: express.Application

  const mockUser = {
    id: 'user-id',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User'
  }

  const mockProject = {
    id: 'project-id',
    name: 'Test Project',
    description: 'Test Description',
    userId: 'user-id',
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
    images: [],
    _count: {
      images: 0
    }
  }

  beforeEach(() => {
    app = express()
    app.use(express.json())
    
    // Mock auth middleware to add user to request
    mockAuthMiddleware.mockImplementation(async (req: express.Request & {user?: Record<string, unknown>}, res: express.Response, next: express.NextFunction) => {
      req.user = mockUser
      next()
    })

    // Setup routes with function controllers
    app.get('/projects', mockAuthMiddleware, getProjects)
    app.post('/projects', mockAuthMiddleware, createProject)
    app.get('/projects/:id', mockAuthMiddleware, getProject)
    app.put('/projects/:id', mockAuthMiddleware, updateProject)
    app.delete('/projects/:id', mockAuthMiddleware, deleteProject)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    jest.resetAllMocks()
  })

  describe('GET /projects', () => {
    it('should return user projects successfully', async () => {
      const mockResponse = {
        projects: [mockProject],
        totalCount: 1,
        pagination: {
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNext: false,
          hasPrev: false
        }
      }
      MockProjectService.getUserProjects.mockResolvedValueOnce(mockResponse)

      const response = await request(app)
        .get('/projects')
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        data: mockResponse,
        message: 'Projects retrieved successfully'
      })

      expect(MockProjectService.getUserProjects).toHaveBeenCalledWith(mockUser.id)
    })

    it('should handle service error', async () => {
MockProjectService.getUserProjects.mockRejectedValueOnce(new Error('Database error'))

      const response = await request(app)
        .get('/projects')
        .expect(500)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Database error')
    })

    it('should return empty array when user has no projects', async () => {
      const emptyResponse = {
        projects: [],
        totalCount: 0,
        pagination: {
          page: 1,
          limit: 10,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        }
      }
      MockProjectService.getUserProjects.mockResolvedValueOnce(emptyResponse)

      const response = await request(app)
        .get('/projects')
        .expect(200)

      expect(response.body.data.projects).toEqual([])
    })
  })

  describe('POST /projects', () => {
    it('should create project successfully', async () => {
      const projectData = {
        name: 'New Project',
        description: 'New Description'
      }

      const createdProject = {
        ...mockProject,
        ...projectData
      }

MockProjectService.createProject.mockResolvedValueOnce(createdProject)

      const response = await request(app)
        .post('/projects')
        .send(projectData)
        .expect(201)

      expect(response.body).toEqual({
        success: true,
        data: createdProject,
        message: 'Project created successfully'
      })

      expect(MockProjectService.createProject).toHaveBeenCalledWith(
        projectData,
        mockUser.id
      )
    })

    it('should return 400 for missing project name', async () => {
      const invalidProjectData = {
        description: 'Description without name'
      }

      const response = await request(app)
        .post('/projects')
        .send(invalidProjectData)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.errors).toContain('Project name is required')
    })

    it('should return 400 for project name too long', async () => {
      const projectData = {
        name: 'A'.repeat(256), // Too long
        description: 'Valid description'
      }

      const response = await request(app)
        .post('/projects')
        .send(projectData)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.errors).toContain('Project name must be less than 255 characters')
    })

    it('should handle duplicate project name', async () => {
      const projectData = {
        name: 'Existing Project',
        description: 'Description'
      }

MockProjectService.createProject.mockRejectedValueOnce(
        new Error('Project with this name already exists')
      )

      const response = await request(app)
        .post('/projects')
        .send(projectData)
        .expect(409)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Project with this name already exists')
    })
  })

  describe('GET /projects/:id', () => {
    it('should return project successfully', async () => {
MockProjectService.getProjectById.mockResolvedValueOnce(mockProject)

      const response = await request(app)
        .get(`/projects/${mockProject.id}`)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        data: mockProject,
        message: 'Project retrieved successfully'
      })

      expect(MockProjectService.getProjectById).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id
      )
    })

    it('should return 404 for non-existent project', async () => {
MockProjectService.getProjectById.mockResolvedValueOnce(null)

      const response = await request(app)
        .get('/projects/non-existent-id')
        .expect(404)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Project not found')
    })

    it('should return 403 for unauthorized access', async () => {
MockProjectService.getProjectById.mockRejectedValueOnce(
        new Error('Unauthorized access to project')
      )

      const response = await request(app)
        .get('/projects/unauthorized-project-id')
        .expect(403)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Unauthorized access to project')
    })
  })

  describe('PUT /projects/:id', () => {
    it('should update project successfully', async () => {
      const updateData = {
        name: 'Updated Project',
        description: 'Updated Description'
      }

      const updatedProject = {
        ...mockProject,
        ...updateData,
        updatedAt: new Date()
      }

MockProjectService.updateProject.mockResolvedValueOnce(updatedProject)

      const response = await request(app)
        .put(`/projects/${mockProject.id}`)
        .send(updateData)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        data: updatedProject,
        message: 'Project updated successfully'
      })

      expect(MockProjectService.updateProject).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id,
        updateData
      )
    })

    it('should return 404 for updating non-existent project', async () => {
      const updateData = {
        name: 'Updated Project'
      }

MockProjectService.updateProject.mockResolvedValueOnce(null)

      const response = await request(app)
        .put('/projects/non-existent-id')
        .send(updateData)
        .expect(404)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Project not found')
    })

    it('should validate update data', async () => {
      const invalidUpdateData = {
        name: '', // Empty name
        description: 'Valid description'
      }

      const response = await request(app)
        .put(`/projects/${mockProject.id}`)
        .send(invalidUpdateData)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.errors).toContain('Project name cannot be empty')
    })
  })

  describe('DELETE /projects/:id', () => {
    it('should delete project successfully', async () => {
      const deletedProject = { 
        ...mockProject, 
        imageCount: 5 
      }
      MockProjectService.deleteProject.mockResolvedValueOnce(deletedProject)

      const response = await request(app)
        .delete(`/projects/${mockProject.id}`)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        message: 'Project deleted successfully'
      })

      expect(MockProjectService.deleteProject).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id
      )
    })

    it('should return 404 for deleting non-existent project', async () => {
MockProjectService.deleteProject.mockRejectedValueOnce(new Error('Project not found'))

      const response = await request(app)
        .delete('/projects/non-existent-id')
        .expect(404)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Project not found')
    })

    it('should handle deletion error', async () => {
MockProjectService.deleteProject.mockRejectedValueOnce(
        new Error('Cannot delete project with active processing')
      )

      const response = await request(app)
        .delete(`/projects/${mockProject.id}`)
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Cannot delete project with active processing')
    })
  })

  describe('Authorization checks', () => {
    it('should require authentication for GET /projects', async () => {
      // Mock auth middleware to return unauthorized
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .get('/projects')
        .expect(401)
    })

    it('should require authentication for POST /projects', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .post('/projects')
        .send({ name: 'Test Project' })
        .expect(401)
    })

    it('should require authentication for GET /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .get('/projects/test-id')
        .expect(401)
    })

    it('should require authentication for PUT /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .put('/projects/test-id')
        .send({ name: 'Updated Project' })
        .expect(401)
    })

    it('should require authentication for DELETE /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .delete('/projects/test-id')
        .expect(401)
    })

    it('should prevent access to other users projects', async () => {
MockProjectService.getProjectById.mockRejectedValueOnce(
        new Error('Project belongs to different user')
      )

      const response = await request(app)
        .get('/projects/other-user-project-id')
        .expect(403)

      expect(response.body.message).toBe('Project belongs to different user')
    })
  })
})