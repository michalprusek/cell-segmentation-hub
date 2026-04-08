import { describe, it, expect } from 'vitest';
import {
  isTiffFile,
  ensureBrowserCompatibleUrl,
  getImageFallbackUrls,
} from '@/lib/tiffUtils';

describe('isTiffFile', () => {
  describe('string filenames', () => {
    it('returns true for .tiff extension', () => {
      expect(isTiffFile('scan.tiff')).toBe(true);
    });

    it('returns true for .tif extension', () => {
      expect(isTiffFile('scan.tif')).toBe(true);
    });

    it('returns true for uppercase .TIF extension', () => {
      expect(isTiffFile('SCAN.TIF')).toBe(true);
    });

    it('returns true for uppercase .TIFF extension', () => {
      expect(isTiffFile('SCAN.TIFF')).toBe(true);
    });

    it('returns false for .jpg filename', () => {
      expect(isTiffFile('photo.jpg')).toBe(false);
    });

    it('returns false for .png filename', () => {
      expect(isTiffFile('image.png')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isTiffFile('')).toBe(false);
    });
  });

  describe('File-like objects', () => {
    it('returns true when MIME type is image/tiff', () => {
      expect(isTiffFile({ type: 'image/tiff', name: 'scan.tiff' })).toBe(true);
    });

    it('returns true when MIME type is image/tif', () => {
      expect(isTiffFile({ type: 'image/tif', name: 'scan.tif' })).toBe(true);
    });

    it('returns true by filename when MIME type is absent but name ends in .tiff', () => {
      expect(isTiffFile({ name: 'scan.tiff' })).toBe(true);
    });

    it('returns false for a JPEG File object', () => {
      expect(isTiffFile({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
    });

    it('returns false when both type and name are absent', () => {
      expect(isTiffFile({})).toBe(false);
    });
  });
});

describe('ensureBrowserCompatibleUrl', () => {
  it('returns the display endpoint when the original URL is a TIFF', () => {
    const result = ensureBrowserCompatibleUrl(
      'img-1',
      'http://example.com/file.tiff'
    );
    expect(result).toBe('/api/images/img-1/display');
  });

  it('returns the display endpoint when the image name is a TIFF', () => {
    const result = ensureBrowserCompatibleUrl('img-2', undefined, 'photo.tif');
    expect(result).toBe('/api/images/img-2/display');
  });

  it('returns the original URL for non-TIFF images when imageId is present', () => {
    const result = ensureBrowserCompatibleUrl(
      'img-3',
      'http://example.com/image.png'
    );
    expect(result).toBe('http://example.com/image.png');
  });

  it('falls back to the display endpoint when originalUrl is undefined and no name clue', () => {
    const result = ensureBrowserCompatibleUrl('img-4', undefined);
    expect(result).toBe('/api/images/img-4/display');
  });

  it('returns originalUrl or empty string when imageId is falsy', () => {
    expect(ensureBrowserCompatibleUrl('', 'http://example.com/img.jpg')).toBe(
      'http://example.com/img.jpg'
    );
    expect(ensureBrowserCompatibleUrl('', undefined)).toBe('');
  });
});

describe('getImageFallbackUrls', () => {
  describe('TIFF images', () => {
    it('puts segmentationThumbnailUrl first', () => {
      const urls = getImageFallbackUrls({
        id: 'img-1',
        name: 'scan.tiff',
        segmentationThumbnailUrl: '/seg-thumb',
        thumbnail_url: '/thumb',
      });
      expect(urls[0]).toBe('/seg-thumb');
    });

    it('includes the display endpoint in the list', () => {
      const urls = getImageFallbackUrls({
        id: 'img-1',
        name: 'scan.tiff',
      });
      expect(urls).toContain('/api/images/img-1/display');
    });

    it('deduplicates the display endpoint when already present in displayUrl', () => {
      const urls = getImageFallbackUrls({
        id: 'img-1',
        name: 'scan.tiff',
        displayUrl: '/api/images/img-1/display',
      });
      const count = urls.filter(u => u === '/api/images/img-1/display').length;
      expect(count).toBe(1);
    });
  });

  describe('non-TIFF images', () => {
    it('puts segmentationThumbnailUrl first when available', () => {
      const urls = getImageFallbackUrls({
        id: 'img-2',
        name: 'photo.jpg',
        segmentationThumbnailUrl: '/seg-thumb',
        url: '/original',
      });
      expect(urls[0]).toBe('/seg-thumb');
    });

    it('appends the display endpoint as final fallback', () => {
      const urls = getImageFallbackUrls({
        id: 'img-2',
        name: 'photo.jpg',
        url: '/original',
      });
      expect(urls.at(-1)).toBe('/api/images/img-2/display');
    });

    it('does not duplicate the display endpoint', () => {
      const urls = getImageFallbackUrls({
        id: 'img-2',
        name: 'photo.jpg',
        displayUrl: '/api/images/img-2/display',
      });
      const count = urls.filter(u => u === '/api/images/img-2/display').length;
      expect(count).toBe(1);
    });
  });

  describe('no imageId', () => {
    it('collects available URLs without generating a display endpoint', () => {
      const urls = getImageFallbackUrls({
        id: '',
        name: 'scan.tiff',
        url: '/original',
        thumbnail_url: '/thumb',
      });
      expect(urls).not.toContain('/api/images//display');
      expect(urls).toContain('/original');
      expect(urls).toContain('/thumb');
    });

    it('returns an empty array when no URLs are available and id is empty', () => {
      const urls = getImageFallbackUrls({ id: '' });
      expect(urls).toEqual([]);
    });
  });

  describe('deduplication', () => {
    it('removes duplicate URLs while preserving order', () => {
      const urls = getImageFallbackUrls({
        id: 'img-3',
        name: 'photo.jpg',
        displayUrl: '/common-url',
        url: '/common-url',
      });
      const count = urls.filter(u => u === '/common-url').length;
      expect(count).toBe(1);
    });
  });
});
