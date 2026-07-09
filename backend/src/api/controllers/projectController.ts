import { Request, Response } from 'express';
import * as ProjectService from '../../services/projectService';
import * as MtTypeLabelService from '../../services/mtTypeLabelService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import {
  CreateProjectData,
  UpdateProjectData,
  ProjectQueryParams,
} from '../../types/validation';
import { logger } from '../../utils/logger';

/**
 * Create a new project
 * POST /api/projects
 */
export const createProject = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'ProjectController'
      );
      return;
    }

    const data: CreateProjectData = req.body;

    try {
      const project = await ProjectService.createProject(req.user.id, data);

      ResponseHelper.success(res, project, 'Projekt byl úspěšně vytvořen', 201);
    } catch (error) {
      logger.error(
        'Failed to create project:',
        error as Error,
        'ProjectController',
        {
          userId: req.user.id,
          data,
        }
      );

      ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se vytvořit projekt',
        'ProjectController'
      );
    }
  }
);

/**
 * Get user projects with pagination and search
 * GET /api/projects
 */
export const getProjects = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'ProjectController'
      );
      return;
    }

    // Validate and parse query parameters
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    // Validate numeric parameters
    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      ResponseHelper.badRequest(
        res,
        'Invalid page parameter: must be a positive integer'
      );
      return;
    }

    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 100)
    ) {
      ResponseHelper.badRequest(
        res,
        'Invalid limit parameter: must be an integer between 1 and 100'
      );
      return;
    }

    // Validate sortOrder
    const sortOrder = req.query.sortOrder as string | undefined;
    if (sortOrder && sortOrder !== 'asc' && sortOrder !== 'desc') {
      ResponseHelper.badRequest(
        res,
        'Invalid sortOrder: must be "asc" or "desc"'
      );
      return;
    }

    // folderId is "root" | <uuid> | undefined. The schema validates it as
    // optional; the controller forwards whatever the client sent without
    // re-parsing (any string here would already have been rejected by
    // validateQuery upstream).
    const rawFolderId =
      typeof req.query.folderId === 'string' ? req.query.folderId : undefined;

    const queryParams: ProjectQueryParams = {
      page: page || 1,
      limit: limit || 10,
      search:
        typeof req.query.search === 'string' ? req.query.search : undefined,
      sortBy: (typeof req.query.sortBy === 'string'
        ? req.query.sortBy
        : 'createdAt') as 'createdAt' | 'updatedAt' | 'title',
      sortOrder: (sortOrder || 'desc') as 'asc' | 'desc',
      folderId: rawFolderId as ProjectQueryParams['folderId'],
    };

    try {
      const result = await ProjectService.getUserProjects(
        req.user.id,
        queryParams
      );

      // Prevent browser caching of project lists
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      ResponseHelper.paginated(
        res,
        result.projects,
        result.pagination,
        'Projekty byly úspěšně načteny'
      );
    } catch (error) {
      logger.error(
        'Failed to get projects:',
        error as Error,
        'ProjectController',
        {
          userId: req.user.id,
          queryParams,
        }
      );

      ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se načíst projekty',
        'ProjectController'
      );
    }
  }
);

/**
 * Get a specific project by ID
 * GET /api/projects/:id
 */
export const getProject = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'ProjectController'
      );
      return;
    }

    const projectId = req.params.id;
    if (!projectId) {
      ResponseHelper.badRequest(res, 'Project ID is required');
      return;
    }

    try {
      const project = await ProjectService.getProjectById(
        projectId,
        req.user.id
      );

      if (!project) {
        ResponseHelper.notFound(
          res,
          'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
          'ProjectController'
        );
        return;
      }

      ResponseHelper.success(res, project, 'Projekt byl úspěšně načten');
    } catch (error) {
      logger.error(
        'Failed to get project:',
        error as Error,
        'ProjectController',
        {
          userId: req.user.id,
          projectId,
        }
      );

      ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se načíst projekt',
        'ProjectController'
      );
    }
  }
);

/**
 * Assert the caller owns (or can access) the project. Returns true when the
 * request may proceed; otherwise writes the proper error response and returns
 * false. Shared by the microtubule type-label palette endpoints below.
 */
async function ensureProjectAccess(
  req: Request,
  res: Response,
  projectId: string | undefined
): Promise<boolean> {
  if (!req.user) {
    ResponseHelper.unauthorized(
      res,
      'Uživatel není autentizován',
      'ProjectController'
    );
    return false;
  }
  if (!projectId) {
    ResponseHelper.badRequest(res, 'Project ID is required');
    return false;
  }
  const project = await ProjectService.getProjectById(projectId, req.user.id);
  if (!project) {
    ResponseHelper.notFound(
      res,
      'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
      'ProjectController'
    );
    return false;
  }
  return true;
}

/**
 * GET /api/projects/:id/mt-type-labels — the project's microtubule type-label
 * palette.
 */
export const getMtTypeLabels = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.id;
    if (!(await ensureProjectAccess(req, res, projectId))) return;
    const labels = await MtTypeLabelService.getLabels(projectId);
    ResponseHelper.success(res, { labels }, 'Palette načtena');
  }
);

/**
 * PUT /api/projects/:id/mt-type-labels — replace the palette (create / rename /
 * reorder / remove). body: `{ labels: MTTypeLabel[] }`. A label dropped by the
 * new set has its references cleaned (framesCleaned reported).
 */
export const putMtTypeLabels = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.id;
    if (!(await ensureProjectAccess(req, res, projectId))) return;
    const { labels, framesCleaned } = await MtTypeLabelService.putLabels(
      projectId,
      (req.body as { labels?: unknown })?.labels
    );
    ResponseHelper.success(res, { labels, framesCleaned }, 'Palette uložena');
  }
);

/**
 * DELETE /api/projects/:id/mt-type-labels/:labelId — remove one label and null
 * every `mtType` reference to it across the project's frames.
 */
export const deleteMtTypeLabel = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.id;
    if (!(await ensureProjectAccess(req, res, projectId))) return;
    const { labels, framesCleaned } = await MtTypeLabelService.deleteLabel(
      projectId,
      req.params.labelId
    );
    ResponseHelper.success(res, { labels, framesCleaned }, 'Label smazán');
  }
);

/**
 * Update a project
 * PUT /api/projects/:id
 */
export const updateProject = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'ProjectController'
      );
      return;
    }

    const projectId = req.params.id;
    if (!projectId) {
      ResponseHelper.badRequest(res, 'Project ID is required');
      return;
    }
    const data: UpdateProjectData = req.body;

    try {
      const project = await ProjectService.updateProject(
        projectId,
        req.user.id,
        data
      );

      if (!project) {
        ResponseHelper.notFound(
          res,
          'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
          'ProjectController'
        );
        return;
      }

      ResponseHelper.success(res, project, 'Projekt byl úspěšně aktualizován');
    } catch (error) {
      logger.error(
        'Failed to update project:',
        error as Error,
        'ProjectController',
        {
          userId: req.user.id,
          projectId,
          data,
        }
      );

      ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se aktualizovat projekt',
        'ProjectController'
      );
    }
  }
);

/**
 * Delete a project
 * DELETE /api/projects/:id
 */
export const deleteProject = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'ProjectController'
      );
      return;
    }

    const projectId = req.params.id;
    if (!projectId) {
      ResponseHelper.badRequest(res, 'Project ID is required');
      return;
    }

    try {
      const deletedProject = await ProjectService.deleteProject(
        projectId,
        req.user.id
      );

      if (!deletedProject) {
        ResponseHelper.notFound(
          res,
          'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
          'ProjectController'
        );
        return;
      }

      ResponseHelper.success(
        res,
        {
          id: deletedProject.id,
          title: deletedProject.title,
          deletedImagesCount: deletedProject._count.images,
        },
        'Projekt byl úspěšně smazán'
      );
    } catch (error) {
      logger.error(
        'Failed to delete project:',
        error as Error,
        'ProjectController',
        {
          userId: req.user.id,
          projectId,
        }
      );

      ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se smazat projekt',
        'ProjectController'
      );
    }
  }
);

/**
 * Get project statistics
 * GET /api/projects/:id/stats
 */
export const getProjectStats = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'ProjectController'
      );
      return;
    }

    const projectId = req.params.id;
    if (!projectId) {
      ResponseHelper.badRequest(res, 'Project ID is required');
      return;
    }

    try {
      const stats = await ProjectService.getProjectStats(
        projectId,
        req.user.id
      );

      if (!stats) {
        ResponseHelper.notFound(
          res,
          'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
          'ProjectController'
        );
        return;
      }

      ResponseHelper.success(
        res,
        stats,
        'Statistiky projektu byly úspěšně načteny'
      );
    } catch (error) {
      logger.error(
        'Failed to get project stats:',
        error as Error,
        'ProjectController',
        {
          userId: req.user.id,
          projectId,
        }
      );

      ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se načíst statistiky projektu',
        'ProjectController'
      );
    }
  }
);
