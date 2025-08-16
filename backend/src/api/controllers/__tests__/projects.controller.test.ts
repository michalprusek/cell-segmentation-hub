import request from 'supertest'
import express from 'express'
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { ProjectsController } from '../projects.controller'
import { ProjectsService } from '../../services/projects.service'
import { authMiddleware } from '../../middleware/auth.middleware'

// Mock dependencies
jest.mock('../../services/projects.service')
jest.mock('../../middleware/auth.middleware')

const MockProjectsService = ProjectsService as jest.MockedClass<typeof ProjectsService>
const mockAuthMiddleware = authMiddleware as jest.MockedFunction<typeof authMiddleware>

describe('ProjectsController', () => {
  let app: express.Application
  let projectsService: jest.Mocked<ProjectsService>
  let projectsController: ProjectsController

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
    images: []
  }

  beforeEach(() => {
    app = express()
    app.use(express.json())
    
    // Mock auth middleware to add user to request
    mockAuthMiddleware.mockImplementation((req, res, next) => {
      req.user = mockUser
      next()
    })

    projectsService = new MockProjectsService() as jest.Mocked<ProjectsService>
    projectsController = new ProjectsController(projectsService)

    // Setup routes
    app.get('/projects', mockAuthMiddleware, projectsController.getProjects.bind(projectsController))
    app.post('/projects', mockAuthMiddleware, projectsController.createProject.bind(projectsController))
    app.get('/projects/:id', mockAuthMiddleware, projectsController.getProject.bind(projectsController))
    app.put('/projects/:id', mockAuthMiddleware, projectsController.updateProject.bind(projectsController))
    app.delete('/projects/:id', mockAuthMiddleware, projectsController.deleteProject.bind(projectsController))
  })

  describe('GET /projects', () => {
    it('should return user projects successfully', async () => {
      const mockProjects = [mockProject]
      projectsService.getUserProjects.mockResolvedValueOnce(mockProjects)

      const response = await request(app)
        .get('/projects')
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        data: mockProjects,
        message: 'Projects retrieved successfully'
      })

      expect(projectsService.getUserProjects).toHaveBeenCalledWith(mockUser.id)
    })

    it('should handle service error', async () => {
      projectsService.getUserProjects.mockRejectedValueOnce(new Error('Database error'))

      const response = await request(app)
        .get('/projects')
        .expect(500)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Database error')
    })

    it('should return empty array when user has no projects', async () => {
      projectsService.getUserProjects.mockResolvedValueOnce([])

      const response = await request(app)
        .get('/projects')
        .expect(200)

      expect(response.body.data).toEqual([])
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

      projectsService.createProject.mockResolvedValueOnce(createdProject)

      const response = await request(app)
        .post('/projects')
        .send(projectData)
        .expect(201)

      expect(response.body).toEqual({
        success: true,
        data: createdProject,
        message: 'Project created successfully'
      })

      expect(projectsService.createProject).toHaveBeenCalledWith({
        ...projectData,
        userId: mockUser.id
      })
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

      projectsService.createProject.mockRejectedValueOnce(
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
      projectsService.getProjectById.mockResolvedValueOnce(mockProject)

      const response = await request(app)
        .get(`/projects/${mockProject.id}`)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        data: mockProject,
        message: 'Project retrieved successfully'
      })

      expect(projectsService.getProjectById).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id
      )
    })

    it('should return 404 for non-existent project', async () => {
      projectsService.getProjectById.mockResolvedValueOnce(null)

      const response = await request(app)
        .get('/projects/non-existent-id')
        .expect(404)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Project not found')
    })

    it('should return 403 for unauthorized access', async () => {
      projectsService.getProjectById.mockRejectedValueOnce(
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

      projectsService.updateProject.mockResolvedValueOnce(updatedProject)

      const response = await request(app)
        .put(`/projects/${mockProject.id}`)
        .send(updateData)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        data: updatedProject,
        message: 'Project updated successfully'
      })

      expect(projectsService.updateProject).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id,
        updateData
      )
    })

    it('should return 404 for updating non-existent project', async () => {
      const updateData = {
        name: 'Updated Project'
      }

      projectsService.updateProject.mockResolvedValueOnce(null)

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
      projectsService.deleteProject.mockResolvedValueOnce(true)

      const response = await request(app)
        .delete(`/projects/${mockProject.id}`)
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        message: 'Project deleted successfully'
      })

      expect(projectsService.deleteProject).toHaveBeenCalledWith(
        mockProject.id,
        mockUser.id
      )
    })

    it('should return 404 for deleting non-existent project', async () => {
      projectsService.deleteProject.mockResolvedValueOnce(false)

      const response = await request(app)
        .delete('/projects/non-existent-id')
        .expect(404)

      expect(response.body.success).toBe(false)
      expect(response.body.message).toBe('Project not found')
    })

    it('should handle deletion error', async () => {
      projectsService.deleteProject.mockRejectedValueOnce(
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
      mockAuthMiddleware.mockImplementationOnce((req, res, next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .get('/projects')
        .expect(401)
    })

    it('should require authentication for POST /projects', async () => {
      mockAuthMiddleware.mockImplementationOnce((req, res, next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .post('/projects')
        .send({ name: 'Test Project' })
        .expect(401)
    })

    it('should require authentication for GET /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce((req, res, next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .get('/projects/test-id')
        .expect(401)
    })

    it('should require authentication for PUT /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce((req, res, next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .put('/projects/test-id')
        .send({ name: 'Updated Project' })
        .expect(401)
    })

    it('should require authentication for DELETE /projects/:id', async () => {
      mockAuthMiddleware.mockImplementationOnce((req, res, next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' })
      })

      await request(app)
        .delete('/projects/test-id')
        .expect(401)
    })

    it('should prevent access to other users projects', async () => {
      projectsService.getProjectById.mockRejectedValueOnce(
        new Error('Project belongs to different user')
      )

      const response = await request(app)
        .get('/projects/other-user-project-id')
        .expect(403)

      expect(response.body.message).toBe('Project belongs to different user')
    })
  })
})