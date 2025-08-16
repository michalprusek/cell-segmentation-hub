import { Request, Response } from 'express';
import { ProjectService } from '../../services/projectService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import { CreateProjectData, UpdateProjectData, ProjectQueryParams } from '../../types/validation';
import { logger } from '../../utils/logger';

/**
 * Controller for project-related operations
 */
export class ProjectController {
  /**
   * Create a new project
   * POST /api/projects
   */
  static createProject = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'ProjectController');
    }

    const data: CreateProjectData = req.body;
    
    try {
      const project = await ProjectService.createProject(req.user.id, data);
      
      return ResponseHelper.success(
        res,
        project,
        'Projekt byl úspěšně vytvořen',
        201
      );
    } catch (error) {
      logger.error('Failed to create project:', error as Error, 'ProjectController', {
        userId: req.user.id,
        data
      });
      
      return ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se vytvořit projekt',
        'ProjectController'
      );
    }
  });

  /**
   * Get user projects with pagination and search
   * GET /api/projects
   */
  static getProjects = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'ProjectController');
    }

    // Validate and parse query parameters
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    
    // Validate numeric parameters
    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      return ResponseHelper.badRequest(res, 'Invalid page parameter: must be a positive integer');
    }
    
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      return ResponseHelper.badRequest(res, 'Invalid limit parameter: must be an integer between 1 and 100');
    }
    
    // Validate sortOrder
    const sortOrder = req.query.sortOrder as string | undefined;
    if (sortOrder && sortOrder !== 'asc' && sortOrder !== 'desc') {
      return ResponseHelper.badRequest(res, 'Invalid sortOrder: must be "asc" or "desc"');
    }
    
    const queryParams: ProjectQueryParams = {
      page: page || 1,
      limit: limit || 10,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      sortBy: (typeof req.query.sortBy === 'string' ? req.query.sortBy : 'createdAt') as 'createdAt' | 'updatedAt' | 'title',
      sortOrder: (sortOrder || 'desc') as 'asc' | 'desc'
    };
    
    try {
      const result = await ProjectService.getUserProjects(req.user.id, queryParams);
      
      return ResponseHelper.paginated(
        res,
        result.projects,
        result.pagination,
        'Projekty byly úspěšně načteny'
      );
    } catch (error) {
      logger.error('Failed to get projects:', error as Error, 'ProjectController', {
        userId: req.user.id,
        queryParams
      });
      
      return ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se načíst projekty',
        'ProjectController'
      );
    }
  });

  /**
   * Get a specific project by ID
   * GET /api/projects/:id
   */
  static getProject = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'ProjectController');
    }

    const projectId = req.params.id;
    
    try {
      const project = await ProjectService.getProjectById(projectId!, req.user.id);
      
      if (!project) {
        return ResponseHelper.notFound(
          res,
          'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
          'ProjectController'
        );
      }
      
      return ResponseHelper.success(
        res,
        project,
        'Projekt byl úspěšně načten'
      );
    } catch (error) {
      logger.error('Failed to get project:', error as Error, 'ProjectController', {
        userId: req.user.id,
        projectId
      });
      
      return ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se načíst projekt',
        'ProjectController'
      );
    }
  });

  /**
   * Update a project
   * PUT /api/projects/:id
   */
  static updateProject = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'ProjectController');
    }

    const projectId = req.params.id;
    const data: UpdateProjectData = req.body;
    
    try {
      const project = await ProjectService.updateProject(projectId!, req.user.id, data);
      
      if (!project) {
        return ResponseHelper.notFound(
          res,
          'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
          'ProjectController'
        );
      }
      
      return ResponseHelper.success(
        res,
        project,
        'Projekt byl úspěšně aktualizován'
      );
    } catch (error) {
      logger.error('Failed to update project:', error as Error, 'ProjectController', {
        userId: req.user.id,
        projectId,
        data
      });
      
      return ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se aktualizovat projekt',
        'ProjectController'
      );
    }
  });

  /**
   * Delete a project
   * DELETE /api/projects/:id
   */
  static deleteProject = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'ProjectController');
    }

    const projectId = req.params.id;
    
    try {
      const deletedProject = await ProjectService.deleteProject(projectId!, req.user.id);
      
      if (!deletedProject) {
        return ResponseHelper.notFound(
          res,
          'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
          'ProjectController'
        );
      }
      
      return ResponseHelper.success(
        res,
        {
          id: deletedProject.id,
          title: deletedProject.title,
          deletedImagesCount: deletedProject._count.images
        },
        'Projekt byl úspěšně smazán'
      );
    } catch (error) {
      logger.error('Failed to delete project:', error as Error, 'ProjectController', {
        userId: req.user.id,
        projectId
      });
      
      return ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se smazat projekt',
        'ProjectController'
      );
    }
  });

  /**
   * Get project statistics
   * GET /api/projects/:id/stats
   */
  static getProjectStats = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'ProjectController');
    }

    const projectId = req.params.id;
    
    try {
      const stats = await ProjectService.getProjectStats(projectId!, req.user.id);
      
      if (!stats) {
        return ResponseHelper.notFound(
          res,
          'Projekt nebyl nalezen nebo k němu nemáte oprávnění',
          'ProjectController'
        );
      }
      
      return ResponseHelper.success(
        res,
        stats,
        'Statistiky projektu byly úspěšně načteny'
      );
    } catch (error) {
      logger.error('Failed to get project stats:', error as Error, 'ProjectController', {
        userId: req.user.id,
        projectId
      });
      
      return ResponseHelper.internalError(
        res,
        error as Error,
        'Nepodařilo se načíst statistiky projektu',
        'ProjectController'
      );
    }
  });
}