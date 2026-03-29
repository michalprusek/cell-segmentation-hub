import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatFileSize,
  getFileSize,
  getFileTypeIcon,
  createFileWithPreview,
  getFileIdentifier,
  filesMatch,
  validateImageFile,
  cleanupFilePreviewUrls,
  type FileWithPreview,
} from '@/lib/fileUtils';

const makeFile = (
  sizeBytes: number,
  type = 'image/jpeg',
  name = 'photo.jpg'
): File => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes, configurable: true });
  return f;
};

describe('formatFileSize', () => {
  it('returns "0 KB" for zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 KB');
  });

  it('returns bytes representation for sizes under 1 KB', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('returns KB representation for sizes between 1 KB and 1 MB', () => {
    expect(formatFileSize(2048)).toBe('2 KB');
  });

  it('returns MB representation for sizes at 1 MB and above', () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toContain('MB');
  });

  it('returns "Unknown size" for NaN input', () => {
    expect(formatFileSize(NaN)).toBe('Unknown size');
  });

  it('returns "Unknown size" for non-number input', () => {
    expect(formatFileSize('abc' as unknown as number)).toBe('Unknown size');
  });
});

describe('getFileSize', () => {
  it('returns a formatted size for a valid File object', () => {
    const file = makeFile(2048) as FileWithPreview;
    expect(getFileSize(file)).toBe('2 KB');
  });

  it('returns "Unknown size" for a file with NaN size', () => {
    const file = { name: 'x.jpg', size: NaN } as FileWithPreview;
    expect(getFileSize(file)).toBe('Unknown size');
  });
});

describe('getFileTypeIcon', () => {
  it('returns ImageIcon for image MIME types', async () => {
    const { Image: ImageIcon } = await import('lucide-react');
    expect(getFileTypeIcon('image/jpeg')).toBe(ImageIcon);
  });

  it('returns FileIcon for non-image MIME types', async () => {
    const { File: FileIcon } = await import('lucide-react');
    expect(getFileTypeIcon('application/pdf')).toBe(FileIcon);
  });

  it('returns ImageIcon for image/tiff', async () => {
    const { Image: ImageIcon } = await import('lucide-react');
    expect(getFileTypeIcon('image/tiff')).toBe(ImageIcon);
  });
});

describe('createFileWithPreview', () => {
  beforeEach(() => {
    // jsdom does not implement URL.createObjectURL — assign directly to global.URL
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-uuid');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets preview to a blob URL for non-TIFF files', () => {
    const file = makeFile(1024, 'image/jpeg');
    const result = createFileWithPreview(file);
    expect(result.preview).toMatch(/^blob:/);
  });

  it('sets preview to undefined for TIFF files', () => {
    const file = makeFile(1024, 'image/tiff', 'scan.tiff');
    const result = createFileWithPreview(file);
    expect(result.preview).toBeUndefined();
  });

  it('sets preview to undefined for image/tif MIME type', () => {
    const file = makeFile(1024, 'image/tif', 'scan.tif');
    const result = createFileWithPreview(file);
    expect(result.preview).toBeUndefined();
  });

  it('sets uploadProgress to 0', () => {
    const file = makeFile(1024, 'image/png', 'img.png');
    const result = createFileWithPreview(file);
    expect(result.uploadProgress).toBe(0);
  });

  it('sets status to "pending"', () => {
    const file = makeFile(1024, 'image/png', 'img.png');
    const result = createFileWithPreview(file);
    expect(result.status).toBe('pending');
  });

  it('preserves the original File prototype (instanceof check)', () => {
    const file = makeFile(1024, 'image/png', 'img.png');
    const result = createFileWithPreview(file);
    expect(result).toBe(file); // same reference — no prototype loss
  });
});

describe('getFileIdentifier', () => {
  it('returns name_size format', () => {
    const file = makeFile(1024, 'image/jpeg', 'photo.jpg') as FileWithPreview;
    expect(getFileIdentifier(file)).toBe(`photo.jpg_${file.size}`);
  });
});

describe('filesMatch', () => {
  it('returns true when name and size match (filename + fileSize fields)', () => {
    const file = makeFile(2048, 'image/jpeg', 'img.jpg') as FileWithPreview;
    expect(filesMatch(file, { filename: 'img.jpg', fileSize: file.size })).toBe(true);
  });

  it('returns true when name and size match (name + size fields)', () => {
    const file = makeFile(2048, 'image/jpeg', 'img.jpg') as FileWithPreview;
    expect(filesMatch(file, { name: 'img.jpg', size: file.size })).toBe(true);
  });

  it('returns false when names differ', () => {
    const file = makeFile(2048, 'image/jpeg', 'img.jpg') as FileWithPreview;
    expect(filesMatch(file, { name: 'other.jpg', size: file.size })).toBe(false);
  });

  it('returns false when sizes differ', () => {
    const file = makeFile(2048, 'image/jpeg', 'img.jpg') as FileWithPreview;
    expect(filesMatch(file, { name: 'img.jpg', size: 9999 })).toBe(false);
  });
});

describe('validateImageFile', () => {
  it('accepts supported image types', () => {
    const file = makeFile(1024, 'image/jpeg');
    expect(validateImageFile(file).isValid).toBe(true);
  });

  it('accepts image/tiff', () => {
    const file = makeFile(1024, 'image/tiff', 'scan.tiff');
    expect(validateImageFile(file).isValid).toBe(true);
  });

  it('rejects unsupported MIME types', () => {
    const file = makeFile(1024, 'application/pdf', 'doc.pdf');
    const result = validateImageFile(file);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Unsupported file type');
  });

  it('rejects files over 50 MB', () => {
    const big = makeFile(51 * 1024 * 1024, 'image/png', 'huge.png');
    const result = validateImageFile(big);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('too large');
  });
});

describe('cleanupFilePreviewUrls', () => {
  beforeEach(() => {
    URL.revokeObjectURL = vi.fn();
  });

  it('calls URL.revokeObjectURL for files with blob preview URLs', () => {
    const files: FileWithPreview[] = [
      { ...makeFile(100), preview: 'blob:http://localhost/abc' } as FileWithPreview,
    ];
    cleanupFilePreviewUrls(files);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/abc');
  });

  it('does not call revokeObjectURL for files without a preview', () => {
    const files: FileWithPreview[] = [
      { ...makeFile(100), preview: undefined } as FileWithPreview,
    ];
    cleanupFilePreviewUrls(files);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('does not call revokeObjectURL for non-blob preview strings', () => {
    const files: FileWithPreview[] = [
      { ...makeFile(100), preview: 'https://example.com/img.jpg' } as FileWithPreview,
    ];
    cleanupFilePreviewUrls(files);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('handles an empty array without error', () => {
    expect(() => cleanupFilePreviewUrls([])).not.toThrow();
  });
});
