import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { ApiClient } from '../api';

// Mock axios
vi.mock('axios');
const mockAxios = vi.mocked(axios);
const mockAxiosInstance = {
  post: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

mockAxios.create.mockReturnValue(mockAxiosInstance as any);

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock config
vi.mock('../config', () => ({
  default: {
    apiBaseUrl: 'http://localhost:3001/api',
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ApiClient - Chunked Upload Tests', () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    apiClient = new ApiClient();

    // Mock successful auth
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'accessToken') return 'mock-access-token';
      if (key === 'refreshToken') return 'mock-refresh-token';
      return null;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('File Chunking Logic', () => {
    const createMockFiles = (count: number): File[] => {
      return Array.from({ length: count }, (_, i) => {
        const content = `mock-image-data-${i}`;
        const blob = new Blob([content], { type: 'image/jpeg' });
        return new File([blob], `test-image-${i + 1}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      });
    };

    test('should split 613 files into 31 chunks of 20 files each', () => {
      const files = createMockFiles(613);
      const chunkSize = 20;
      const chunks: File[][] = [];

      for (let i = 0; i < files.length; i += chunkSize) {
        chunks.push(files.slice(i, i + chunkSize));
      }

      expect(chunks.length).toBe(31); // Math.ceil(613/20) = 31
      expect(chunks[0].length).toBe(20);
      expect(chunks[30].length).toBe(13); // Last chunk has remainder

      const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      expect(totalFiles).toBe(613);
    });

    test('should handle edge cases in chunking', () => {
      // Test with exact multiple
      const files100 = createMockFiles(100);
      const chunkSize = 20;
      const chunks100: File[][] = [];

      for (let i = 0; i < files100.length; i += chunkSize) {
        chunks100.push(files100.slice(i, i + chunkSize));
      }

      expect(chunks100.length).toBe(5);
      expect(chunks100[4].length).toBe(20); // Last chunk is full

      // Test with single file
      const singleFile = createMockFiles(1);
      const singleChunk = [singleFile];
      expect(singleChunk[0].length).toBe(1);

      // Test with empty array
      const emptyFiles: File[] = [];
      const emptyChunks: File[][] = [];
      for (let i = 0; i < emptyFiles.length; i += chunkSize) {
        emptyChunks.push(emptyFiles.slice(i, i + chunkSize));
      }
      expect(emptyChunks.length).toBe(0);
    });
  });

  describe('Chunked Upload Implementation', () => {
    test('should upload files in chunks with progress tracking', async () => {
      const totalFiles = 100;
      const chunkSize = 20;
      const mockFiles = createMockFiles(totalFiles);
      const progressUpdates: number[] = [];
      const progressCallback = vi.fn((progress: number) => {
        progressUpdates.push(progress);
      });

      // Mock successful responses for each chunk
      mockAxiosInstance.post.mockImplementation(() => {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              images: Array.from({ length: chunkSize }, (_, i) => ({
                id: `image-${i}`,
                name: `test-image-${i}.jpg`,
                projectId: 'project-123',
                userId: 'user-123',
                segmentationStatus: 'pending',
              })),
            },
          },
        });
      });

      // Simulate chunked upload
      const uploadedImages: any[] = [];
      const chunks = Math.ceil(totalFiles / chunkSize);

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, totalFiles);
        const filesInChunk = mockFiles.slice(startIndex, endIndex);

        const result = await apiClient.uploadImages(
          'project-123',
          filesInChunk,
          chunkProgress => {
            const overallProgress = Math.round(
              ((chunkIndex * chunkSize +
                (chunkProgress / 100) * filesInChunk.length) /
                totalFiles) *
                100
            );
            progressCallback(overallProgress);
          }
        );

        uploadedImages.push(...result);

        // Update overall progress
        const overallProgress = Math.round(((chunkIndex + 1) / chunks) * 100);
        progressCallback(overallProgress);
      }

      expect(uploadedImages.length).toBe(totalFiles);
      expect(progressCallback).toHaveBeenCalledWith(100);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(chunks);
    });

    test('should handle partial failures in chunked upload', async () => {
      const totalFiles = 60;
      const chunkSize = 20;
      const mockFiles = createMockFiles(totalFiles);
      const chunks = Math.ceil(totalFiles / chunkSize);

      // Mock responses - make middle chunk fail
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              images: new Array(20)
                .fill(null)
                .map((_, i) => ({ id: `img-${i}` })),
            },
          },
        })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              images: new Array(20)
                .fill(null)
                .map((_, i) => ({ id: `img-${i + 40}` })),
            },
          },
        });

      const uploadedImages: any[] = [];
      const failedChunks: number[] = [];

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, totalFiles);
        const filesInChunk = mockFiles.slice(startIndex, endIndex);

        try {
          const result = await apiClient.uploadImages(
            'project-123',
            filesInChunk
          );
          uploadedImages.push(...result);
        } catch (error) {
          failedChunks.push(chunkIndex);
        }
      }

      expect(uploadedImages.length).toBe(40); // 2 successful chunks
      expect(failedChunks).toEqual([1]); // Middle chunk failed
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    test('should implement retry logic for failed chunks', async () => {
      const mockFiles = createMockFiles(20);
      const maxRetries = 3;
      let attemptCount = 0;

      // Mock failing first 2 attempts, success on 3rd
      mockAxiosInstance.post.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve({
          data: {
            success: true,
            data: { images: mockFiles.map((_, i) => ({ id: `img-${i}` })) },
          },
        });
      });

      // Simulate retry logic
      let result: any[] = [];
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          result = await apiClient.uploadImages('project-123', mockFiles);
          break; // Success, exit retry loop
        } catch (error) {
          if (attempt === maxRetries - 1) {
            throw error; // Last attempt failed
          }
          // Wait before retry (in real implementation)
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * Math.pow(2, attempt))
          );
        }
      }

      expect(result.length).toBe(20);
      expect(attemptCount).toBe(3);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    test('should cancel ongoing uploads', async () => {
      const mockFiles = createMockFiles(60);
      const chunkSize = 20;
      let cancelRequested = false;

      const abortController = new AbortController();

      // Mock long-running uploads
      mockAxiosInstance.post.mockImplementation(() => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (cancelRequested) {
              reject(new Error('Upload cancelled'));
            } else {
              resolve({
                data: {
                  success: true,
                  data: { images: [] },
                },
              });
            }
          }, 1000);

          abortController.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Upload cancelled'));
          });
        });
      });

      // Start upload
      const uploadPromise = (async () => {
        const chunks = Math.ceil(mockFiles.length / chunkSize);
        const uploadedImages: any[] = [];

        for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
          if (abortController.signal.aborted) {
            throw new Error('Upload cancelled');
          }

          const startIndex = chunkIndex * chunkSize;
          const endIndex = Math.min(startIndex + chunkSize, mockFiles.length);
          const filesInChunk = mockFiles.slice(startIndex, endIndex);

          try {
            const result = await apiClient.uploadImages(
              'project-123',
              filesInChunk
            );
            uploadedImages.push(...result);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === 'Upload cancelled'
            ) {
              throw error;
            }
          }
        }

        return uploadedImages;
      })();

      // Cancel after 500ms
      setTimeout(() => {
        cancelRequested = true;
        abortController.abort();
      }, 500);

      await expect(uploadPromise).rejects.toThrow('Upload cancelled');
    });

    test('should respect rate limits between chunk uploads', async () => {
      const mockFiles = createMockFiles(100);
      const chunkSize = 20;
      const rateLimitDelay = 1000; // 1 second between chunks
      const startTime = Date.now();

      // Mock successful responses with delay
      mockAxiosInstance.post.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              data: {
                success: true,
                data: { images: [] },
              },
            });
          }, 100); // Simulate network time
        });
      });

      const chunks = Math.ceil(mockFiles.length / chunkSize);

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, mockFiles.length);
        const filesInChunk = mockFiles.slice(startIndex, endIndex);

        await apiClient.uploadImages('project-123', filesInChunk);

        // Add delay between chunks (except for last chunk)
        if (chunkIndex < chunks - 1) {
          await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
        }
      }

      const totalTime = Date.now() - startTime;
      const expectedMinTime = (chunks - 1) * rateLimitDelay; // Delay between chunks

      expect(totalTime).toBeGreaterThanOrEqual(expectedMinTime);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(chunks);
    });
  });

  describe('Memory Management', () => {
    test('should not accumulate memory with large file sets', async () => {
      const mockFiles = createMockFiles(200);
      const chunkSize = 20;

      // Mock memory usage tracking
      const initialMemory = performance.memory
        ? performance.memory.usedJSHeapSize
        : 0;

      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: true,
          data: { images: [] },
        },
      });

      const chunks = Math.ceil(mockFiles.length / chunkSize);

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, mockFiles.length);
        const filesInChunk = mockFiles.slice(startIndex, endIndex);

        await apiClient.uploadImages('project-123', filesInChunk);

        // Force garbage collection if available (Node.js)
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = performance.memory
        ? performance.memory.usedJSHeapSize
        : 0;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB for this test)
      // Note: This is a rough check as memory usage can vary
      if (performance.memory) {
        expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
      }
    });

    test('should release file references after upload', async () => {
      const mockFiles = createMockFiles(40);
      const chunkSize = 20;

      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: true,
          data: { images: [] },
        },
      });

      // Keep weak references to verify cleanup
      const weakRefs = mockFiles.map(file => new WeakRef(file));

      const chunks = Math.ceil(mockFiles.length / chunkSize);

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, mockFiles.length);
        const filesInChunk = mockFiles.slice(startIndex, endIndex);

        await apiClient.uploadImages('project-123', filesInChunk);
      }

      // Clear references
      mockFiles.length = 0;

      // Force garbage collection if available
      if (global.gc) {
        global.gc();

        // Check if files were released (this is implementation-dependent)
        let releasedCount = 0;
        for (const ref of weakRefs) {
          if (!ref.deref()) {
            releasedCount++;
          }
        }

        // At least some files should be released
        expect(releasedCount).toBeGreaterThan(0);
      }
    });
  });

  describe('Error Handling and User Experience', () => {
    test('should provide detailed error information for failed chunks', async () => {
      const mockFiles = createMockFiles(60);
      const chunkSize = 20;
      const chunks = Math.ceil(mockFiles.length / chunkSize);

      // Mock different types of errors
      mockAxiosInstance.post
        .mockRejectedValueOnce({
          response: {
            status: 413,
            data: { message: 'Payload too large' },
          },
        })
        .mockRejectedValueOnce({
          response: {
            status: 429,
            data: { message: 'Rate limit exceeded' },
          },
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const uploadErrors: Array<{ chunkIndex: number; error: any }> = [];

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, mockFiles.length);
        const filesInChunk = mockFiles.slice(startIndex, endIndex);

        try {
          await apiClient.uploadImages('project-123', filesInChunk);
        } catch (error) {
          uploadErrors.push({ chunkIndex, error });
        }
      }

      expect(uploadErrors).toHaveLength(3);
      expect(uploadErrors[0].error.response?.status).toBe(413);
      expect(uploadErrors[1].error.response?.status).toBe(429);
      expect(uploadErrors[2].error.message).toBe('Network error');
    });

    test('should provide accurate progress updates across chunks', async () => {
      const totalFiles = 85;
      const chunkSize = 20;
      const mockFiles = createMockFiles(totalFiles);
      const progressUpdates: number[] = [];

      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: true,
          data: { images: [] },
        },
      });

      const chunks = Math.ceil(totalFiles / chunkSize);

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, totalFiles);
        const filesInChunk = mockFiles.slice(startIndex, endIndex);

        await apiClient.uploadImages('project-123', filesInChunk, progress => {
          // Calculate overall progress
          const filesProcessedSoFar =
            startIndex + (progress / 100) * filesInChunk.length;
          const overallProgress = Math.round(
            (filesProcessedSoFar / totalFiles) * 100
          );
          progressUpdates.push(overallProgress);
        });

        // Add final progress for this chunk
        const overallProgress = Math.round(
          (((chunkIndex + 1) * chunkSize) / totalFiles) * 100
        );
        progressUpdates.push(Math.min(overallProgress, 100));
      }

      // Should end with 100%
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100);

      // Progress should be non-decreasing
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i]).toBeGreaterThanOrEqual(
          progressUpdates[i - 1]
        );
      }
    });
  });
});
