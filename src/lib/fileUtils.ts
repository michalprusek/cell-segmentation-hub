/**
 * Shared file handling utilities
 */

import { File as FileIcon, Image as ImageIcon, LucideIcon } from 'lucide-react';

export interface FileWithPreview extends File {
  preview?: string;
  uploadProgress?: number;
  status?: 'pending' | 'uploading' | 'complete' | 'error';
  id?: string;
}

/**
 * Format file size in human-readable format
 * @param sizeInBytes - Size in bytes
 * @returns Formatted size string
 */
export const formatFileSize = (sizeInBytes: number): string => {
  if (typeof sizeInBytes !== 'number' || isNaN(sizeInBytes)) {
    return 'Unknown size';
  }

  if (sizeInBytes === 0) return '0 KB';

  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  } else if (sizeInBytes < 1024 * 1024) {
    return `${(sizeInBytes / 1024).toFixed(0)} KB`;
  } else {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
};

/**
 * Get formatted file size for a FileWithPreview object
 * @param file - File object
 * @returns Formatted size string
 */
export const getFileSize = (file: FileWithPreview): string => {
  // Handle cases where file.size might be undefined or corrupted
  if (
    file.size !== undefined &&
    typeof file.size === 'number' &&
    !isNaN(file.size)
  ) {
    return formatFileSize(file.size);
  }

  // Fallback for File objects with potential property issues
  if (file instanceof File && file.size !== undefined) {
    return formatFileSize(file.size);
  }

  return 'Unknown size';
};

/**
 * Get file type icon based on MIME type
 * @param mimeType - File MIME type
 * @returns Lucide icon component
 */
export const getFileTypeIcon = (mimeType: string): LucideIcon => {
  if (mimeType.startsWith('image/')) {
    return ImageIcon;
  }
  return FileIcon;
};

/**
 * Create a FileWithPreview object safely without mutation
 * @param file - Original File object
 * @returns FileWithPreview object
 */
export const createFileWithPreview = (file: File): FileWithPreview => {
  // Important: We must preserve the actual File object to maintain its prototype
  // Using spread operator or Object.assign on File objects loses the File prototype
  // and causes FormData.append() to fail
  const fileWithPreview = file as FileWithPreview;

  // For TIFF files, browsers cannot natively display them via blob URLs
  // Instead, we'll set preview to undefined and let the upload component
  // show a placeholder icon. The actual image will be displayed via
  // the backend conversion endpoint after upload.
  if (file.type === 'image/tiff' || file.type === 'image/tif') {
    fileWithPreview.preview = undefined; // Will show placeholder in UploadFileCard
  } else {
    // Add additional properties without losing the File prototype
    fileWithPreview.preview = URL.createObjectURL(file);
  }

  fileWithPreview.uploadProgress = 0;
  fileWithPreview.status = 'pending' as const;

  return fileWithPreview;
};

/**
 * Create a unique identifier for file tracking
 * @param file - File object
 * @returns Unique identifier string
 */
export const getFileIdentifier = (file: FileWithPreview): string => {
  return `${file.name}_${file.size}`;
};

/**
 * Check if two files are the same based on name and size
 * @param file1 - First file
 * @param file2 - Second file (or file data from WebSocket)
 * @returns True if files match
 */
export const filesMatch = (
  file1: FileWithPreview,
  file2: { filename?: string; fileSize?: number; name?: string; size?: number }
): boolean => {
  const file1Name = file1.name;
  const file1Size = file1.size;
  const file2Name = file2.filename || file2.name;
  const file2Size = file2.fileSize || file2.size;

  return file1Name === file2Name && file1Size === file2Size;
};

/**
 * Validate if a file is a supported image type
 * @param file - File to validate
 * @returns Validation result
 */
export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

export const validateImageFile = (file: File): FileValidationResult => {
  const supportedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/tiff',
    'image/tif',
  ];

  if (!supportedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: `Unsupported file type: ${file.type}. Supported types: ${supportedTypes.join(', ')}`,
    };
  }

  // Check file size (e.g., max 50MB)
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `File too large: ${formatFileSize(file.size)}. Maximum size: ${formatFileSize(maxSize)}`,
    };
  }

  return { isValid: true };
};

/**
 * Clean up blob URLs to prevent memory leaks
 * @param files - Array of files with preview URLs
 */
export const cleanupFilePreviewUrls = (files: FileWithPreview[]): void => {
  files.forEach(file => {
    if (file.preview && file.preview.startsWith('blob:')) {
      URL.revokeObjectURL(file.preview);
    }
  });
};
