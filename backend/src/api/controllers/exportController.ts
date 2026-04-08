import { Request, Response } from 'express';
import { ExportService, ExportOptions } from '../../services/exportService';
import { logger } from '../../utils/logger';
import * as path from 'path';
import { promises as fs } from 'fs';
import { AuthRequest } from '../../types/auth';
import {
  issueDownloadToken,
  verifyDownloadToken,
  InvalidDownloadTokenError,
} from '../../services/export/downloadTokenService';

export class ExportController {
  private exportService: ExportService;

  constructor() {
    this.exportService = ExportService.getInstance();

    // Bind all methods
    this.startExport = this.startExport.bind(this);
    this.getExportStatus = this.getExportStatus.bind(this);
    this.downloadExport = this.downloadExport.bind(this);
    this.getDownloadToken = this.getDownloadToken.bind(this);
    this.cancelExport = this.cancelExport.bind(this);
    this.getExportHistory = this.getExportHistory.bind(this);
    this.getExportFormats = this.getExportFormats.bind(this);
  }

  /**
   * Issue a short-lived HMAC-signed download token for an export job.
   * The token is bound to (jobId, projectId, userId) and used by the
   * frontend to trigger a native browser download via <a href> — bypassing
   * the axios blob path that fails for very large exports.
   */
  async getDownloadToken(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, jobId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (!projectId || !jobId) {
        res.status(400).json({ error: 'Project ID and Job ID are required' });
        return;
      }

      // Verify the user actually owns/has access to the export file
      const filePath = await this.exportService.getExportFilePath(
        jobId,
        projectId,
        userId
      );
      if (!filePath) {
        res.status(404).json({ error: 'Export file not found' });
        return;
      }

      const issued = issueDownloadToken(jobId, projectId, userId);
      res.json({
        token: issued.token,
        expiresAt: issued.expiresAt,
      });
    } catch (error) {
      logger.error(
        'Failed to issue download token:',
        error instanceof Error ? error : new Error(String(error)),
        'ExportController'
      );
      res.status(500).json({ error: 'Failed to issue download token' });
    }
  }

  async startExport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const { options, projectName } = req.body as {
        options?: ExportOptions;
        projectName?: string;
      };
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
        options || {},
        projectName
      );

      res.json({
        success: true,
        jobId,
        message: 'Export job started successfully',
      });
    } catch (error) {
      logger.error(
        'Export start failed:',
        error instanceof Error ? error : new Error(String(error)),
        'ExportController'
      );
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
      logger.error(
        'Failed to get export status:',
        error instanceof Error ? error : new Error(String(error)),
        'ExportController'
      );
      res.status(500).json({ error: 'Failed to get export status' });
    }
  }

  async downloadExport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, jobId } = req.params;

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }
      if (!jobId) {
        res.status(400).json({ error: 'Job ID is required' });
        return;
      }

      // Two auth modes are accepted on this endpoint:
      //   1) Standard JWT (Authorization header) — when called from XHR
      //   2) Short-lived signed download token in ?token= — when triggered
      //      via a native browser download (<a href>), which cannot send
      //      custom headers. This bypasses the axios blob path so very
      //      large exports stream directly to disk without exhausting
      //      browser memory or hitting axios timeouts.
      let userId: string | undefined = req.user?.id;
      const queryToken =
        typeof req.query.token === 'string' ? req.query.token : undefined;

      if (queryToken) {
        try {
          const payload = verifyDownloadToken(queryToken);
          if (payload.jobId !== jobId || payload.projectId !== projectId) {
            res.status(403).json({ error: 'Token does not match resource' });
            return;
          }
          userId = payload.userId;
        } catch (err) {
          if (err instanceof InvalidDownloadTokenError) {
            res
              .status(401)
              .json({ error: `Invalid download token: ${err.message}` });
            return;
          }
          throw err;
        }
      }

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
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
      const exportsBaseDir = path.resolve(
        process.env.EXPORT_DIR || './exports'
      );
      const resolvedFilePath = path.resolve(filePath);

      // Verify the resolved path is within the exports directory
      const rel = path.relative(exportsBaseDir, resolvedFilePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        res.status(400).json({ error: 'Invalid file path' });
        return;
      }

      // Verify the file exists and is a regular file
      let fileSize: number;
      try {
        const stats = await fs.stat(resolvedFilePath);
        if (!stats.isFile()) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        fileSize = stats.size;
      } catch (err) {
        logger.error(
          'File not found:',
          err instanceof Error ? err : new Error(String(err)),
          'ExportController'
        );
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Build a sensible filename. Filename comes from query (so the
      // browser save dialog shows the project name) but is sanitized to
      // prevent header injection.
      const rawName =
        typeof req.query.filename === 'string' ? req.query.filename : '';
      const safeName =
        rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) ||
        `export_${jobId}.zip`;
      const downloadName = safeName.endsWith('.zip')
        ? safeName
        : `${safeName}.zip`;

      // Set headers for a proper attachment download
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${downloadName}"`
      );
      res.setHeader('Content-Length', String(fileSize));
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.sendFile(resolvedFilePath, err => {
        if (err) {
          logger.error('Send file error:', err, 'ExportController');
          // Response might already be partially sent — just log.
        }
      });
    } catch (error) {
      logger.error(
        'Download export failed:',
        error instanceof Error ? error : new Error(String(error)),
        'ExportController'
      );
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
      logger.error(
        'Cancel export failed:',
        error instanceof Error ? error : new Error(String(error)),
        'ExportController'
      );
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
      logger.error(
        'Failed to get export history:',
        error instanceof Error ? error : new Error(String(error)),
        'ExportController'
      );
      res.status(500).json({ error: 'Failed to get export history' });
    }
  }

  async getExportFormats(req: Request, res: Response): Promise<void> {
    try {
      const formats = {
        annotations: [
          {
            id: 'coco',
            name: 'COCO',
            description: 'Common Objects in Context format',
          },
          {
            id: 'yolo',
            name: 'YOLO',
            description: 'You Only Look Once format',
          },
          { id: 'json', name: 'JSON', description: 'Custom JSON format' },
        ],
        metrics: [
          {
            id: 'excel',
            name: 'Excel',
            description: 'Microsoft Excel format (.xlsx)',
          },
          { id: 'csv', name: 'CSV', description: 'Comma-separated values' },
          {
            id: 'json',
            name: 'JSON',
            description: 'JavaScript Object Notation',
          },
        ],
      };

      res.json(formats);
    } catch (error) {
      logger.error(
        'Failed to get export formats:',
        error instanceof Error ? error : new Error(String(error)),
        'ExportController'
      );
      res.status(500).json({ error: 'Failed to get export formats' });
    }
  }
}
