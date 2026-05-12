/**
 * Video-related HTTP handlers: upload (extracts to per-frame Image rows),
 * frame-data fetch by channel, and PATCH for channel metadata updates.
 *
 * Security rules baked into every handler:
 *
 *  - **Authz**: every read/write goes through ``assertProjectAccess`` which
 *    mirrors the imageService rule (project owner OR accepted-share). No
 *    image lookup by raw imageId without verifying the caller has access
 *    to the project that owns it.
 *  - **Channel name whitelist**: ``channel`` query/body strings are
 *    validated against ``container.channels[].name`` (or the legacy
 *    bareword set extractors emit) before any path join — prevents
 *    ``?channel=../../../etc/...`` traversal.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Request, Response } from 'express';
import { prisma } from '../../db/prismaClient';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import { uploadVideoFromFile } from '../../services/videoUploadService';
import { isVideoFilename } from '../../services/video/videoExtractor';

interface ChannelDTO {
  name: string;
  type: 'irm' | 'fluorescent';
  wavelengthNm?: number;
  displayColor?: string;
  isSegmentationSource: boolean;
}

/** Allowed shape for channel names anywhere in the API surface. Filesystem-
 *  safe alnum + underscore + dash; bans dots so ``.png`` extension can't
 *  smuggle in, bans slashes so traversal is impossible. */
const CHANNEL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isSafeChannelName(name: unknown): name is string {
  return typeof name === 'string' && CHANNEL_NAME_RE.test(name);
}

/** Assert the caller has access to ``projectId`` (owner or accepted share).
 *  Resolves to ``null`` on access denial after writing the response. */
async function assertProjectAccess(
  req: Request,
  res: Response,
  projectId: string
): Promise<string | null> {
  const userId = req.user?.id;
  if (!userId) {
    ResponseHelper.error(res, 'Unauthorized', 401);
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) {
    ResponseHelper.error(res, 'Unauthorized', 401);
    return null;
  }
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { userId },
        {
          shares: {
            some: {
              status: 'accepted',
              OR: [{ sharedWithId: userId }, { email: user.email }],
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (!project) {
    ResponseHelper.error(res, 'Access denied to this project', 403);
    return null;
  }
  return userId;
}

/** Resolve the container row for an arbitrary imageId, asserting that the
 *  caller has access to its parent project. Returns null on access denial
 *  (handler should then return). */
async function loadAuthorisedContainer(
  req: Request,
  res: Response,
  imageId: string
) {
  if (typeof imageId !== 'string' || imageId.length === 0) {
    ResponseHelper.error(res, 'imageId required', 400);
    return null;
  }
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      projectId: true,
      originalPath: true,
      isVideoContainer: true,
      parentVideoId: true,
      frameIndex: true,
      channels: true,
      name: true,
      width: true,
      height: true,
      frameCount: true,
      videoDurationMs: true,
    },
  });
  if (!image) {
    ResponseHelper.error(res, 'Image not found', 404);
    return null;
  }
  const userId = await assertProjectAccess(req, res, image.projectId);
  if (!userId) return null;
  return image;
}

export class VideoController {
  /**
   * POST /projects/:id/videos
   *
   * Accepts a single video upload (mp4/avi/mov/mkv/webm/nd2 or multi-page
   * TIFF). The uploaded file is streamed to a tmp path by multer
   * (diskStorage) so the backend container never buffers a 100 GB ND2
   * into RAM. The extractor service then renames the tmp file into the
   * canonical project storage layout before extracting frames.
   */
  static async upload(req: Request, res: Response): Promise<void> {
    // Multer dropped the file to disk before this handler even ran, so
    // ANY early return (auth, validation, project not found) leaves a
    // potentially 100 GB tmp file behind. Round-2 review flagged this as
    // a disk-pressure DoS surface — every bail-out path now goes through
    // a single cleanup point.
    const file = req.file as Express.Multer.File | undefined;
    const cleanupTmp = async () => {
      if (file?.path) {
        await fs.rm(file.path, { force: true }).catch(() => undefined);
      }
    };

    try {
      const projectId = req.params.id;
      const userId = await assertProjectAccess(req, res, projectId);
      if (!userId) {
        await cleanupTmp();
        return;
      }
      if (!file) {
        ResponseHelper.error(res, 'No file uploaded', 400);
        return;
      }
      if (!isVideoFilename(file.originalname)) {
        await cleanupTmp();
        ResponseHelper.error(
          res,
          `Not a recognised video format: ${path.extname(file.originalname)}`,
          400
        );
        return;
      }

      // uploadVideoFromFile owns the tmp file from here — it either
      // renames it into place (success) or removes it via cleanupOnFailure
      // (failure). Either way, no second cleanupTmp() in the success path.
      const result = await uploadVideoFromFile({
        projectId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        tempFilePath: file.path,
      });

      ResponseHelper.success(res, {
        videoContainerId: result.containerId,
        frameCount: result.frameCount,
        channels: result.channels,
      });
    } catch (err) {
      // The service's own catch already cleaned the tmp file on
      // extraction failure; but if we threw before reaching the service
      // (e.g. uncaught from assertProjectAccess), the file is still
      // there. Best-effort cleanup is cheap.
      await cleanupTmp();
      const message = (err as Error).message;
      logger.error(
        `Video upload failed: ${message}`,
        err as Error,
        'VideoController'
      );
      ResponseHelper.error(res, message, 500);
    }
  }

  /**
   * GET /images/:imageId/frame-data?channel=<name>
   *
   * Streams the raw PNG for a specific channel of a video-frame image.
   * For standalone (non-video) images and missing channel queries we
   * fall back to ``originalPath``.
   */
  static async getFrameData(req: Request, res: Response): Promise<void> {
    try {
      const imageId = req.params.imageId;
      const channelParam = req.query.channel;
      const channelName =
        typeof channelParam === 'string' && channelParam.length > 0
          ? channelParam
          : null;

      // Reject anything that could escape the storage root. We do this
      // BEFORE the DB lookup so a malicious query never even touches the
      // database with arbitrary content.
      if (channelName !== null && !isSafeChannelName(channelName)) {
        ResponseHelper.error(res, 'Invalid channel name', 400);
        return;
      }

      const image = await loadAuthorisedContainer(req, res, imageId);
      if (!image) return;

      let absPath: string;
      if (
        channelName &&
        image.parentVideoId != null &&
        image.frameIndex != null
      ) {
        // Whitelist channelName against the container's declared channels
        // so even alnum-only-but-undeclared names can't hit the FS.
        const container = await prisma.image.findUnique({
          where: { id: image.parentVideoId },
          select: { channels: true },
        });
        const allowed = Array.isArray(container?.channels)
          ? (container!.channels as unknown as ChannelDTO[]).map(c => c.name)
          : [];
        if (allowed.length > 0 && !allowed.includes(channelName)) {
          ResponseHelper.error(res, `Unknown channel: ${channelName}`, 400);
          return;
        }
        absPath = path.join(
          config.UPLOAD_DIR,
          'projects',
          image.projectId,
          'images',
          image.parentVideoId,
          'frames',
          String(image.frameIndex).padStart(4, '0'),
          `${channelName}.png`
        );
      } else {
        // ``originalPath`` is the full storage key relative to UPLOAD_DIR
        // (e.g. ``projects/<pid>/images/<cid>/original.nd2`` for a video
        // container, or ``<userId>/<projectId>/originals/...`` for a
        // standalone upload). Joining directly preserves both shapes.
        absPath = path.join(config.UPLOAD_DIR, image.originalPath);
      }

      // Defence in depth: ensure the resolved path is still under the
      // configured upload root. Even with the regex+whitelist above,
      // a misconfigured ``originalPath`` cannot escape.
      const uploadRoot = path.resolve(config.UPLOAD_DIR);
      const resolved = path.resolve(absPath);
      if (!resolved.startsWith(uploadRoot + path.sep)) {
        logger.error(
          'Frame data path resolved outside upload root',
          new Error('path traversal'),
          'VideoController',
          { resolved, uploadRoot, imageId, channelName }
        );
        ResponseHelper.error(res, 'Invalid path', 400);
        return;
      }

      try {
        await fs.access(resolved);
      } catch {
        logger.error(
          `Frame PNG missing on disk for image ${imageId}`,
          new Error('ENOENT'),
          'VideoController',
          { resolved, channelName, parentVideoId: image.parentVideoId }
        );
        ResponseHelper.error(
          res,
          `Frame data not found for channel '${channelName ?? '<default>'}'`,
          404
        );
        return;
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.sendFile(resolved);
    } catch (err) {
      logger.error(
        `Frame data fetch failed: ${(err as Error).message}`,
        err as Error,
        'VideoController'
      );
      ResponseHelper.error(res, 'Frame data fetch failed', 500);
    }
  }

  /**
   * GET /images/:imageId/video-frames
   *
   * Returns the container row's metadata + the ordered list of child
   * frame Image IDs. Drives the editor's frame slider.
   */
  static async getVideoFrames(req: Request, res: Response): Promise<void> {
    try {
      const imageId = req.params.imageId;
      const container = await loadAuthorisedContainer(req, res, imageId);
      if (!container) return;
      if (!container.isVideoContainer) {
        ResponseHelper.error(res, 'Not a video container', 404);
        return;
      }
      const frames = await prisma.image.findMany({
        where: { parentVideoId: imageId },
        orderBy: { frameIndex: 'asc' },
        select: { id: true, frameIndex: true, segmentationStatus: true },
      });
      ResponseHelper.success(res, { ...container, frames });
    } catch (err) {
      logger.error(
        `Frame list fetch failed: ${(err as Error).message}`,
        err as Error,
        'VideoController'
      );
      ResponseHelper.error(res, 'Frame list fetch failed', 500);
    }
  }

  /**
   * PATCH /images/:imageId/channels
   *
   * Updates the channels JSON on a video container row. Validates that
   * exactly-one (or zero) channels carry ``isSegmentationSource: true``.
   */
  static async updateChannels(req: Request, res: Response): Promise<void> {
    try {
      const imageId = req.params.imageId;
      const channels = req.body?.channels as ChannelDTO[] | undefined;
      if (!Array.isArray(channels) || channels.length === 0) {
        ResponseHelper.error(res, 'channels[] required', 400);
        return;
      }
      // Validate channel name shape — same whitelist used at read time.
      for (const c of channels) {
        if (!isSafeChannelName(c?.name)) {
          ResponseHelper.error(
            res,
            'Each channel.name must be alnum/underscore/dash, ≤64 chars',
            400
          );
          return;
        }
        if (c.type !== 'irm' && c.type !== 'fluorescent') {
          ResponseHelper.error(
            res,
            "channel.type must be 'irm' or 'fluorescent'",
            400
          );
          return;
        }
      }
      const sourceCount = channels.filter(c => c.isSegmentationSource).length;
      if (sourceCount > 1) {
        ResponseHelper.error(
          res,
          'At most one channel may be marked as the segmentation source',
          400
        );
        return;
      }

      const image = await loadAuthorisedContainer(req, res, imageId);
      if (!image) return;
      if (!image.isVideoContainer) {
        ResponseHelper.error(res, 'Not a video container', 400);
        return;
      }

      await prisma.image.update({
        where: { id: imageId },
        data: { channels: channels as unknown as object },
      });

      ResponseHelper.success(res, { imageId, channels });
    } catch (err) {
      logger.error(
        `Channel update failed: ${(err as Error).message}`,
        err as Error,
        'VideoController'
      );
      ResponseHelper.error(res, 'Channel update failed', 500);
    }
  }
}
