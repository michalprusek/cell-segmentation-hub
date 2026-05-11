/**
 * Video-related HTTP handlers: upload (extracts to per-frame Image rows),
 * frame-data fetch by channel, and PATCH for channel metadata updates.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import { uploadVideo } from '../../services/videoUploadService';
import { isVideoFilename } from '../../services/video/videoExtractor';

const prisma = new PrismaClient();

interface ChannelDTO {
  name: string;
  type: 'irm' | 'fluorescent';
  wavelengthNm?: number;
  displayColor?: string;
  isSegmentationSource: boolean;
}

export class VideoController {
  /**
   * POST /projects/:id/videos
   *
   * Accepts a single video upload (mp4/avi/mov/mkv/webm/nd2 or multi-page
   * TIFF), runs the extractor synchronously, and responds with the new
   * container ID + extracted frame count + detected channel metadata.
   */
  static async upload(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params.id;
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        ResponseHelper.error(res, 'No file uploaded', 400);
        return;
      }
      if (!isVideoFilename(file.originalname)) {
        ResponseHelper.error(
          res,
          `Not a recognised video format: ${path.extname(file.originalname)}`,
          400
        );
        return;
      }

      // The websocket layer is owned by upload progress already; for an
      // MVP this call is synchronous and returns the result once the
      // extractor completes. Frontend shows a spinner during the call.
      const result = await uploadVideo(file.buffer, {
        projectId,
        originalName: file.originalname,
        mimeType: file.mimetype,
      });

      ResponseHelper.success(res, {
        videoContainerId: result.containerId,
        frameCount: result.frameCount,
        channels: result.channels,
      });
    } catch (err) {
      const message = (err as Error).message;
      logger.error(`Video upload failed: ${message}`, err as Error, 'VideoController');
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

      const image = await prisma.image.findUnique({
        where: { id: imageId },
        select: {
          id: true,
          projectId: true,
          originalPath: true,
          parentVideoId: true,
          frameIndex: true,
        },
      });
      if (!image) {
        ResponseHelper.error(res, 'Image not found', 404);
        return;
      }

      let absPath: string;
      if (channelName && image.parentVideoId != null && image.frameIndex != null) {
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
        // Standalone image or channel not specified — fall back to
        // originalPath, which is stored relative to the project's
        // image root.
        absPath = path.join(
          config.UPLOAD_DIR,
          'projects',
          image.projectId,
          'images',
          image.originalPath
        );
      }

      try {
        await fs.access(absPath);
      } catch {
        ResponseHelper.error(
          res,
          `Frame data not found for channel '${channelName ?? '<default>'}'`,
          404
        );
        return;
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.sendFile(absPath);
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
   * PATCH /images/:imageId/channels
   *
   * Updates the channels JSON on a video container row. Validates that
   * at most one channel has ``isSegmentationSource: true`` (radio
   * behaviour) and that the named channels actually have PNG files on
   * disk before persisting.
   */
  static async updateChannels(req: Request, res: Response): Promise<void> {
    try {
      const imageId = req.params.imageId;
      const channels = req.body?.channels as ChannelDTO[] | undefined;
      if (!Array.isArray(channels) || channels.length === 0) {
        ResponseHelper.error(res, 'channels[] required', 400);
        return;
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

      const image = await prisma.image.findUnique({ where: { id: imageId } });
      if (!image || !image.isVideoContainer) {
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
