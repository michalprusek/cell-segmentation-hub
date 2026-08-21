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
import {
  resolveFrameRepresentation,
  ensureChannelProxies,
} from '../../services/playbackProxyService';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import { uploadVideoFromFile } from '../../services/videoUploadService';
import { addChannelToFrames } from '../../services/addChannelService';
import { isVideoFilename } from '../../services/video/videoExtractor';

interface ChannelDTO {
  name: string;
  displayName?: string;
  type: 'irm' | 'fluorescent';
  wavelengthNm?: number;
  displayColor?: string;
  isSegmentationSource: boolean;
}

const MAX_CHANNEL_DISPLAY_NAME_LEN = 128;

/** Reject control characters and zero-length-trim; cap at 128. The path-
 *  safe `name` stays the only filesystem-bound identifier — displayName
 *  is purely a UI label so the regex is much looser, but still
 *  rejects newlines / NUL / other terminal-mangling chars. */
function isValidDisplayName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_CHANNEL_DISPLAY_NAME_LEN) {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1f\x7f]/.test(value);
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

/** Common image row loader used by the video / frame controllers.
 *  Returns null on bad id / missing row after writing the response. */
async function loadImageById(req: Request, res: Response, imageId: string) {
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
  return image;
}

/** Resolve the container row for an arbitrary imageId, asserting that the
 *  caller has access to its parent project. Returns null on access denial
 *  (handler should then return). */
async function loadAuthorisedContainer(
  req: Request,
  res: Response,
  imageId: string
) {
  const image = await loadImageById(req, res, imageId);
  if (!image) return null;
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

      // Opt-in multimodal channel registration (translation-only). The FE only
      // offers the toggle for microtubule projects; re-check the project type
      // here (defence in depth) so the flag is honoured ONLY for MT projects —
      // a stray `registerChannels=true` on any other project type is ignored.
      const wantsRegister =
        req.body?.registerChannels === 'true' ||
        req.body?.registerChannels === '1' ||
        req.body?.registerChannels === true;
      let registerChannels = false;
      if (wantsRegister) {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { type: true },
        });
        registerChannels = (project?.type ?? '') === 'microtubules';
      }

      // uploadVideoFromFile owns the tmp file from here — it either
      // renames it into place (success) or removes it via cleanupOnFailure
      // (failure). Either way, no second cleanupTmp() in the success path.
      const result = await uploadVideoFromFile({
        projectId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        tempFilePath: file.path,
        registerChannels,
      });

      ResponseHelper.success(res, {
        videoContainerId: result.containerId,
        frameCount: result.frameCount,
        channels: result.channels,
        // >1 when a multi-position ND2 (well-plate / multipoint) fanned out
        // into several containers; each position is its own video.
        positionCount: result.positionCount,
        containerIds: result.containerIds,
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
   * POST /projects/:id/images/add-channel
   *
   * Adds an extra (PNG-backed) channel to SELECTED video frames of a
   * microtubule project by decoding an uploaded source (video/stack/ND2 or a
   * single image). Multipart field name: ``file``. Body: ``channelName``,
   * ``align`` ('true'|'false'), ``imageIds`` (JSON array of frame ids).
   *
   * Like ``upload``, multer drops the source to a tmp file before this
   * handler runs, so every bail-out cleans it up. The service takes ownership
   * of the tmp file on the success path (removes it in its own ``finally``).
   */
  static async addChannel(req: Request, res: Response): Promise<void> {
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

      const channelName =
        typeof req.body?.channelName === 'string'
          ? req.body.channelName.trim()
          : '';
      if (!isValidDisplayName(channelName)) {
        await cleanupTmp();
        ResponseHelper.error(
          res,
          `channelName is required (1..${MAX_CHANNEL_DISPLAY_NAME_LEN} chars, no control characters)`,
          400
        );
        return;
      }

      const align =
        req.body?.align === 'true' ||
        req.body?.align === '1' ||
        req.body?.align === true;

      // imageIds arrives as a JSON array string (or a repeated form field).
      let imageIds: string[] = [];
      const rawIds = req.body?.imageIds;
      if (Array.isArray(rawIds)) {
        imageIds = rawIds.map(String);
      } else if (typeof rawIds === 'string') {
        try {
          const parsed = JSON.parse(rawIds);
          if (Array.isArray(parsed)) imageIds = parsed.map(String);
        } catch {
          imageIds = rawIds
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        }
      }
      if (imageIds.length === 0) {
        await cleanupTmp();
        ResponseHelper.error(res, 'imageIds required', 400);
        return;
      }

      const result = await addChannelToFrames({
        projectId,
        originalName: file.originalname,
        tempFilePath: file.path,
        channelName,
        align,
        imageIds,
      });

      ResponseHelper.success(res, result);
    } catch (err) {
      // The service cleans the tmp file in its own finally once it has been
      // handed off; this covers throws BEFORE hand-off (auth / parse).
      await cleanupTmp();
      const message = (err as Error).message;
      logger.error(
        `Add channel failed: ${message}`,
        err as Error,
        'VideoController'
      );
      // Known user-input failures → 400; anything else → 500.
      const isClientError =
        /required|selected|mismatch|only|Invalid|Cannot align|must |cannot be added|microtubule|dimensions|no channels|pixel grid/i.test(
          message
        );
      ResponseHelper.error(res, message, isClientError ? 400 : 500);
    }
  }

  /**
   * GET /images/:imageId/frame-data?channel=<name>
   *
   * Streams the raw PNG for a specific channel of a video-frame image.
   * For standalone (non-video) images and missing channel queries we
   * fall back to ``originalPath``.
   *
   * **No authentication required** — same security model as
   * `/images/:imageId/display`: the image UUID is the capability token.
   * Browser `<img>` tags can't attach a JWT, and adding a signed-URL
   * scheme just for canvas rendering is more attack surface than the
   * UUID-as-capability model already in use across the gallery.
   */
  static async getFrameData(req: Request, res: Response): Promise<void> {
    try {
      const imageId = req.params.imageId;
      const channelParam = req.query.channel;
      const channelName =
        typeof channelParam === 'string' && channelParam.length > 0
          ? channelParam
          : null;
      // `repr=proxy` asks for the 8-bit WebP playback proxy. Anything else —
      // including no parameter at all — keeps the original 16-bit PNG, so every
      // caller that predates the proxy is untouched.
      const wantProxy = req.query.repr === 'proxy';

      // Reject anything that could escape the storage root. We do this
      // BEFORE the DB lookup so a malicious query never even touches the
      // database with arbitrary content.
      if (channelName !== null && !isSafeChannelName(channelName)) {
        ResponseHelper.error(res, 'Invalid channel name', 400);
        return;
      }

      const image = await loadImageById(req, res, imageId);
      if (!image) return;

      let absPath: string;
      let framesDir: string | null = null;
      let containerId: string | null = null;
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
        framesDir = path.join(
          config.UPLOAD_DIR,
          'projects',
          image.projectId,
          'images',
          image.parentVideoId,
          'frames'
        );
        containerId = image.parentVideoId;
        absPath = path.join(
          framesDir,
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

      // The PNG is known to exist; the proxy may or may not stand in for it.
      const representation = await resolveFrameRepresentation(
        resolved,
        wantProxy
      );

      // Asked for a proxy and got the original back: this channel has not been
      // converted yet. Serve the PNG now — correct, just bigger — and start the
      // batch so the next pass over these frames is the fast one. Never awaited:
      // a container takes minutes and a frame request must not wait for it.
      if (wantProxy && !representation.isProxy && framesDir && containerId) {
        ensureChannelProxies(containerId, channelName as string, framesDir);
      }

      res.setHeader('Content-Type', representation.contentType);
      // An hour is right for a frame that is what it will stay. It is WRONG for
      // a PNG standing in for a proxy that is still being built: the browser
      // would hold 2 MB at the proxy's URL and not revalidate, so every frame
      // touched during the first playthrough stays on the slow representation
      // for an hour after the fast one exists.
      const stillBuilding = wantProxy && !representation.isProxy;
      res.setHeader(
        'Cache-Control',
        stillBuilding ? 'no-cache' : 'private, max-age=3600'
      );
      if (representation.rangeMax !== null) {
        // The client multiplies the 8-bit samples back out by this, so it must
        // arrive WITH the frame rather than being looked up per container: a
        // proxy is mapped against its own frame's maximum, and neighbouring
        // frames of one channel legitimately differ.
        res.setHeader('X-Proxy-Range', String(representation.rangeMax));
      }
      res.sendFile(representation.path);
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
        // displayName is optional — but if supplied, must be a non-empty
        // string up to MAX_CHANNEL_DISPLAY_NAME_LEN chars without control
        // characters (avoids terminal injection / log mangling).
        if (c.displayName !== undefined && !isValidDisplayName(c.displayName)) {
          ResponseHelper.error(
            res,
            `channel.displayName must be 1..${MAX_CHANNEL_DISPLAY_NAME_LEN} chars without control characters`,
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
