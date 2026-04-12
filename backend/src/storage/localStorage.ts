import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import sharp from 'sharp';
import {
  StorageProvider,
  UploadOptions,
  UploadResult,
  StorageError,
  DEFAULT_THUMBNAIL_SIZE,
} from './interface';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { getBaseUrl } from '../utils/getBaseUrl';

/**
 * Local file system storage provider
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly uploadDir: string;

  constructor() {
    this.uploadDir = path.resolve(config.UPLOAD_DIR);
    this.ensureDirectoryExists(this.uploadDir);
  }

  /**
   * Upload file to local storage
   */
  async upload(
    buffer: Buffer,
    key: string,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    try {
      const filePath = path.join(this.uploadDir, key);
      const directory = path.dirname(filePath);

      // Ensure directory exists
      await this.ensureDirectoryExists(directory);

      // Get image metadata
      let width: number | undefined;
      let height: number | undefined;
      let mimeType = options.mimeType || 'application/octet-stream';

      try {
        const imageMetadata = await sharp(buffer).metadata();
        width = imageMetadata.width;
        height = imageMetadata.height;
        if (imageMetadata.format) {
          mimeType = `image/${imageMetadata.format}`;
        }
      } catch {
        logger.warn('Failed to extract image metadata', 'LocalStorage', {
          key,
        });
      }

      // Write original file
      await fs.writeFile(filePath, buffer);

      const result: UploadResult = {
        originalPath: key,
        fileSize: buffer.length,
        mimeType,
        width,
        height,
      };

      // Generate thumbnail if requested and it's an image
      if (options.generateThumbnail && this.isImageMimeType(mimeType)) {
        try {
          const thumbnailKey = this.getThumbnailKey(key);
          const thumbnailPath = path.join(this.uploadDir, thumbnailKey);
          const thumbnailDir = path.dirname(thumbnailPath);

          await this.ensureDirectoryExists(thumbnailDir);

          const thumbnailSize = options.thumbnailSize || DEFAULT_THUMBNAIL_SIZE;

          // Sharp (libvips) doesn't support BMP input — decode manually
          const inputBuffer = this.isBmpMimeType(mimeType)
            ? this.decodeBmpToRawBuffer(buffer)
            : { data: buffer };

          const sharpInput =
            'raw' in inputBuffer
              ? sharp(inputBuffer.data, { raw: inputBuffer.raw })
              : sharp(inputBuffer.data);

          await sharpInput
            .resize(thumbnailSize.width, thumbnailSize.height, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({ quality: 85, mozjpeg: true })
            .toFile(thumbnailPath);

          result.thumbnailPath = thumbnailKey;
        } catch (error) {
          logger.warn('Failed to generate thumbnail', 'LocalStorage', {
            key,
            error: error instanceof Error ? error.message : 'Unknown error',
            mimeType,
          });
          // Don't fail the upload if thumbnail generation fails
        }
      }

      logger.info('File uploaded successfully', 'LocalStorage', {
        key,
        size: buffer.length,
      });
      return result;
    } catch (error) {
      logger.error(
        'Failed to upload file',
        error instanceof Error ? error : undefined,
        'LocalStorage',
        { key }
      );
      throw new StorageError(
        `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPLOAD_FAILED',
        500
      );
    }
  }

  /**
   * Delete file from local storage
   */
  async delete(key: string): Promise<void> {
    try {
      const filePath = path.join(this.uploadDir, key);

      // Delete original file
      if (existsSync(filePath)) {
        await fs.unlink(filePath);
      }

      // Delete thumbnail if exists (skip for avatars since they don't have thumbnails)
      if (!key.startsWith('avatars/')) {
        try {
          const thumbnailKey = this.getThumbnailKey(key);
          const thumbnailPath = path.join(this.uploadDir, thumbnailKey);

          if (existsSync(thumbnailPath)) {
            await fs.unlink(thumbnailPath);
          }
        } catch (error) {
          // If thumbnail key generation fails, continue with main file deletion
          logger.warn(
            'Failed to delete thumbnail (may not exist)',
            'LocalStorage',
            {
              key,
              error: (error as Error).message,
            }
          );
        }
      }

      logger.info('File deleted successfully', 'LocalStorage', { key });
    } catch (error) {
      logger.error(
        'Failed to delete file',
        error instanceof Error ? error : undefined,
        'LocalStorage',
        { key }
      );
      throw new StorageError(
        `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_FAILED',
        500
      );
    }
  }

  /**
   * Get URL for accessing file
   */
  async getUrl(key: string): Promise<string> {
    // In production, nginx serves /uploads from /app/uploads/blue (or /green)
    // In development, Express serves /uploads from config.UPLOAD_DIR
    // Both configurations automatically handle the environment-specific path mapping

    // In production, use relative URL to work with any domain
    // This will be served through nginx proxy
    if (process.env.NODE_ENV === 'production') {
      return `/uploads/${key}`;
    }
    // In development, use the base URL
    const baseUrl = getBaseUrl();
    return `${baseUrl}/uploads/${key}`;
  }

  /**
   * Check if file exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const filePath = path.join(this.uploadDir, key);
      return existsSync(filePath);
    } catch (error) {
      logger.error(
        'Failed to check file existence',
        error instanceof Error ? error : undefined,
        'LocalStorage',
        { key }
      );
      return false;
    }
  }

  /**
   * Get file metadata
   */
  async getMetadata(key: string): Promise<{
    size: number;
    mimeType: string;
    lastModified: Date;
  }> {
    try {
      const filePath = path.join(this.uploadDir, key);
      const stats = await fs.stat(filePath);

      // Try to determine MIME type from file extension
      const ext = path.extname(key).toLowerCase();
      let mimeType = 'application/octet-stream';

      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.bmp': 'image/bmp',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff',
      };

      mimeType = mimeMap[ext] || mimeType;

      return {
        size: stats.size,
        mimeType,
        lastModified: stats.mtime,
      };
    } catch (error) {
      logger.error(
        'Failed to get file metadata',
        error instanceof Error ? error : undefined,
        'LocalStorage',
        { key }
      );
      throw new StorageError(
        `Failed to get file metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'METADATA_FAILED',
        500
      );
    }
  }

  /**
   * Get file buffer for processing
   */
  async getBuffer(key: string): Promise<Buffer> {
    try {
      const filePath = path.join(this.uploadDir, key);

      if (!existsSync(filePath)) {
        throw new StorageError(`File not found: ${key}`, 'FILE_NOT_FOUND', 404);
      }

      return await fs.readFile(filePath);
    } catch (error) {
      logger.error(
        'Failed to get file buffer',
        error instanceof Error ? error : undefined,
        'LocalStorage',
        { key }
      );

      if (error instanceof StorageError) {
        throw error;
      }

      throw new StorageError(
        `Failed to get file buffer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BUFFER_FAILED',
        500
      );
    }
  }

  /**
   * Generate storage key for file
   */
  public static generateKey(
    userId: string | undefined,
    projectId: string | undefined,
    filename: string,
    isOriginal = true
  ): string {
    // Enhanced sanitization to prevent path traversal attacks
    const sanitizePathComponent = (component: string): string => {
      // Remove any path traversal sequences and dangerous characters
      return (
        component
          .replace(/\.\./g, '') // Remove parent directory references
          .replace(/[/\\]/g, '') // Remove path separators
          .replace(/^\.+/, '') // Remove leading dots
          // Updated regex to preserve Unicode characters (including diacritics) while removing unsafe characters
          // This allows letters from any language, numbers, spaces, dots, dashes, and underscores
          .replace(/[^\p{L}\p{N}\s._-]/gu, '_') // Unicode-aware: Keep letters, numbers, space, dot, dash, underscore
          .replace(/\s+/g, '_') // Replace spaces with underscores for filesystem compatibility
          .substring(0, 255)
      ); // Limit length to prevent filesystem issues
    };

    const sanitizedUserId = sanitizePathComponent(userId || 'unknown');
    const sanitizedProjectId = sanitizePathComponent(projectId || 'unknown');

    const folder = isOriginal ? 'originals' : 'thumbnails';
    const timestamp = Date.now();

    // Secure filename handling
    const basename = path.basename(filename); // Remove any directory components
    const ext = path.extname(basename);
    const nameWithoutExt = path.basename(basename, ext);
    const sanitizedName = sanitizePathComponent(nameWithoutExt);

    // Validate and sanitize extension (keep only alphanumeric and dots)
    const sanitizedExt = ext
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '') // Extensions should remain ASCII for compatibility
      .substring(0, 10);

    return `${sanitizedUserId}/${sanitizedProjectId}/${folder}/${timestamp}_${sanitizedName}${sanitizedExt}`;
  }

  /**
   * Get thumbnail key from original key
   */
  private getThumbnailKey(originalKey: string): string {
    const parts = originalKey.split('/');

    // Validate that we have enough path segments and a valid filename
    const lastPart = parts[parts.length - 1];
    if (parts.length < 4 || !lastPart || lastPart.trim() === '') {
      throw new StorageError(
        `Invalid key format for thumbnail generation: ${originalKey}`,
        'INVALID_KEY_FORMAT',
        400
      );
    }

    // Replace 'originals' with 'thumbnails' and change extension to .jpg
    parts[2] = 'thumbnails';
    const filename = lastPart; // Safe after validation above
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    parts[parts.length - 1] = `${nameWithoutExt}.jpg`;

    return parts.join('/');
  }

  /**
   * Check if MIME type is an image
   */
  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  /**
   * Check if MIME type is BMP (Sharp/libvips doesn't support BMP input)
   */
  private isBmpMimeType(mimeType: string): boolean {
    return (
      mimeType === 'image/bmp' ||
      mimeType === 'image/x-ms-bmp' ||
      mimeType === 'image/x-bmp'
    );
  }

  /**
   * Decode BMP file to raw RGB pixel buffer for Sharp.
   * Sharp (libvips) doesn't support BMP input natively.
   * Handles 8-bit palette-indexed and 24-bit direct BGR formats.
   */
  private decodeBmpToRawBuffer(buffer: Buffer): {
    data: Buffer;
    raw: { width: number; height: number; channels: 3 };
  } {
    const dataOffset = buffer.readUInt32LE(10);
    const width = buffer.readInt32LE(18);
    const height = buffer.readInt32LE(22);
    const bitsPerPixel = buffer.readUInt16LE(28);
    const absHeight = Math.abs(height);
    const bottomUp = height > 0;

    const pixelData = Buffer.alloc(width * absHeight * 3);

    if (bitsPerPixel === 8) {
      // Palette-indexed: 256 entries at offset 54, each 4 bytes (BGRA)
      const paletteOffset = 54;
      const palette: [number, number, number][] = [];
      for (let i = 0; i < 256; i++) {
        const off = paletteOffset + i * 4;
        palette.push([buffer[off + 2], buffer[off + 1], buffer[off]]);
      }
      const rowSize = Math.ceil(width / 4) * 4;
      for (let y = 0; y < absHeight; y++) {
        const srcRow = bottomUp ? absHeight - 1 - y : y;
        const srcOffset = dataOffset + srcRow * rowSize;
        for (let x = 0; x < width; x++) {
          const idx = buffer[srcOffset + x];
          const dstIdx = (y * width + x) * 3;
          const [r, g, b] = palette[idx];
          pixelData[dstIdx] = r;
          pixelData[dstIdx + 1] = g;
          pixelData[dstIdx + 2] = b;
        }
      }
    } else if (bitsPerPixel === 24) {
      const rowSize = Math.ceil((width * 3) / 4) * 4;
      for (let y = 0; y < absHeight; y++) {
        const srcRow = bottomUp ? absHeight - 1 - y : y;
        const srcOffset = dataOffset + srcRow * rowSize;
        for (let x = 0; x < width; x++) {
          const srcIdx = srcOffset + x * 3;
          const dstIdx = (y * width + x) * 3;
          pixelData[dstIdx] = buffer[srcIdx + 2];
          pixelData[dstIdx + 1] = buffer[srcIdx + 1];
          pixelData[dstIdx + 2] = buffer[srcIdx];
        }
      }
    } else if (bitsPerPixel === 32) {
      const rowSize = width * 4;
      for (let y = 0; y < absHeight; y++) {
        const srcRow = bottomUp ? absHeight - 1 - y : y;
        const srcOffset = dataOffset + srcRow * rowSize;
        for (let x = 0; x < width; x++) {
          const srcIdx = srcOffset + x * 4;
          const dstIdx = (y * width + x) * 3;
          pixelData[dstIdx] = buffer[srcIdx + 2];
          pixelData[dstIdx + 1] = buffer[srcIdx + 1];
          pixelData[dstIdx + 2] = buffer[srcIdx];
        }
      }
    } else {
      throw new Error(`Unsupported BMP bit depth: ${bitsPerPixel}`);
    }

    return {
      data: pixelData,
      raw: { width, height: absHeight, channels: 3 },
    };
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
