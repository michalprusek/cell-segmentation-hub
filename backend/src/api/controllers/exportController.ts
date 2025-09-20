import { Request, Response } from 'express';
import { ExportService, ExportOptions } from '../../services/exportService';
import { logger } from '../../utils/logger';
import * as path from 'path';
import { promises as fs } from 'fs';
import { AuthRequest } from '../../types/auth';
import { getProjectById } from '../../services/projectService';
import { createExportFilename } from '../../utils/filenameUtils';

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
      const options = req.body as { options?: ExportOptions };
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
        options.options || {}
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

      // ✅ CRITICAL: Check job status before any file operations
      const job = await this.exportService.getJobWithStatus(jobId, projectId, userId);

      if (!job) {
        res.status(404).json({ error: 'Export job not found' });
        return;
      }

      // ✅ CRITICAL: Prevent download of cancelled exports
      if (job.status === 'cancelled') {
        logger.warn('Download attempt for cancelled export blocked', 'ExportController', {
          jobId: job.id,
          projectId,
          userId,
          cancelledAt: job.cancelledAt,
          clientIP: req.ip || req.connection.remoteAddress
        });

        res.status(410).json({
          error: 'Export was cancelled and is no longer available',
          jobId: job.id,
          cancelledAt: job.cancelledAt,
          message: 'This export was cancelled and cannot be downloaded'
        });
        return;
      }

      // ✅ CRITICAL: Double-check with fresh job state
      const freshJob = await this.exportService.getJobWithStatus(jobId, projectId, userId);
      if (!freshJob || freshJob.status !== 'completed') {
        logger.warn('Job state changed during download validation', 'ExportController', {
          jobId,
          originalStatus: job.status,
          freshStatus: freshJob?.status || 'not_found'
        });

        const statusCode = freshJob?.status === 'cancelled' ? 410 : 409;
        const errorMessage = freshJob?.status === 'cancelled'
          ? 'Export was cancelled during download preparation'
          : `Export is not ready for download. Current status: ${freshJob?.status || 'unknown'}`;

        res.status(statusCode).json({
          error: errorMessage,
          status: freshJob?.status || 'unknown',
          jobId
        });
        return;
      }

      if (job.status !== 'completed') {
        res.status(409).json({
          error: `Export is not ready for download. Current status: ${job.status}`,
          status: job.status
        });
        return;
      }

      const filePath = job.filePath;
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
      } catch (err) {
        logger.error('File not found:', err instanceof Error ? err : new Error(String(err)), 'ExportController');
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Get project name for clean filename
      const project = await getProjectById(projectId, userId);
      
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      // Generate clean filename using project name
      const fileName = createExportFilename(project.title);
      
      // Set proper headers for file download
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      // ✅ Final status verification before file streaming
      const finalJob = await this.exportService.getJobWithStatus(jobId, projectId, userId);
      if (!finalJob || finalJob.status !== 'completed') {
        logger.warn('Job status changed just before download stream', 'ExportController', {
          jobId,
          expectedStatus: 'completed',
          actualStatus: finalJob?.status || 'not_found'
        });
        res.status(410).json({
          error: 'Export is no longer available for download',
          status: finalJob?.status || 'unknown'
        });
        return;
      }

      // Log successful download initiation
      logger.info('Export download initiated', 'ExportController', {
        jobId,
        projectId,
        userId,
        fileName,
        filePath: resolvedFilePath
      });

      // Use res.download with callback for error handling
      res.download(resolvedFilePath, fileName, (err) => {
        if (err) {
          logger.error('Download stream error:', err, 'ExportController', {
            jobId,
            fileName,
            filePath: resolvedFilePath
          });
          // Response might be already sent, so we just log the error
        } else {
          logger.info('Export download completed successfully', 'ExportController', {
            jobId,
            projectId,
            userId,
            fileName
          });
        }
      });
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

      // ✅ Enhanced cancellation with validation
      const jobBeforeCancellation = await this.exportService.getJobWithStatus(jobId, projectId, userId);

      if (!jobBeforeCancellation) {
        res.status(404).json({ error: 'Export job not found' });
        return;
      }

      if (jobBeforeCancellation.status === 'cancelled') {
        res.status(200).json({
          success: true,
          message: 'Export job was already cancelled',
          jobId,
          cancelledAt: jobBeforeCancellation.cancelledAt
        });
        return;
      }

      if (jobBeforeCancellation.status === 'completed') {
        res.status(409).json({
          error: 'Cannot cancel completed export',
          status: 'completed',
          completedAt: jobBeforeCancellation.completedAt
        });
        return;
      }

      logger.info('Initiating export cancellation', 'ExportController', {
        jobId,
        projectId,
        userId,
        currentStatus: jobBeforeCancellation.status,
        progress: jobBeforeCancellation.progress
      });

      await this.exportService.cancelJob(jobId, projectId, userId);

      // ✅ Verify cancellation was successful
      const jobAfterCancellation = await this.exportService.getJobWithStatus(jobId, projectId, userId);

      if (jobAfterCancellation?.status !== 'cancelled') {
        logger.error('Cancellation verification failed', new Error('Job not cancelled after cancellation'), 'ExportController', {
          jobId,
          expectedStatus: 'cancelled',
          actualStatus: jobAfterCancellation?.status
        });
        res.status(500).json({ error: 'Failed to verify export cancellation' });
        return;
      }

      res.json({
        success: true,
        message: 'Export job cancelled successfully',
        jobId,
        previousStatus: jobBeforeCancellation.status,
        cancelledAt: jobAfterCancellation.cancelledAt
      });

      logger.info('Export cancellation completed successfully', 'ExportController', {
        jobId,
        projectId,
        userId,
        previousStatus: jobBeforeCancellation.status,
        cancelledAt: jobAfterCancellation.cancelledAt
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