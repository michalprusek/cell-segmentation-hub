/**
 * IO + utility functions extracted from `exportService.ts`. Pure or
 * pseudo-pure (filesystem operations only) — no class state, no DB, no
 * progress tracking. Job-orchestration concerns stay in the class.
 */

import path from 'path';
import { promises as fs } from 'fs';
import archiver from 'archiver';
import { logger } from '../../utils/logger';

const RESERVED_WINDOWS_NAMES = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
];

/**
 * Strip filesystem-unsafe characters from a candidate filename. Replaces
 * Windows-reserved chars + control chars with `_`, trims leading/trailing
 * dots and whitespace, truncates to 100 chars, and avoids Windows reserved
 * device names. Returns 'export' if the result is empty.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'export';
  }

  let sanitized = filename
    .replace(/[<>:"|?*\\/]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u0080-\u009f]/g, '_')
    .trim();

  // Remove leading/trailing dots and spaces (Windows compatibility)
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  if (!sanitized || sanitized.length === 0) {
    sanitized = 'export';
  } else if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100).trim();
  }

  if (RESERVED_WINDOWS_NAMES.includes(sanitized.toUpperCase())) {
    sanitized = `${sanitized}_export`;
  }

  return sanitized;
}

export type ExportProgressStage =
  | 'images'
  | 'visualizations'
  | 'annotations'
  | 'metrics'
  | 'compression';

export interface ExportProgressDetail {
  current: number;
  total: number;
  currentItem?: string;
}

/**
 * Build a human-readable progress message for WebSocket broadcasting.
 * Pure function — no IO, no state. Output format is the contract the
 * frontend toast/progress UI consumes.
 */
export function getProgressMessage(
  progress: number,
  stage?: ExportProgressStage,
  stageProgress?: ExportProgressDetail
): string {
  if (stage && stageProgress) {
    const { current, total, currentItem } = stageProgress;
    const itemSuffix = currentItem ? `: ${currentItem}` : '';
    switch (stage) {
      case 'images':
        return `Copying original images (${current}/${total})${itemSuffix}... ${progress}%`;
      case 'visualizations':
        return `Generating visualizations (${current}/${total})${itemSuffix}... ${progress}%`;
      case 'annotations':
        return `Creating annotation files (${current}/${total})${itemSuffix}... ${progress}%`;
      case 'metrics':
        return `Calculating metrics (${current}/${total})${itemSuffix}... ${progress}%`;
      case 'compression':
        return `Creating archive... ${progress}%`;
      default:
        return `Processing ${stage} (${current}/${total})... ${progress}%`;
    }
  } else if (stage) {
    switch (stage) {
      case 'images':
        return `Copying original images... ${progress}%`;
      case 'visualizations':
        return `Generating visualizations... ${progress}%`;
      case 'annotations':
        return `Creating annotation files... ${progress}%`;
      case 'metrics':
        return `Calculating metrics... ${progress}%`;
      case 'compression':
        return `Creating archive... ${progress}%`;
      default:
        return `Processing ${stage}... ${progress}%`;
    }
  }
  return `Processing... ${progress}%`;
}

/**
 * Create a zip archive of an export staging directory and write it to
 * disk under `process.env.EXPORT_DIR || './exports'`. Resolves with the
 * absolute path to the produced ZIP. Caller is responsible for cleaning
 * up the staging directory.
 *
 * Robustness: dual error handlers on writeStream + archive both delegate
 * to a single idempotent cleanup that destroys the archive, closes the
 * file handle, and removes listeners (memory-leak guard for long-running
 * processes that produce many exports).
 */
export async function createZipArchive(
  exportDir: string,
  projectName: string
): Promise<string> {
  const sanitizedProjectName = sanitizeFilename(projectName);
  const zipName = `${sanitizedProjectName}.zip`;
  const zipPath = path.join(process.env.EXPORT_DIR || './exports', zipName);

  const output = await fs.open(zipPath, 'w');
  const archive = archiver('zip', {
    zlib: { level: 6 }, // Balanced compression
    highWaterMark: 16 * 1024 * 1024, // 16MB buffer for streaming
  });

  return new Promise((resolve, reject) => {
    let cleanupCalled = false;

    const cleanup = async (): Promise<void> => {
      if (cleanupCalled) {
        return;
      }
      cleanupCalled = true;

      try {
        if (archive.readable || archive.writable) {
          archive.destroy();
        }
      } catch (error) {
        logger.warn('Failed to destroy archive:', 'ExportFileOps', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        await output.close();
      } catch (error) {
        logger.warn('Failed to close file handle:', 'ExportFileOps', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      writeStream.removeAllListeners();
      archive.removeAllListeners();
    };

    const writeStream = output.createWriteStream();

    writeStream.on('error', error => {
      cleanup().finally(() => reject(error));
    });

    writeStream.on('close', () => {
      cleanup().finally(() => resolve(zipPath));
    });

    archive.on('error', error => {
      cleanup().finally(() => reject(error));
    });

    archive.pipe(writeStream);
    archive.directory(exportDir, false);

    try {
      archive.finalize().catch(error => {
        cleanup().finally(() => reject(error));
      });
    } catch (error) {
      cleanup().finally(() => reject(error));
    }
  });
}
