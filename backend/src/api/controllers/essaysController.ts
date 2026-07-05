import { Response } from 'express';
import path from 'path';
import { ResponseHelper } from '../../utils/response';
import { logger } from '../../utils/logger';
import { AuthRequest } from '../../types/auth';
import { EssaysService, EssayJobOptions } from '../../services/essaysService';
import {
  issueDownloadToken,
  verifyDownloadToken,
  InvalidDownloadTokenError,
} from '../../services/export/downloadTokenService';

const CTX = 'EssaysController';

// The download token carries a projectId slot; Automated Essays has no project,
// so a fixed sentinel is used and asserted on verify.
const PROJECT_SENTINEL = 'essays';

const toErr = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e));

/** Parse and whitelist evaluate.py options sent as a JSON string form field. */
function parseOptions(raw: unknown): EssayJobOptions {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: EssayJobOptions = {};
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  if (num(parsed.threshold) !== undefined) out.threshold = num(parsed.threshold);
  if (num(parsed.mtWidth) !== undefined) out.mtWidth = num(parsed.mtWidth);
  if (num(parsed.bgGap) !== undefined) out.bgGap = num(parsed.bgGap);
  if (num(parsed.bgWidth) !== undefined) out.bgWidth = num(parsed.bgWidth);
  if (num(parsed.limitWells) !== undefined) out.limitWells = num(parsed.limitWells);
  if (typeof parsed.tirfName === 'string') out.tirfName = parsed.tirfName;
  if (typeof parsed.solutionName === 'string') out.solutionName = parsed.solutionName;
  if (typeof parsed.noOverlays === 'boolean') out.noOverlays = parsed.noOverlays;
  if (typeof parsed.noJson === 'boolean') out.noJson = parsed.noJson;
  return out;
}

export class EssaysController {
  private service: EssaysService;

  constructor() {
    this.service = EssaysService.getInstance();
    this.uploadEssays = this.uploadEssays.bind(this);
    this.listJobs = this.listJobs.bind(this);
    this.getJob = this.getJob.bind(this);
    this.getDownloadToken = this.getDownloadToken.bind(this);
    this.downloadJob = this.downloadJob.bind(this);
    this.deleteJob = this.deleteJob.bind(this);
  }

  /** POST /api/essays/upload — stage a folder of .nd2 wells and start a job. */
  async uploadEssays(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        ResponseHelper.badRequest(
          res,
          'No .nd2 files were uploaded',
          CTX
        );
        return;
      }
      const body = (req.body ?? {}) as {
        options?: unknown;
        folderName?: unknown;
      };
      const options = parseOptions(body.options);
      const folderName =
        typeof body.folderName === 'string' ? body.folderName : undefined;

      const { jobId } = await this.service.submitJob(
        userId,
        files,
        options,
        folderName
      );
      res.json({ success: true, jobId, message: 'Essays job started' });
    } catch (error) {
      const err = toErr(error);
      if (err.message.includes('worker is unavailable')) {
        ResponseHelper.internalError(res, err, err.message, CTX);
        return;
      }
      ResponseHelper.internalError(res, err, 'Failed to start essays job', CTX);
    }
  }

  /** GET /api/essays/jobs — the caller's job history. */
  async listJobs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }
      const jobs = await this.service.listJobs(userId);
      res.json({ success: true, jobs });
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to list essays jobs',
        CTX
      );
    }
  }

  /** GET /api/essays/jobs/:jobId — a single job's live status. */
  async getJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { jobId } = req.params;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }
      const job = await this.service.getJob(userId, jobId);
      if (!job) {
        ResponseHelper.notFound(res, 'Essays job not found', CTX);
        return;
      }
      res.json({ success: true, job });
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to get essays job',
        CTX
      );
    }
  }

  /** POST /api/essays/jobs/:jobId/download-token — short-lived signed token. */
  async getDownloadToken(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { jobId } = req.params;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }
      const dl = await this.service.resolveDownload(userId, jobId);
      if (!dl) {
        ResponseHelper.notFound(res, 'Result not available for download', CTX);
        return;
      }
      const issued = issueDownloadToken(jobId, PROJECT_SENTINEL, userId);
      res.json({ token: issued.token, expiresAt: issued.expiresAt });
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to issue download token',
        CTX
      );
    }
  }

  /**
   * GET /api/essays/jobs/:jobId/download[?token=] — stream the result zip.
   * Accepts either a session cookie (JWT) or a signed ?token= (native browser
   * download, which cannot attach the cookie's Authorization equivalent).
   */
  async downloadJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const tokenParam = req.query.token;

      let userId: string | undefined;
      if (typeof tokenParam === 'string' && tokenParam.length > 0) {
        try {
          const payload = verifyDownloadToken(tokenParam);
          if (payload.jobId !== jobId || payload.projectId !== PROJECT_SENTINEL) {
            ResponseHelper.unauthorized(res, 'Invalid download token', CTX);
            return;
          }
          userId = payload.userId;
        } catch (e) {
          if (e instanceof InvalidDownloadTokenError) {
            ResponseHelper.unauthorized(res, 'Invalid download token', CTX);
            return;
          }
          throw e;
        }
      } else {
        userId = req.user?.id;
      }
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }

      const dl = await this.service.resolveDownload(userId, jobId);
      if (!dl) {
        ResponseHelper.notFound(res, 'Result not available for download', CTX);
        return;
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${path.basename(dl.downloadName)}"`
      );
      res.sendFile(dl.filePath, (sendErr) => {
        if (sendErr && !res.headersSent) {
          ResponseHelper.internalError(
            res,
            toErr(sendErr),
            'Failed to send result file',
            CTX
          );
        } else if (sendErr) {
          logger.warn(
            `essays download stream error for ${jobId}: ${String(sendErr)}`,
            CTX
          );
        }
      });
    } catch (error) {
      if (!res.headersSent) {
        ResponseHelper.internalError(
          res,
          toErr(error),
          'Failed to download result',
          CTX
        );
      }
    }
  }

  /** DELETE /api/essays/jobs/:jobId — remove a job and its artifacts. */
  async deleteJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { jobId } = req.params;
      if (!userId) {
        ResponseHelper.unauthorized(res, 'Unauthorized', CTX);
        return;
      }
      const ok = await this.service.deleteJob(userId, jobId);
      if (!ok) {
        ResponseHelper.notFound(res, 'Essays job not found', CTX);
        return;
      }
      res.json({ success: true });
    } catch (error) {
      ResponseHelper.internalError(
        res,
        toErr(error),
        'Failed to delete essays job',
        CTX
      );
    }
  }
}
