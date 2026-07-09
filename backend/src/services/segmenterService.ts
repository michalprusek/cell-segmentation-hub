/**
 * Segmenter (few-shot, active-learning polygon tool) — P0 service.
 *
 * A standalone module: a user creates a `SegmenterDataset`, uploads images
 * into it, defines an arbitrary per-dataset `SegmenterClass` palette, and
 * annotates each image with polygons carrying a single `classId` (+ optional
 * `instanceId`). Deliberately NOT a spheroseg `Project` — no polylines, no
 * video/channel machinery, no ML yet (P1+).
 *
 * Ownership model: every dataset is owned by exactly one user (no sharing in
 * P0). Images/classes/annotations are scoped to their dataset, so ownership
 * is always checked by joining up to `SegmenterDataset.userId`. Consistent
 * with the rest of the app (see `projectController.ensureProjectAccess`),
 * "not found" and "not yours" are indistinguishable to the caller — both
 * produce `SegmenterError('NOT_FOUND', ...)`, translated to HTTP 404 by the
 * controller. This avoids leaking existence of another user's dataset.
 *
 * Annotation storage mirrors `Segmentation.polygons`: a JSON STRING column
 * (`SegmenterAnnotation.polygons`), parsed/stringified at the service
 * boundary, not a native Prisma Json column — matches the existing
 * `mtTypeLabelService`/`segmentationService` convention.
 *
 * See docs/superpowers/specs/2026-07-09-segmenter-fewshot-al-design.md §7/§9
 * and docs/superpowers/plans/2026-07-09-segmenter-p0.md Tasks 2-3.
 */
import { randomUUID } from 'crypto';
import { Prisma, SegmenterClass, SegmenterDataset } from '@prisma/client';
import { prisma } from '../db';
import { getStorageProvider } from '../storage/index';
import { assertSafeStorageSegment } from '../utils/storagePath';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SegmenterError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_INPUT',
    message: string
  ) {
    super(message);
    this.name = 'SegmenterError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SegmenterPolygonPoint {
  x: number;
  y: number;
}

/** Wire shape of one annotation polygon — mirrors `Segmentation.polygons`
 *  entries, with `classId` as the SSOT class reference (no `partClass`/
 *  `mtType`). Polygons may freely overlap, including same-class — no
 *  dedupe, no z-order constraint. Closed shapes only (P0 is polygons-only). */
export interface SegmenterAnnotationPolygon {
  id: string;
  points: SegmenterPolygonPoint[];
  classId?: string;
  instanceId?: string;
}

export interface SegmenterImageUploadInput {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface SegmenterDatasetWithCount extends SegmenterDataset {
  imageCount: number;
}

export interface SegmenterDatasetDetail extends SegmenterDataset {
  images: {
    id: string;
    datasetId: string;
    name: string;
    storagePath: string;
    thumbnailPath: string | null;
    width: number | null;
    height: number | null;
    createdAt: Date;
    hasAnnotation: boolean;
  }[];
  classes: SegmenterClass[];
}

export interface SegmenterAnnotationDTO {
  polygons: SegmenterAnnotationPolygon[];
  imageWidth: number;
  imageHeight: number;
}

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

/** Load a dataset the user owns, or throw NOT_FOUND. */
async function requireOwnedDataset(
  userId: string,
  datasetId: string
): Promise<SegmenterDataset> {
  const dataset = await prisma.segmenterDataset.findFirst({
    where: { id: datasetId, userId },
  });
  if (!dataset) {
    throw new SegmenterError('NOT_FOUND', 'Dataset nebyl nalezen');
  }
  return dataset;
}

/** Load an image (+ its dataset id) the user owns via the dataset join, or
 *  throw NOT_FOUND. Images have no direct `userId` column — ownership is
 *  always transitive through the parent dataset. */
async function requireOwnedImage(
  userId: string,
  imageId: string
): Promise<{ id: string; datasetId: string; storagePath: string }> {
  const image = await prisma.segmenterImage.findFirst({
    where: { id: imageId, dataset: { userId } },
    select: { id: true, datasetId: true, storagePath: true },
  });
  if (!image) {
    throw new SegmenterError('NOT_FOUND', 'Obrázek nebyl nalezen');
  }
  return image;
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export async function createDataset(
  userId: string,
  name: string
): Promise<SegmenterDataset> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new SegmenterError('INVALID_INPUT', 'Název datasetu je povinný');
  }
  const dataset = await prisma.segmenterDataset.create({
    data: { userId, name: trimmed },
  });
  logger.info('Segmenter dataset created', 'SegmenterService', {
    userId,
    datasetId: dataset.id,
  });
  return dataset;
}

export async function listDatasets(
  userId: string
): Promise<SegmenterDatasetWithCount[]> {
  const datasets = await prisma.segmenterDataset.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { images: true } } },
  });
  return datasets.map(({ _count, ...rest }) => ({
    ...rest,
    imageCount: _count.images,
  }));
}

export async function getDataset(
  userId: string,
  datasetId: string
): Promise<SegmenterDatasetDetail> {
  const dataset = await requireOwnedDataset(userId, datasetId);
  const [images, classes] = await Promise.all([
    prisma.segmenterImage.findMany({
      where: { datasetId },
      orderBy: { createdAt: 'asc' },
      include: { annotation: { select: { imageId: true } } },
    }),
    prisma.segmenterClass.findMany({
      where: { datasetId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return {
    ...dataset,
    classes,
    images: images.map(({ annotation, ...img }) => ({
      ...img,
      hasAnnotation: annotation !== null,
    })),
  };
}

/** Delete a dataset and everything under it. DB rows cascade (dataset →
 *  images → annotation, dataset → classes) via the schema's `onDelete:
 *  Cascade`; storage files are best-effort cleaned up afterwards — a stray
 *  orphaned file on disk is a much smaller problem than blocking the delete
 *  on a filesystem hiccup (same trade-off as `imageService.deleteImage`). */
export async function deleteDataset(
  userId: string,
  datasetId: string
): Promise<void> {
  await requireOwnedDataset(userId, datasetId);

  const images = await prisma.segmenterImage.findMany({
    where: { datasetId },
    select: { storagePath: true },
  });

  await prisma.segmenterDataset.delete({ where: { id: datasetId } });

  const storage = getStorageProvider();
  await Promise.all(
    images.map(async img => {
      try {
        await storage.delete(img.storagePath);
      } catch (error) {
        logger.warn(
          'Failed to delete segmenter image file during dataset cleanup',
          'SegmenterService',
          {
            datasetId,
            storagePath: img.storagePath,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    })
  );

  logger.info('Segmenter dataset deleted', 'SegmenterService', {
    userId,
    datasetId,
    imagesRemoved: images.length,
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * Upload one or more images into a dataset. Storage layout:
 * `projects/segmenter/<datasetId>/images/<imageId>/original<ext>`. The image
 * id is minted up front (rather than letting Prisma default it) so the
 * storage key can embed it before the DB row exists. Each path segment is
 * passed through `assertSafeStorageSegment`; the original filename is never
 * used as a path component (only its extension is), so a crafted filename
 * cannot smuggle a traversal sequence into the storage key.
 *
 * Mirrors `ImageService.uploadImages`: failures are tolerated per-file (a
 * bad file doesn't sink the whole batch); the call only throws if EVERY file
 * failed.
 */
export async function uploadImages(
  userId: string,
  datasetId: string,
  files: SegmenterImageUploadInput[]
): Promise<SegmenterDatasetDetail['images'][number][]> {
  await requireOwnedDataset(userId, datasetId);
  const storage = getStorageProvider();
  const uploaded: SegmenterDatasetDetail['images'][number][] = [];

  for (const file of files) {
    try {
      const imageId = randomUUID();
      const ext = extractSafeExtension(file.originalname);
      const key = [
        'projects',
        'segmenter',
        assertSafeStorageSegment(datasetId, 'datasetId'),
        'images',
        assertSafeStorageSegment(imageId, 'imageId'),
        assertSafeStorageSegment(`original${ext}`, 'filename'),
      ].join('/');

      // Thumbnail generation is deferred to a later pass — LocalStorageProvider's
      // thumbnail-key derivation assumes the `userId/projectId/originals/…`
      // layout used elsewhere in the app; this module's storage layout differs
      // on purpose (dataset/image scoped), so requesting a thumbnail here would
      // silently write it to a nonsensical path. `thumbnailPath` stays null.
      const result = await storage.upload(file.buffer, key, {
        mimeType: file.mimetype,
        originalName: file.originalname,
      });

      const image = await prisma.segmenterImage.create({
        data: {
          id: imageId,
          datasetId,
          name: file.originalname,
          storagePath: result.originalPath,
          thumbnailPath: null,
          width: result.width ?? null,
          height: result.height ?? null,
        },
      });

      uploaded.push({ ...image, hasAnnotation: false });
    } catch (error) {
      logger.error(
        'Failed to upload segmenter image',
        error instanceof Error ? error : undefined,
        'SegmenterService',
        { datasetId, filename: file.originalname }
      );
    }
  }

  if (uploaded.length === 0 && files.length > 0) {
    throw new SegmenterError(
      'INVALID_INPUT',
      'Žádný soubor se nepodařilo nahrát. Zkontrolujte formát a velikost souborů.'
    );
  }

  logger.info('Segmenter images uploaded', 'SegmenterService', {
    userId,
    datasetId,
    uploadedCount: uploaded.length,
    failedCount: files.length - uploaded.length,
  });

  return uploaded;
}

/** Extract a filesystem-safe extension (including the leading dot) from an
 *  untrusted original filename. `path.extname` only ever returns the
 *  substring after the last dot of the LAST path segment, so even a crafted
 *  name like `../../evil.png` yields the harmless `.png` — the rest of the
 *  original name is never used to build a path. Falls back to `.bin` for
 *  extension-less uploads. */
function extractSafeExtension(originalname: string): string {
  const base = originalname.replace(/^.*[/\\]/, '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    return '.bin';
  }
  const ext = base
    .slice(dot)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  return ext || '.bin';
}

export async function deleteImage(
  userId: string,
  imageId: string
): Promise<void> {
  const image = await requireOwnedImage(userId, imageId);

  await prisma.segmenterImage.delete({ where: { id: image.id } });

  const storage = getStorageProvider();
  try {
    await storage.delete(image.storagePath);
  } catch (error) {
    logger.warn('Failed to delete segmenter image file', 'SegmenterService', {
      imageId,
      storagePath: image.storagePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Segmenter image deleted', 'SegmenterService', {
    userId,
    imageId,
    datasetId: image.datasetId,
  });
}

/** Infer a browser Content-Type from a filename/key extension. P0 accepts
 *  static images; PNG/JPEG are the common case. Unknown → octet-stream. */
function inferImageMimeType(nameOrPath: string): string {
  const ext = nameOrPath.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

/** Read raw image bytes for canvas display, owner-scoped via the dataset join.
 *  Returns the buffer + inferred MIME type + a download filename. */
export async function getImageFile(
  userId: string,
  imageId: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const image = await prisma.segmenterImage.findFirst({
    where: { id: imageId, dataset: { userId } },
    select: { storagePath: true, name: true },
  });
  if (!image) {
    throw new SegmenterError('NOT_FOUND', 'Obrázek nebyl nalezen');
  }

  const storage = getStorageProvider();
  const buffer = await storage.getBuffer(image.storagePath);
  return {
    buffer,
    mimeType: inferImageMimeType(image.name || image.storagePath),
    filename: image.name || 'image',
  };
}

// ---------------------------------------------------------------------------
// Class registry (pattern: mtTypeLabelService, but a real relational table
// rather than a JSON blob column — every mutation still returns the FULL
// current list so the frontend never has to reconcile a partial response).
// ---------------------------------------------------------------------------

export async function listClasses(
  userId: string,
  datasetId: string
): Promise<SegmenterClass[]> {
  await requireOwnedDataset(userId, datasetId);
  return prisma.segmenterClass.findMany({
    where: { datasetId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createClass(
  userId: string,
  datasetId: string,
  data: { name: string; color: string }
): Promise<SegmenterClass[]> {
  await requireOwnedDataset(userId, datasetId);
  await prisma.segmenterClass.create({
    data: {
      datasetId,
      name: data.name.trim(),
      color: data.color.trim(),
    },
  });
  return listClasses(userId, datasetId);
}

export async function updateClass(
  userId: string,
  datasetId: string,
  classId: string,
  patch: { name?: string; color?: string }
): Promise<SegmenterClass[]> {
  await requireOwnedDataset(userId, datasetId);
  const existing = await prisma.segmenterClass.findFirst({
    where: { id: classId, datasetId },
  });
  if (!existing) {
    throw new SegmenterError('NOT_FOUND', 'Třída nebyla nalezena');
  }
  await prisma.segmenterClass.update({
    where: { id: classId },
    data: {
      ...(patch.name !== undefined && { name: patch.name.trim() }),
      ...(patch.color !== undefined && { color: patch.color.trim() }),
    },
  });
  return listClasses(userId, datasetId);
}

/** Delete one class and null every `classId` reference to it across the
 *  dataset's annotations (same pattern as `mtTypeLabelService.deleteLabel`
 *  nulling `mtType`), so a deleted class never leaves dangling polygon
 *  references. Returns the surviving class list + how many annotations were
 *  cleaned. */
export async function deleteClass(
  userId: string,
  datasetId: string,
  classId: string
): Promise<{ classes: SegmenterClass[]; imagesCleaned: number }> {
  await requireOwnedDataset(userId, datasetId);
  const existing = await prisma.segmenterClass.findFirst({
    where: { id: classId, datasetId },
  });
  if (!existing) {
    throw new SegmenterError('NOT_FOUND', 'Třída nebyla nalezena');
  }

  await prisma.segmenterClass.delete({ where: { id: classId } });
  const imagesCleaned = await clearClassReferences(datasetId, [classId]);
  const classes = await listClasses(userId, datasetId);

  logger.info('Segmenter class deleted', 'SegmenterService', {
    userId,
    datasetId,
    classId,
    imagesCleaned,
  });

  return { classes, imagesCleaned };
}

/** Null `classId` on every polygon whose `classId` is in `classIds`, across
 *  every annotation in the dataset. Runs as one transaction so a delete is
 *  all-or-nothing. Returns how many annotations were rewritten. */
async function clearClassReferences(
  datasetId: string,
  classIds: string[]
): Promise<number> {
  const idSet = new Set(classIds.filter(Boolean));
  if (idSet.size === 0) {
    return 0;
  }

  const annotations = await prisma.segmenterAnnotation.findMany({
    where: { image: { datasetId } },
    select: { id: true, polygons: true },
  });

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  let cleaned = 0;
  for (const annotation of annotations) {
    const parsed = parseAnnotationJson(annotation.polygons, annotation.id);
    let changed = false;
    const next = parsed.map(p => {
      if (typeof p.classId === 'string' && idSet.has(p.classId)) {
        changed = true;
        const { classId: _drop, ...rest } = p;
        return rest;
      }
      return p;
    });
    if (changed) {
      cleaned++;
      ops.push(
        prisma.segmenterAnnotation.update({
          where: { id: annotation.id },
          data: { polygons: JSON.stringify(next) },
        })
      );
    }
  }
  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/** Lenient parse of an annotation's polygons JSON. Never throws — a
 *  corrupted row is treated as empty so one bad annotation can't take down a
 *  batch cleanup or a read. */
function parseAnnotationJson(
  json: string | null | undefined,
  annotationId?: string
): SegmenterAnnotationPolygon[] {
  if (!json) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? (parsed as SegmenterAnnotationPolygon[])
      : [];
  } catch (error) {
    logger.warn(
      'Segmenter annotation: unreadable polygons JSON; treated as empty',
      'SegmenterService',
      {
        annotationId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return [];
  }
}

/**
 * Coerce untrusted polygon input into a clean `SegmenterAnnotationPolygon[]`.
 * Entries missing a valid `points` array (>= 3 points — P0 is closed
 * polygons only) are dropped; every other entry is kept, including polygons
 * that fully overlap an existing one (same class or not) — overlap is a
 * first-class requirement (spec §2/§7), so this function never dedupes or
 * rejects on spatial overlap. Missing/invalid `id` is replaced with a fresh
 * uuid so every stored polygon has a stable identity.
 */
export function sanitizeAnnotationPolygons(
  raw: unknown
): SegmenterAnnotationPolygon[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SegmenterAnnotationPolygon[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const rec = entry as Record<string, unknown>;

    if (!Array.isArray(rec.points) || rec.points.length < 3) {
      continue;
    }
    const points: SegmenterPolygonPoint[] = [];
    for (const pt of rec.points) {
      if (
        pt &&
        typeof pt === 'object' &&
        typeof (pt as Record<string, unknown>).x === 'number' &&
        typeof (pt as Record<string, unknown>).y === 'number' &&
        Number.isFinite((pt as Record<string, unknown>).x as number) &&
        Number.isFinite((pt as Record<string, unknown>).y as number)
      ) {
        const p = pt as { x: number; y: number };
        points.push({ x: p.x, y: p.y });
      }
    }
    if (points.length < 3) {
      continue;
    }

    const polygon: SegmenterAnnotationPolygon = {
      id:
        typeof rec.id === 'string' && rec.id.length > 0 ? rec.id : randomUUID(),
      points,
    };
    if (typeof rec.classId === 'string' && rec.classId.length > 0) {
      polygon.classId = rec.classId;
    }
    if (typeof rec.instanceId === 'string' && rec.instanceId.length > 0) {
      polygon.instanceId = rec.instanceId;
    }
    out.push(polygon);
  }
  return out;
}

export async function getAnnotation(
  userId: string,
  imageId: string
): Promise<SegmenterAnnotationDTO> {
  const image = await prisma.segmenterImage.findFirst({
    where: { id: imageId, dataset: { userId } },
    select: {
      id: true,
      width: true,
      height: true,
      annotation: {
        select: { polygons: true, imageWidth: true, imageHeight: true },
      },
    },
  });
  if (!image) {
    throw new SegmenterError('NOT_FOUND', 'Obrázek nebyl nalezen');
  }
  if (!image.annotation) {
    return {
      polygons: [],
      imageWidth: image.width ?? 0,
      imageHeight: image.height ?? 0,
    };
  }
  return {
    polygons: parseAnnotationJson(image.annotation.polygons, imageId),
    imageWidth: image.annotation.imageWidth,
    imageHeight: image.annotation.imageHeight,
  };
}

/** Upsert-on-imageId: creates the annotation row on first save, replaces it
 *  wholesale afterwards (the editor always sends the complete polygon set
 *  for the image, same contract as `Segmentation.polygons`). */
export async function upsertAnnotation(
  userId: string,
  imageId: string,
  data: { polygons: unknown; imageWidth: number; imageHeight: number }
): Promise<SegmenterAnnotationDTO> {
  await requireOwnedImage(userId, imageId);

  const polygons = sanitizeAnnotationPolygons(data.polygons);
  const polygonsJson = JSON.stringify(polygons);

  await prisma.segmenterAnnotation.upsert({
    where: { imageId },
    create: {
      imageId,
      polygons: polygonsJson,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
    },
    update: {
      polygons: polygonsJson,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
    },
  });

  logger.info('Segmenter annotation saved', 'SegmenterService', {
    userId,
    imageId,
    polygonCount: polygons.length,
  });

  return {
    polygons,
    imageWidth: data.imageWidth,
    imageHeight: data.imageHeight,
  };
}
