import { z } from 'zod';

/**
 * Storage error class for handling storage-specific errors
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Upload options interface
 */
export interface UploadOptions {
  mimeType?: string;
  originalName?: string;
  maxSize?: number;
  generateThumbnail?: boolean;
  thumbnailSize?: {
    width: number;
    height: number;
  };
}

/**
 * Upload result interface
 */
export interface UploadResult {
  originalPath: string;
  thumbnailPath?: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
}

/**
 * Storage provider interface
 */
export interface StorageProvider {
  /**
   * Upload a file to storage
   * @param buffer File buffer
   * @param key Unique key/path for the file
   * @param options Upload options
   * @returns Promise with upload result
   */
  upload(buffer: Buffer, key: string, options?: UploadOptions): Promise<UploadResult>;

  /**
   * Delete a file from storage
   * @param key File key/path
   * @returns Promise indicating success
   */
  delete(key: string): Promise<void>;

  /**
   * Get URL for accessing a file
   * @param key File key/path
   * @param signed Whether to generate a signed URL (for private files)
   * @returns Promise with file URL
   */
  getUrl(key: string, signed?: boolean): Promise<string>;

  /**
   * Check if a file exists in storage
   * @param key File key/path
   * @returns Promise indicating if file exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get file metadata
   * @param key File key/path
   * @returns Promise with file metadata
   */
  getMetadata(key: string): Promise<{
    size: number;
    mimeType: string;
    lastModified: Date;
  }>;

  /**
   * Get file buffer for processing
   * @param key File key/path
   * @returns Promise with file buffer
   */
  getBuffer(key: string): Promise<Buffer>;
}

/**
 * Supported image MIME types
 */
export const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/bmp',
  'image/x-ms-bmp',
  'image/x-bmp',
  'image/tiff',
  'image/tif',
  'image/webp',
  'image/gif'
] as const;

/**
 * Supported image extensions
 */
export const SUPPORTED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.tiff',
  '.tif',
  '.webp',
  '.gif'
] as const;

/**
 * Default thumbnail size
 */
export const DEFAULT_THUMBNAIL_SIZE = {
  width: 300,
  height: 300
};

/**
 * Maximum file size (10MB)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Validation schema for file uploads
 */
export const fileUploadSchema = z.object({
  originalname: z.string(),
  mimetype: z.string().refine(
    (value) => (SUPPORTED_MIME_TYPES as readonly string[]).includes(value),
    {
      message: 'Nepodporovaný formát souboru. Podporované: JPG, PNG, BMP, TIFF, WEBP, GIF'
    }
  ),
  size: z.number().max(MAX_FILE_SIZE, {
    message: `Soubor je příliš velký. Maximální velikost: ${MAX_FILE_SIZE / (1024 * 1024)}MB`
  })
});

export type FileUploadData = z.infer<typeof fileUploadSchema>;