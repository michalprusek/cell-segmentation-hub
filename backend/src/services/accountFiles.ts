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

// ---------------------------------------------------------------------------
// Durable clean-up
// ---------------------------------------------------------------------------

/**
 * Whose rows a pending clean-up is waiting on. The manifest is acted on only
 * once that row is GONE - see `sweepPendingCleanups`.
 */
export interface CleanupOwner {
  kind: 'project' | 'user';
  id: string;
}

interface CleanupManifest {
  owner: CleanupOwner;
  createdAt: string;
  files: UserFiles;
}

const PENDING_DIR = '.pending-cleanup';
/**
 * A manifest whose owner row still exists after this long was written by a
 * deletion that never happened (the process died between the two steps, or
 * the row delete failed and the discard did too). It is thrown away.
 */
const ABANDONED_AFTER_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const pendingDir = (uploadDir: string): string =>
  path.join(path.resolve(uploadDir), PENDING_DIR);

/**
 * Write down what is about to be deleted, BEFORE the rows go.
 *
 * The rows are the only record of which files belong to a project, and
 * removing a 200-frame video's directory takes long enough for a deploy to
 * land in the middle of it. Without this, a restart between "rows deleted"
 * and "files removed" - or a file that could not be removed - leaves bytes on
 * disk that nothing will ever point at again.
 *
 * @returns the manifest path, or null when it could not be written. That is
 * NOT a reason to refuse the deletion - a full disk is exactly when someone
 * needs to delete a project - so the caller carries on, best-effort.
 */
export async function recordPendingCleanup(
  owner: CleanupOwner,
  files: UserFiles,
  uploadDir: string = config.UPLOAD_DIR
): Promise<string | null> {
  try {
    const dir = pendingDir(uploadDir);
    await fs.mkdir(dir, { recursive: true });
    const manifest: CleanupManifest = {
      owner: { kind: owner.kind, id: assertSafeStorageSegment(owner.id, 'id') },
      createdAt: new Date().toISOString(),
      files,
    };
    const target = path.join(dir, `${owner.kind}-${manifest.owner.id}.json`);
    await fs.writeFile(target, JSON.stringify(manifest), 'utf8');
    return target;
  } catch (error) {
    logger.error(
      'Could not record a pending file clean-up; continuing without one',
      error as Error,
      'AccountFiles',
      { owner }
    );
    return null;
  }
}

/** The row delete failed: nothing is to be removed after all. */
export async function discardPendingCleanup(
  manifestPath: string | null
): Promise<void> {
  if (manifestPath) {
    await fs.rm(manifestPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Remove the files, and the manifest with them - but only when every one
 * went. A manifest that survives is retried by the sweeper.
 */
export async function completeCleanup(
  manifestPath: string | null,
  files: UserFiles,
  uploadDir: string = config.UPLOAD_DIR
): Promise<DeleteUserFilesResult> {
  const result = await deleteUserFiles(files, uploadDir);
  if (manifestPath && result.failed === 0) {
    await fs.rm(manifestPath, { force: true }).catch(() => undefined);
  }
  return result;
}

async function ownerStillExists(owner: CleanupOwner): Promise<boolean> {
  const where = { where: { id: owner.id }, select: { id: true } } as const;
  const row =
    owner.kind === 'project'
      ? await prisma.project.findUnique(where)
      : await prisma.user.findUnique(where);
  return row !== null;
}

export interface SweepResult {
  completed: number;
  kept: number;
  discarded: number;
}

/**
 * Finish clean-ups an earlier run left behind.
 *
 * THE OWNER ROW DECIDES. A manifest is written before the rows are deleted,
 * so one can exist for a project that is still alive - the process died
 * between the two steps. Acting on it would delete a live project's images.
 * So: row gone -> remove the files; row present -> leave it, and after an
 * hour conclude the deletion never happened and throw the manifest away.
 */
export async function sweepPendingCleanups(
  uploadDir: string = config.UPLOAD_DIR,
  now: number = Date.now()
): Promise<SweepResult> {
  const result: SweepResult = { completed: 0, kept: 0, discarded: 0 };
  const dir = pendingDir(uploadDir);

  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter(name => name.endsWith('.json'));
  } catch {
    return result; // No directory: nothing has ever been pending.
  }

  for (const name of names) {
    const manifestPath = path.join(dir, name);
    try {
      const manifest = JSON.parse(
        await fs.readFile(manifestPath, 'utf8')
      ) as CleanupManifest;

      if (await ownerStillExists(manifest.owner)) {
        const age = now - Date.parse(manifest.createdAt);
        if (!(age <= ABANDONED_AFTER_MS)) {
          await fs.rm(manifestPath, { force: true });
          result.discarded += 1;
        } else {
          result.kept += 1;
        }
        continue;
      }

      const removed = await completeCleanup(
        manifestPath,
        manifest.files,
        uploadDir
      );
      if (removed.failed === 0) {
        result.completed += 1;
      } else {
        result.kept += 1;
      }
    } catch (error) {
      // An unreadable manifest is left for a person to look at; it is never
      // a reason to stop sweeping the others.
      result.kept += 1;
      logger.error(
        'Could not process a pending file clean-up',
        error as Error,
        'AccountFiles',
        { manifest: name }
      );
    }
  }

  if (result.completed + result.discarded > 0) {
    logger.info('Pending file clean-ups swept', 'AccountFiles', { ...result });
  }
  return result;
}

let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Sweep now and every ten minutes. Never throws and never blocks start-up:
 * it is called from the server's start path, where an exception takes the
 * whole app down (CLAUDE.md, failure pattern 23).
 */
export function startCleanupSweeper(): void {
  if (sweepTimer) {
    return;
  }
  const run = (): void => {
    sweepPendingCleanups().catch(error => {
      logger.error(
        'Pending clean-up sweep failed',
        error as Error,
        'AccountFiles'
      );
    });
  };
  sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  setImmediate(run);
}

export function stopCleanupSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
