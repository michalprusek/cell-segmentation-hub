import { Router } from 'express';
import { 
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
  getProjectStats
} from '../controllers/projectController';
import { authenticate } from '../../middleware/auth';
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
  createProject
);

/**
 * GET /api/projects
 * Get user projects with pagination and search
 */
router.get(
  '/',
  validateQuery(projectQuerySchema),
  getProjects
);

/**
 * GET /api/projects/:id
 * Get a specific project by ID
 */
router.get(
  '/:id',
  validateParams(projectIdSchema),
  getProject
);

/**
 * PUT /api/projects/:id
 * Update a project
 */
router.put(
  '/:id',
  validateParams(projectIdSchema),
  validateBody(updateProjectSchema),
  updateProject
);

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
router.delete(
  '/:id',
  validateParams(projectIdSchema),
  deleteProject
);

/**
 * GET /api/projects/:id/stats
 * Get project statistics
 */
router.get(
  '/:id/stats',
  validateParams(projectIdSchema),
  getProjectStats
);

// Mount image routes
router.use('/', imageRoutes);

export default router;