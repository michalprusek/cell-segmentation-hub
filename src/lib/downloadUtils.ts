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
 * Downloads data from an Axios response
 * Handles both blob and arraybuffer response types
 */
export const downloadFromResponse = async (
  response: any,
  filename: string
): Promise<void> => {
  try {
    // Check if response.data is already a Blob
    const blob =
      response.data instanceof Blob ? response.data : new Blob([response.data]);

    downloadBlob(blob, { filename });
  } catch (error) {
    logger.error('Failed to download from response', error);
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

/**
 * Downloads CSV file from string content
 */
export const downloadCSV = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, {
    filename: filename.endsWith('.csv') ? filename : `${filename}.csv`,
    contentType: 'text/csv',
  });
};

/**
 * Checks if the browser supports large file downloads
 * Some browsers have limits on blob URLs
 */
export const canDownloadLargeFiles = (): boolean => {
  // Most modern browsers support large blobs, but we check for specific cases
  const userAgent = navigator.userAgent.toLowerCase();
  const isOldSafari =
    userAgent.includes('safari') &&
    !userAgent.includes('chrome') &&
    parseInt(userAgent.match(/version\/(\d+)/)?.[1] || '0') < 14;

  return !isOldSafari;
};

/**
 * Alternative download method using iframe for large files
 * Fallback for browsers that can't handle large blob URLs
 */
export const downloadUsingIframe = (url: string): void => {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);

  // Remove iframe after download starts
  setTimeout(() => {
    document.body.removeChild(iframe);
  }, 5000);
};
