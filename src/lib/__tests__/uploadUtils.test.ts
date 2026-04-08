import { describe, it, expect } from 'vitest';
import {
  chunkFiles,
  calculateOptimalChunkSize,
  processChunksWithConcurrency,
  estimateUploadTime,
  validateFiles,
  formatFileSize,
  formatUploadSpeed,
  DEFAULT_CHUNKING_CONFIG,
  type ChunkingConfig,
} from '@/lib/uploadUtils';

vi.mock('@/lib/retryUtils', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/uploadConfig', () => ({
  default: {
    FILES_PER_CHUNK: 100,
    MAX_CONCURRENT_CHUNKS: 3,
    RETRY_ATTEMPTS: 5,
    RETRY_DELAY_MS: 2000,
    MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024,
    MAX_SIZE_PER_CHUNK_BYTES: 500 * 1024 * 1024,
    SUPPORTED_FILE_TYPES: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/tiff',
      'image/tif',
      'image/bmp',
    ],
  },
}));

const makeFile = (
  sizeBytes: number,
  type = 'image/jpeg',
  name = 'img.jpg'
): File => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes, configurable: true });
  return f;
};

const testConfig: ChunkingConfig = {
  chunkSize: 5,
  maxConcurrentChunks: 2,
  retryAttempts: 1,
  retryDelayMs: 0,
};

describe('chunkFiles', () => {
  it('splits files into chunks of the given size', () => {
    const files = Array.from({ length: 11 }, (_, i) =>
      makeFile(100, 'image/jpeg', `f${i}.jpg`)
    );
    const chunks = chunkFiles(files, 5);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(5);
    expect(chunks[1]).toHaveLength(5);
    expect(chunks[2]).toHaveLength(1);
  });

  it('returns a single chunk when files count equals chunk size', () => {
    const files = Array.from({ length: 5 }, (_, i) =>
      makeFile(100, 'image/jpeg', `f${i}.jpg`)
    );
    const chunks = chunkFiles(files, 5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(5);
  });

  it('returns a single chunk when files count is less than chunk size', () => {
    const files = [makeFile(100)];
    const chunks = chunkFiles(files, 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });

  it('returns an empty array for an empty input', () => {
    expect(chunkFiles([], 5)).toEqual([]);
  });
});

describe('calculateOptimalChunkSize', () => {
  it('returns totalFiles when it is less than or equal to chunkSize', () => {
    expect(calculateOptimalChunkSize(3, testConfig)).toBe(3);
  });

  it('returns at most chunkSize when totalFiles exceeds chunkSize', () => {
    const result = calculateOptimalChunkSize(100, testConfig);
    expect(result).toBeLessThanOrEqual(testConfig.chunkSize);
  });

  it('never returns less than 1', () => {
    expect(calculateOptimalChunkSize(1, testConfig)).toBeGreaterThanOrEqual(1);
  });

  it('uses DEFAULT_CHUNKING_CONFIG when no config is provided', () => {
    const result = calculateOptimalChunkSize(DEFAULT_CHUNKING_CONFIG.chunkSize);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(DEFAULT_CHUNKING_CONFIG.chunkSize);
  });
});

describe('processChunksWithConcurrency', () => {
  it('processes all chunks and collects successful results', async () => {
    const files = Array.from({ length: 6 }, (_, i) =>
      makeFile(100, 'image/jpeg', `f${i}.jpg`)
    );
    const chunks = chunkFiles(files, 2);
    const processor = vi.fn().mockResolvedValue('ok');

    const result = await processChunksWithConcurrency(
      chunks,
      processor,
      testConfig
    );

    expect(result.success).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.totalProcessed).toBe(6);
  });

  it('retries a failing chunk and records it as failed after exhausting attempts', async () => {
    const files = Array.from({ length: 2 }, (_, i) =>
      makeFile(100, 'image/jpeg', `f${i}.jpg`)
    );
    const chunks = chunkFiles(files, 2);
    const processor = vi.fn().mockRejectedValue(new Error('network error'));

    const config: ChunkingConfig = { ...testConfig, retryAttempts: 2 };
    const result = await processChunksWithConcurrency(
      chunks,
      processor,
      config
    );

    expect(result.failed).toHaveLength(1);
    expect(result.success).toHaveLength(0);
    // Called 1 (initial) + 2 (retries) = 3 times total
    expect(processor).toHaveBeenCalledTimes(3);
  });

  it('calls onProgress callback during processing', async () => {
    const files = [makeFile(100)];
    const chunks = chunkFiles(files, 1);
    const processor = vi.fn().mockResolvedValue('ok');
    const onProgress = vi.fn();

    await processChunksWithConcurrency(
      chunks,
      processor,
      testConfig,
      onProgress
    );

    expect(onProgress).toHaveBeenCalled();
  });

  it('handles empty chunks array without error', async () => {
    const processor = vi.fn().mockResolvedValue('ok');
    const result = await processChunksWithConcurrency(
      [],
      processor,
      testConfig
    );

    expect(result.success).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(result.totalProcessed).toBe(0);
  });
});

describe('estimateUploadTime', () => {
  it('returns minimum 30 seconds for tiny files at default speed', () => {
    const tiny = [makeFile(100)];
    expect(estimateUploadTime(tiny)).toBe(30);
  });

  it('returns a time proportional to total size and speed', () => {
    // 100MB at 10 Mbps = 10 seconds, but minimum is 30s
    const files = [makeFile(100 * 1024 * 1024)];
    const time = estimateUploadTime(files, 10);
    expect(time).toBe(30); // still minimum
  });

  it('returns calculated time when it exceeds the 30-second minimum', () => {
    // 1000MB at 10 Mbps = 100 seconds
    const files = [makeFile(1000 * 1024 * 1024)];
    const time = estimateUploadTime(files, 10);
    expect(time).toBeCloseTo(100, 0);
  });
});

describe('validateFiles', () => {
  it('accepts files within size and type limits', () => {
    const file = makeFile(1024, 'image/jpeg');
    const { valid, invalid } = validateFiles(
      [file],
      20 * 1024 * 1024,
      500 * 1024 * 1024,
      ['image/jpeg']
    );
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(0);
  });

  it('rejects files that exceed the individual size limit', () => {
    const big = makeFile(21 * 1024 * 1024, 'image/jpeg');
    const { valid, invalid } = validateFiles(
      [big],
      20 * 1024 * 1024,
      500 * 1024 * 1024,
      ['image/jpeg']
    );
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].reason).toContain('too large');
  });

  it('rejects files with unsupported MIME types', () => {
    const pdf = makeFile(100, 'application/pdf', 'doc.pdf');
    const { valid, invalid } = validateFiles(
      [pdf],
      20 * 1024 * 1024,
      500 * 1024 * 1024,
      ['image/jpeg']
    );
    expect(valid).toHaveLength(0);
    expect(invalid[0].reason).toContain('Unsupported file type');
  });
});

describe('formatFileSize', () => {
  it('formats zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512.0 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});

describe('formatUploadSpeed', () => {
  it('formats speeds below 1 Mbps as Kbps', () => {
    // 64 KB/s = 0.5 Mbps → should show as Kbps
    const kbps = formatUploadSpeed(64 * 1024);
    expect(kbps).toContain('Kbps');
  });

  it('formats speeds of 1 Mbps and above as Mbps', () => {
    // 1.25 MB/s = 10 Mbps
    const mbps = formatUploadSpeed(1.25 * 1024 * 1024);
    expect(mbps).toContain('Mbps');
  });

  it('produces a numeric value in the result', () => {
    const result = formatUploadSpeed(2 * 1024 * 1024);
    const numeric = parseFloat(result);
    expect(numeric).toBeGreaterThan(0);
  });
});
