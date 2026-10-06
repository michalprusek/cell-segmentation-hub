import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { assertSafeStorageSegment } from '../utils/storagePath';

/**
 * The files that belong to one account, for deleting them with it.
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

/** Must be called BEFORE the user row is deleted - the rows are the list. */
export async function collectUserFiles(userId: string): Promise<UserFiles> {
  const safeUserId = assertSafeStorageSegment(userId, 'userId');

  const [images, essayJobs, apiJobs] = await Promise.all([
    prisma.image.findMany({
      where: { project: { userId } },
      select: {
        id: true,
        projectId: true,
        originalPath: true,
        thumbnailPath: true,
        segmentationThumbnailPath: true,
      },
    }),
    prisma.essayJob.findMany({
      where: { userId },
      select: { resultZipKey: true },
    }),
    prisma.apiJob.findMany({ where: { userId }, select: { id: true } }),
  ]);
  const projects = await prisma.project.findMany({
    where: { userId },
    select: { id: true },
  });

  const fileKeys = new Set<string>();
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
  for (const job of essayJobs) {
    if (job.resultZipKey) {
      fileKeys.add(job.resultZipKey);
    }
  }

  const dirKeys = new Set<string>();
  for (const { id } of projects) {
    const projectId = assertSafeStorageSegment(id, 'projectId');
    // Video containers, their frames and channels.
    dirKeys.add(path.posix.join('projects', projectId));
    // What the owner uploaded into their own project. (What OTHERS uploaded
    // into it is covered by the per-image keys above.)
    dirKeys.add(path.posix.join(safeUserId, projectId));
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
