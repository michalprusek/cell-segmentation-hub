/**
 * Centralized download utilities for the application
 * Handles blob downloads, large files, and various formats
 */

import { logger } from './logger';

export interface DownloadOptions {
  filename: string;
  contentType?: string;
  cleanup?: boolean;
}

/**
 * Downloads a blob using the browser's download mechanism
 * Properly handles DOM manipulation for cross-browser compatibility
 */
export const downloadBlob = (blob: Blob, options: DownloadOptions): void => {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.filename;

    // CRITICAL: Must append to DOM for Chrome/Safari compatibility
    document.body.appendChild(link);
    link.click();

    // Cleanup after a short delay
    if (options.cleanup !== false) {
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    }

    logger.info('File download triggered', { filename: options.filename });
  } catch (error) {
    logger.error('Download failed', error);
    throw error;
  }
};

/**
 * Downloads JSON data as a formatted file
 */
export const downloadJSON = (data: any, filename: string): void => {
  try {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    downloadBlob(blob, {
      filename: filename.endsWith('.json') ? filename : `${filename}.json`,
      contentType: 'application/json',
    });
  } catch (error) {
    logger.error('Failed to download JSON', error);
    throw error;
  }
};

/**
 * Downloads Excel file from blob
 */
export const downloadExcel = (blob: Blob, filename: string): void => {
  downloadBlob(blob, {
    filename: filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};
