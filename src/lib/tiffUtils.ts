/**
 * Utility functions for handling TIFF images
 */

/**
 * Check if a file is a TIFF image based on its MIME type or extension
 */
export const isTiffFile = (
  file: { type?: string; name?: string } | string
): boolean => {
  if (typeof file === 'string') {
    // Check by filename - add null/undefined check
    if (!file) return false;
    const lowercaseName = file.toLowerCase();
    return lowercaseName.endsWith('.tiff') || lowercaseName.endsWith('.tif');
  }

  // Check by MIME type
  if (file.type === 'image/tiff' || file.type === 'image/tif') {
    return true;
  }

  // Check by filename
  if (file.name) {
    const lowercaseName = file.name.toLowerCase();
    return lowercaseName.endsWith('.tiff') || lowercaseName.endsWith('.tif');
  }

  return false;
};

/**
 * Ensure image URL uses the display endpoint for TIFF files
 * This is necessary because browsers cannot natively display TIFF images
 */
export const ensureBrowserCompatibleUrl = (
  imageId: string,
  originalUrl: string | undefined,
  imageName?: string
): string => {
  // If we have an imageId, always use the display endpoint for safety
  // This endpoint handles TIFF conversion automatically
  if (imageId) {
    const displayUrl = `/api/images/${imageId}/display`;

    // Check if the original URL or name suggests it's a TIFF
    if (originalUrl && isTiffFile(originalUrl)) {
      return displayUrl;
    }

    if (imageName && isTiffFile(imageName)) {
      return displayUrl;
    }

    // For non-TIFF files, prefer the original URL if available
    // but fallback to display endpoint if needed
    return originalUrl || displayUrl;
  }

  return originalUrl || '';
};

/**
 * Get appropriate fallback URLs for an image, prioritizing browser-compatible formats
 */
export const getImageFallbackUrls = (image: {
  id: string;
  name?: string;
  url?: string;
  displayUrl?: string;
  thumbnail_url?: string;
  image_url?: string;
  segmentationThumbnailUrl?: string;
}): string[] => {
  const urls: string[] = [];

  if (image.id) {
    const displayEndpoint = `/api/images/${image.id}/display`;
    const isTiff = image.name && isTiffFile(image.name);

    // For TIFF files, use a smart priority:
    // 1. Segmentation thumbnail (if available) - best for gallery
    // 2. Regular thumbnail (JPEG converted from TIFF) - good for gallery
    // 3. Display endpoint (converts TIFF to PNG) - fallback
    // 4. Other URLs as final fallbacks

    if (isTiff) {
      // For TIFF files, prioritize actual thumbnails over display endpoint
      if (image.segmentationThumbnailUrl)
        urls.push(image.segmentationThumbnailUrl);
      if (image.thumbnail_url) urls.push(image.thumbnail_url);
      // Display endpoint as fallback for TIFF
      urls.push(displayEndpoint);
      if (image.displayUrl && image.displayUrl !== displayEndpoint)
        urls.push(image.displayUrl);
      if (image.url) urls.push(image.url);
      if (image.image_url) urls.push(image.image_url);
    } else {
      // For non-TIFF files, use normal priority
      if (image.segmentationThumbnailUrl)
        urls.push(image.segmentationThumbnailUrl);
      if (image.thumbnail_url) urls.push(image.thumbnail_url);
      if (image.displayUrl) urls.push(image.displayUrl);
      if (image.url) urls.push(image.url);
      if (image.image_url) urls.push(image.image_url);
      // Display endpoint as final fallback for non-TIFF
      if (!urls.includes(displayEndpoint)) {
        urls.push(displayEndpoint);
      }
    }
  } else {
    // No ID available, use what we have
    if (image.segmentationThumbnailUrl)
      urls.push(image.segmentationThumbnailUrl);
    if (image.thumbnail_url) urls.push(image.thumbnail_url);
    if (image.displayUrl) urls.push(image.displayUrl);
    if (image.url) urls.push(image.url);
    if (image.image_url) urls.push(image.image_url);
  }

  // Remove duplicates while preserving order
  return [...new Set(urls)].filter(Boolean);
};
