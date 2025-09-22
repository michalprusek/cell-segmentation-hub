import { Router } from 'express';
import {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
  getProjectStats,
} from '../controllers/projectController';
import { authenticate } from '../../middleware/auth';
import {
  validateBody,
  validateQuery,
  validateParams,
} from '../../middleware/validation';
import {
  cacheMiddleware,
  conditionalCache,
  cacheInvalidationMiddleware,
} from '../../middleware/cache';
import { CacheService } from '../../services/cacheService';
import {
  createProjectSchema,
  updateProjectSchema,
  projectQuerySchema,
  projectIdSchema,
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
router.post('/', validateBody(createProjectSchema), createProject);

/**
 * GET /api/projects
 * Get user projects with pagination and search (cached for 5 minutes)
 */
router.get(
  '/',
  validateQuery(projectQuerySchema),
  conditionalCache.userSpecific(CacheService.TTL_PRESETS.SHORT),
  getProjects
);

/**
 * GET /api/projects/:id
 * Get a specific project by ID (cached for 10 minutes)
 */
router.get(
  '/:id',
  validateParams(projectIdSchema),
  cacheMiddleware({
    ttl: CacheService.TTL_PRESETS.DATABASE_QUERY,
    namespace: 'project',
    keyGenerator: req => `${req.user?.id}:${req.params.id}`,
  }),
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
  cacheInvalidationMiddleware(req => [
    `project:${req.params.id}:*`,
    `projects:user:${req.user?.id}:*`,
    `stats:user:${req.user?.id}:*`,
  ]),
  updateProject
);

/**
 * DELETE /api/projects/:id
 * Delete a project (invalidates related caches)
 */
router.delete(
  '/:id',
  validateParams(projectIdSchema),
  cacheInvalidationMiddleware(req => [
    `project:${req.params.id}:*`,
    `projects:user:${req.user?.id}:*`,
    `stats:user:${req.user?.id}:*`,
  ]),
  deleteProject
);

/**
 * GET /api/projects/:id/stats
 * Get project statistics
 */
router.get('/:id/stats', validateParams(projectIdSchema), getProjectStats);

// Mount image routes
router.use('/', imageRoutes);

export default router;
