/**
 * Converts various image formats (including TIFF) to a displayable format
 * using Canvas API and UTIF for browser compatibility
 */
import UTIF from 'utif2';
import { logger } from './logger';

/**
 * Check if file is a TIFF image
 */
export const isTiffFile = (file: File): boolean => {
  return (
    file.type === 'image/tiff' ||
    file.type === 'image/tif' ||
    file.name?.toLowerCase().endsWith('.tiff') ||
    file.name?.toLowerCase().endsWith('.tif')
  );
};

/**
 * Convert TIFF file to canvas using UTIF library
 */
const convertTiffToCanvas = async (file: File): Promise<HTMLCanvasElement> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      const arrayBuffer = e.target?.result as ArrayBuffer;

      if (!arrayBuffer) {
        reject(
          new Error(
            `Failed to read TIFF file: ${file.name} - FileReader error occurred`
          )
        );
        return;
      }

      try {
        // Parse TIFF using UTIF
        const ifds = UTIF.decode(arrayBuffer);

        if (!ifds || ifds.length === 0) {
          reject(
            new Error(
              `No images found in TIFF file: ${file.name} - The file may be corrupted or not a valid TIFF`
            )
          );
          return;
        }

        // Get the first image
        const ifd = ifds[0];
        UTIF.decodeImage(arrayBuffer, ifd);

        const width = ifd.width;
        const height = ifd.height;

        // Create canvas and draw the image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(
            new Error(
              `Failed to get canvas context for TIFF file: ${file.name}`
            )
          );
          return;
        }

        // Create ImageData from RGBA array
        const imageData = ctx.createImageData(width, height);
        const rgba = UTIF.toRGBA8(ifd);

        // Copy RGBA data
        for (let i = 0; i < rgba.length; i++) {
          imageData.data[i] = rgba[i];
        }

        // Put the image data on the canvas
        ctx.putImageData(imageData, 0, 0);

        resolve(canvas);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse TIFF file '${file.name}': ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      }
    };

    reader.onerror = () =>
      reject(new Error(`Failed to read file: ${file.name} - FileReader error`));
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Convert any image file to a data URL that can be displayed in browser
 * This is especially useful for TIFF files which aren't natively supported
 */
export const convertImageToDataUrl = async (file: File): Promise<string> => {
  // For TIFF files, use TIFF.js library
  if (isTiffFile(file)) {
    try {
      const canvas = await convertTiffToCanvas(file);
      return canvas.toDataURL('image/png');
    } catch (error) {
      logger.error('Failed to convert TIFF', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // For non-TIFF files, use standard approach
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      // Convert to canvas to ensure compatibility
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } else {
        URL.revokeObjectURL(url);
        // Fallback to object URL if canvas fails
        resolve(url);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Fallback to FileReader
      const reader = new FileReader();
      reader.onload = e => {
        if (e.target?.result) {
          resolve(e.target.result as string);
        } else {
          reject(
            new Error(
              `Failed to read file: ${file.name} - No result from FileReader`
            )
          );
        }
      };
      reader.onerror = () =>
        reject(
          new Error(`Failed to read file: ${file.name} - FileReader error`)
        );
      reader.readAsDataURL(file);
    };

    img.src = url;
  });
};

/**
 * Create a preview URL for an image file
 * Handles TIFF conversion automatically
 *
 * Note: If an object URL is returned, the caller must call URL.revokeObjectURL(url)
 * when done to prevent memory leaks.
 */
export const createImagePreviewUrl = async (file: File): Promise<string> => {
  try {
    // Try to convert to data URL (handles TIFF)
    return await convertImageToDataUrl(file);
  } catch (error) {
    logger.warn('Failed to convert image, trying FileReader fallback', error);

    // Try FileReader as a fallback for data URL
    if (typeof FileReader !== 'undefined') {
      try {
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            } else {
              reject(
                new Error(
                  `FileReader did not return a string for file: ${file.name}`
                )
              );
            }
          };
          reader.onerror = () =>
            reject(reader.error || new Error('FileReader failed'));
          reader.readAsDataURL(file);
        });
      } catch (fileReaderError) {
        logger.warn('FileReader fallback failed', fileReaderError);
      }
    }

    // Final fallback - create object URL
    // WARNING: Caller must call URL.revokeObjectURL() when done to prevent memory leaks
    logger.warn(
      'Using object URL as last resort - remember to revoke it when done'
    );
    return URL.createObjectURL(file);
  }
};
