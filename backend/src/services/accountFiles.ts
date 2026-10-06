import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { assertSafeStorageSegment } from '../utils/storagePath';

/**
 * The files that belong to one account or one project, for deleting them
 * with it.
 *
 * WHAT COUNTS AS THE USER'S is decided by the PROJECT, not by the folder a
 * file sits in. An upload is stored under `<uploaderId>/<projectId>/…`, and
 * a project can be shared: so
 *
 *  - an image somebody else uploaded into this user's project lives under
 *    THEIR folder and goes with this account, while
 *  - an image this user uploaded into somebody else's project lives under
 *    THIS user's folder and must stay - it is part of a project that still
 *    exists.
 *
 * Removing `<userId>/` wholesale would therefore destroy other people's
 * data, which is why nothing here does that. Still images are removed by the
 * paths their rows record; directories are removed only where every file in
 * them is, by construction, the account's own.
 */
export interface UserFiles {
  /** Storage keys of individual files, relative to UPLOAD_DIR. */
  fileKeys: string[];
  /** Directories, relative to UPLOAD_DIR, removed recursively. */
  dirKeys: string[];
}

interface ImagePaths {
  id: string;
  originalPath: string;
  thumbnailPath: string | null;
  segmentationThumbnailPath: string | null;
}

const IMAGE_PATHS = {
  id: true,
  originalPath: true,
  thumbnailPath: true,
  segmentationThumbnailPath: true,
} as const;

/** Every file an image row points at, plus its converted-PNG cache. */
function addImageKeys(fileKeys: Set<string>, images: ImagePaths[]): void {
  for (const image of images) {
    for (const key of [
      image.originalPath,
      image.thumbnailPath,
      image.segmentationThumbnailPath,
    ]) {
      if (key) {
        fileKeys.add(key);
      }
    }
    // The browser-compatible PNG cached for a TIFF/BMP original.
    fileKeys.add(path.posix.join('converted', `${image.id}.png`));
  }
}

/** The directories that hold nothing but one project's own files. */
function addProjectDirs(
  dirKeys: Set<string>,
  ownerId: string,
  projectId: string
): void {
  const safeProjectId = assertSafeStorageSegment(projectId, 'projectId');
  // Video containers, their frames and channels.
  dirKeys.add(path.posix.join('projects', safeProjectId));
  // What the OWNER uploaded into the project. (What others uploaded into it
  // sits under their folders and is covered by the per-image keys.)
  dirKeys.add(
    path.posix.join(assertSafeStorageSegment(ownerId, 'userId'), safeProjectId)
  );
}

/**
 * The files of ONE project, for deleting them with it.
 *
 * Deleting a project used to remove its rows and nothing else: the cascade
 * took the images and segmentations out of the database and left every still
 * image on disk, unreachable and uncounted, for good. Must be called BEFORE
 * the project row is deleted - the rows are the list.
 */
export async function collectProjectFiles(
  projectId: string,
  ownerId: string
): Promise<UserFiles> {
  const images = await prisma.image.findMany({
    where: { projectId },
    select: IMAGE_PATHS,
  });

  const fileKeys = new Set<string>();
  addImageKeys(fileKeys, images);
  const dirKeys = new Set<string>();
  addProjectDirs(dirKeys, ownerId, projectId);

  return { fileKeys: [...fileKeys], dirKeys: [...dirKeys] };
}

/** Must be called BEFORE the user row is deleted - the rows are the list. */
export async function collectUserFiles(userId: string): Promise<UserFiles> {
  const safeUserId = assertSafeStorageSegment(userId, 'userId');

  const [images, projects, essayJobs, apiJobs] = await Promise.all([
    prisma.image.findMany({
      where: { project: { userId } },
      select: IMAGE_PATHS,
    }),
    prisma.project.findMany({ where: { userId }, select: { id: true } }),
    prisma.essayJob.findMany({
      where: { userId },
      select: { resultZipKey: true },
    }),
    prisma.apiJob.findMany({ where: { userId }, select: { id: true } }),
  ]);

  const fileKeys = new Set<string>();
  addImageKeys(fileKeys, images);
  for (const job of essayJobs) {
    if (job.resultZipKey) {
      fileKeys.add(job.resultZipKey);
    }
  }

  const dirKeys = new Set<string>();
  for (const { id } of projects) {
    addProjectDirs(dirKeys, safeUserId, id);
  }
  dirKeys.add(path.posix.join('avatars', safeUserId));
  dirKeys.add(path.posix.join('essays', safeUserId));
  for (const { id } of apiJobs) {
    dirKeys.add(
      path.posix.join('api-jobs', assertSafeStorageSegment(id, 'apiJobId'))
    );
  }

  return { fileKeys: [...fileKeys], dirKeys: [...dirKeys] };
}

/**
 * Resolve a storage key and refuse anything that escapes UPLOAD_DIR.
 *
 * The keys come from database rows, and rows have been written by code paths
 * with different ideas of sanitising. This is the last check before `rm`.
 */
function resolveInsideUploads(root: string, key: string): string | null {
  if (typeof key !== 'string' || key.length === 0 || key.includes('\0')) {
    return null;
  }
  const resolved = path.resolve(root, key);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

export interface DeleteUserFilesResult {
  removed: number;
  failed: number;
  refused: number;
}

/**
 * Best-effort: never throws. A missing file is not a failure (`force`).
 */
export async function deleteUserFiles(
  files: UserFiles,
  uploadDir: string = config.UPLOAD_DIR
): Promise<DeleteUserFilesResult> {
  const root = path.resolve(uploadDir);
  const result: DeleteUserFilesResult = { removed: 0, failed: 0, refused: 0 };

  const remove = async (key: string, recursive: boolean): Promise<void> => {
    const target = resolveInsideUploads(root, key);
    if (!target) {
      result.refused += 1;
      logger.warn(
        'Refused to delete a path outside the upload directory',
        'AccountFiles',
        { key }
      );
      return;
    }
    try {
      await fs.rm(target, { recursive, force: true });
      result.removed += 1;
    } catch (error) {
      result.failed += 1;
      logger.error(
        'Could not delete an account file',
        error as Error,
        'AccountFiles',
        { key }
      );
    }
  };

  // Files first, then directories: a directory removal is the one that can
  // take a while, and the files outside those directories are the ones no
  // later sweep would ever find.
  for (const key of files.fileKeys) {
    await remove(key, false);
  }
  for (const key of files.dirKeys) {
    await remove(key, true);
  }

  // `<userId>/` itself is deliberately left: it may still hold uploads into
  // other people's projects.
  return result;
}
