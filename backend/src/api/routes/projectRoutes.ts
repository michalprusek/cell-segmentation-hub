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
import { cacheMiddleware, conditionalCache, cacheInvalidationMiddleware } from '../../middleware/cache';
import { cacheService } from '../../services/cacheService';
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
 * Get user projects with pagination and search (cached for 5 minutes)
 */
router.get(
  '/',
  validateQuery(projectQuerySchema),
  conditionalCache(300), // 5 minutes
  getProjects
);

/**
 * GET /api/projects/:id
 * Get a specific project by ID (cached for 10 minutes)
 */
router.get(
  '/:id',
  validateParams(projectIdSchema),
  cacheMiddleware(600), // 10 minutes
  getProject
);

/**
 * PUT /api/projects/:id
 * Update a project (invalidates related caches)
 */
router.put(
  '/:id',
  validateParams(projectIdSchema),
  validateBody(updateProjectSchema),
  cacheInvalidationMiddleware('project'),
  updateProject
);

/**
 * DELETE /api/projects/:id
 * Delete a project (invalidates related caches)
 */
router.delete(
  '/:id',
  validateParams(projectIdSchema),
  cacheInvalidationMiddleware('project'),
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