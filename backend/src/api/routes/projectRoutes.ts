import { Router } from 'express';
import { ProjectController } from '../controllers/projectController';
import { authenticate, requireEmailVerification } from '../../middleware/auth';
import { validateBody, validateQuery, validateParams } from '../../middleware/validation';
import { 
  createProjectSchema, 
  updateProjectSchema, 
  projectQuerySchema, 
  projectIdSchema 
} from '../../types/validation';
import imageRoutes from './imageRoutes';

const router = Router();

// All project routes require authentication (email verification disabled for development)
router.use(authenticate);
// router.use(requireEmailVerification); // Temporarily disabled for development

/**
 * POST /api/projects
 * Create a new project
 */
router.post(
  '/',
  validateBody(createProjectSchema),
  ProjectController.createProject
);

/**
 * GET /api/projects
 * Get user projects with pagination and search
 */
router.get(
  '/',
  validateQuery(projectQuerySchema),
  ProjectController.getProjects
);

/**
 * GET /api/projects/:id
 * Get a specific project by ID
 */
router.get(
  '/:id',
  validateParams(projectIdSchema),
  ProjectController.getProject
);

/**
 * PUT /api/projects/:id
 * Update a project
 */
router.put(
  '/:id',
  validateParams(projectIdSchema),
  validateBody(updateProjectSchema),
  ProjectController.updateProject
);

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
router.delete(
  '/:id',
  validateParams(projectIdSchema),
  ProjectController.deleteProject
);

/**
 * GET /api/projects/:id/stats
 * Get project statistics
 */
router.get(
  '/:id/stats',
  validateParams(projectIdSchema),
  ProjectController.getProjectStats
);

// Mount image routes
router.use('/', imageRoutes);

export default router;