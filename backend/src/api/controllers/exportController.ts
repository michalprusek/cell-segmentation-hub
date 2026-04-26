import { Request, Response } from 'express';
import { ExportService, ExportOptions } from '../../services/exportService';
import { ResponseHelper } from '../../utils/response';
import { logger } from '../../utils/logger';
import * as path from 'path';
import { promises as fs } from 'fs';
import { AuthRequest } from '../../types/auth';
import {
  issueDownloadToken,
  verifyDownloadToken,
  InvalidDownloadTokenError,
} from '../../services/export/downloadTokenService';

const CTX = 'ExportController';

const toErr = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e));

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
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }
      if (!projectId || !jobId) {
        ResponseHelper.badRequest(
          res,
          'Project ID and Job ID are required',
          CTX
        );
        return;
      }

      // Verify the user actually owns/has access to the export file
      const filePath = await this.exportService.getExportFilePath(
        jobId,
        projectId,
        userId
      );
      if (!filePath) {
        ResponseHelper.notFound(res, 'Export file not found', CTX);
        return;
      }

      const issued = issueDownloadToken(jobId, projectId, userId);
      res.json({
        token: issued.token,
        expiresAt: issued.expiresAt,
      });
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to issue download token',
        CTX
      );
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
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }

      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required', CTX);
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
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to start export',
        CTX
      );
    }
  }

  async getExportStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, jobId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }

      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required', CTX);
        return;
      }

      if (!jobId) {
        ResponseHelper.badRequest(res, 'Job ID is required', CTX);
        return;
      }

      const status = await this.exportService.getJobStatus(
        jobId,
        projectId,
        userId
      );

      if (!status) {
        ResponseHelper.notFound(res, 'Export status not found', CTX);
        return;
      }

      res.json(status);
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to get export status',
        CTX
      );
    }
  }

  async downloadExport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, jobId } = req.params;

      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required', CTX);
        return;
      }
      if (!jobId) {
        ResponseHelper.badRequest(res, 'Job ID is required', CTX);
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
            ResponseHelper.forbidden(
              res,
              'Token does not match resource',
              CTX
            );
            return;
          }
          userId = payload.userId;
        } catch (err) {
          if (err instanceof InvalidDownloadTokenError) {
            ResponseHelper.unauthorized(
              res,
              `Invalid download token: ${err.message}`,
              CTX
            );
            return;
          }
          throw err;
        }
      }

      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }

      const filePath = await this.exportService.getExportFilePath(
        jobId,
        projectId,
        userId
      );

      if (!filePath) {
        ResponseHelper.notFound(res, 'Export file not found', CTX);
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
        ResponseHelper.badRequest(res, 'Invalid file path', CTX);
        return;
      }

      // Verify the file exists and is a regular file
      let fileSize: number;
      try {
        const stats = await fs.stat(resolvedFilePath);
        if (!stats.isFile()) {
          ResponseHelper.notFound(res, 'File not found', CTX);
          return;
        }
        fileSize = stats.size;
      } catch {
        ResponseHelper.notFound(res, 'File not found', CTX);
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

      res.sendFile(resolvedFilePath, sendErr => {
        if (sendErr) {
          // Response might already be partially sent — sendFile owns the
          // stream, so we cannot send another response. Just log.
          logger.error('Send file error:', sendErr, CTX);
        }
      });
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to download export',
        CTX
      );
    }
  }

  async cancelExport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, jobId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }

      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required', CTX);
        return;
      }

      if (!jobId) {
        ResponseHelper.badRequest(res, 'Job ID is required', CTX);
        return;
      }

      await this.exportService.cancelJob(jobId, projectId, userId);

      res.json({
        success: true,
        message: 'Export job cancelled successfully',
      });
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to cancel export',
        CTX
      );
    }
  }

  async getExportHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }

      if (!projectId) {
        ResponseHelper.badRequest(res, 'Project ID is required', CTX);
        return;
      }

      const history = await this.exportService.getExportHistory(
        projectId,
        userId
      );

      res.json(history);
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to get export history',
        CTX
      );
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
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to get export formats',
        CTX
      );
    }
  }
}
