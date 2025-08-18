import { Request, Response } from 'express';
import { ExportService } from '../../services/exportService';
import { logger } from '../../utils/logger';
import * as path from 'path';
import { promises as fs } from 'fs';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    emailVerified: boolean;
    profile?: {
      id: string;
      firstName?: string | null;
      lastName?: string | null;
      organizationName?: string | null;
      role?: string | null;
      bio?: string | null;
      avatarUrl?: string | null;
      userId: string;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  };
  params: Record<string, string>;
  body: Record<string, any>;
}

export class ExportController {
  private exportService: ExportService;

  constructor() {
    this.exportService = ExportService.getInstance();
    
    // Bind all methods
    this.startExport = this.startExport.bind(this);
    this.getExportStatus = this.getExportStatus.bind(this);
    this.downloadExport = this.downloadExport.bind(this);
    this.cancelExport = this.cancelExport.bind(this);
    this.getExportHistory = this.getExportHistory.bind(this);
    this.getExportFormats = this.getExportFormats.bind(this);
  }

  async startExport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const { options } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      const jobId = await this.exportService.startExportJob(
        projectId,
        userId,
        options
      );

      res.json({
        success: true,
        jobId,
        message: 'Export job started successfully',
      });
    } catch (error) {
      logger.error('Export start failed:', error instanceof Error ? error : new Error(String(error)), 'ExportController');
      res.status(500).json({ error: 'Failed to start export' });
    }
  }

  async getExportStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, jobId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      if (!jobId) {
        res.status(400).json({ error: 'Job ID is required' });
        return;
      }

      const status = await this.exportService.getJobStatus(
        jobId,
        projectId,
        userId
      );

      if (!status) {
        res.status(404).json({ error: 'Export status not found' });
        return;
      }

      res.json(status);
    } catch (error) {
      logger.error('Failed to get export status:', error instanceof Error ? error : new Error(String(error)), 'ExportController');
      res.status(500).json({ error: 'Failed to get export status' });
    }
  }

  async downloadExport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, jobId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      if (!jobId) {
        res.status(400).json({ error: 'Job ID is required' });
        return;
      }

      const filePath = await this.exportService.getExportFilePath(
        jobId,
        projectId,
        userId
      );

      if (!filePath) {
        res.status(404).json({ error: 'Export file not found' });
        return;
      }

      // Validate and sanitize the file path to prevent path traversal
      const exportsBaseDir = path.resolve(process.env.EXPORT_DIR || './exports');
      const resolvedFilePath = path.resolve(filePath);
      
      // Verify the resolved path is within the exports directory
      if (!resolvedFilePath.startsWith(exportsBaseDir + path.sep) && resolvedFilePath !== exportsBaseDir) {
        res.status(400).json({ error: 'Invalid file path' });
        return;
      }

      // Verify the file exists and is a regular file
      try {
        const stats = await fs.stat(resolvedFilePath);
        if (!stats.isFile()) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
      } catch (_error) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      res.download(resolvedFilePath);
    } catch (error) {
      logger.error('Download export failed:', error instanceof Error ? error : new Error(String(error)), 'ExportController');
      res.status(500).json({ error: 'Failed to download export' });
    }
  }

  async cancelExport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, jobId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      if (!jobId) {
        res.status(400).json({ error: 'Job ID is required' });
        return;
      }

      await this.exportService.cancelJob(jobId, projectId, userId);

      res.json({
        success: true,
        message: 'Export job cancelled successfully',
      });
    } catch (error) {
      logger.error('Cancel export failed:', error instanceof Error ? error : new Error(String(error)), 'ExportController');
      res.status(500).json({ error: 'Failed to cancel export' });
    }
  }

  async getExportHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      const history = await this.exportService.getExportHistory(
        projectId,
        userId
      );

      res.json(history);
    } catch (error) {
      logger.error('Failed to get export history:', error instanceof Error ? error : new Error(String(error)), 'ExportController');
      res.status(500).json({ error: 'Failed to get export history' });
    }
  }

  async getExportFormats(req: Request, res: Response): Promise<void> {
    try {
      const formats = {
        annotations: [
          { id: 'coco', name: 'COCO', description: 'Common Objects in Context format' },
          { id: 'yolo', name: 'YOLO', description: 'You Only Look Once format' },
          { id: 'json', name: 'JSON', description: 'Custom JSON format' },
        ],
        metrics: [
          { id: 'excel', name: 'Excel', description: 'Microsoft Excel format (.xlsx)' },
          { id: 'csv', name: 'CSV', description: 'Comma-separated values' },
          { id: 'json', name: 'JSON', description: 'JavaScript Object Notation' },
        ],
      };

      res.json(formats);
    } catch (error) {
      logger.error('Failed to get export formats:', error instanceof Error ? error : new Error(String(error)), 'ExportController');
      res.status(500).json({ error: 'Failed to get export formats' });
    }
  }
}