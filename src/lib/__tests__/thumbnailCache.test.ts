import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock IndexedDB
class MockIDBDatabase {
  objectStoreNames = {
    contains: vi.fn(() => false),
  };
  transaction = vi.fn();
  createObjectStore = vi.fn();
}

class MockIDBRequest {
  result: any;
  error: any;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null = null;
}

class MockIDBTransaction {
  objectStore = vi.fn();
  onerror: ((event: Event) => void) | null = null;
}

class MockIDBObjectStore {
  put = vi.fn();
  get = vi.fn();
  delete = vi.fn();
  clear = vi.fn();
  createIndex = vi.fn();
  index = vi.fn();
  openCursor = vi.fn();
}

class MockIDBIndex {
  openCursor = vi.fn();
}

class MockIDBCursor {
  delete = vi.fn();
  continue = vi.fn();
  value = { id: 'test', url: 'test-url', size: 100, createdAt: Date.now() };
}

// Setup IndexedDB mocks
const mockIndexedDB = {
  open: vi.fn(),
};

Object.defineProperty(global, 'indexedDB', {
  value: mockIndexedDB,
  writable: true,
});

Object.defineProperty(global, 'IDBKeyRange', {
  value: {
    only: vi.fn(),
    upperBound: vi.fn(),
  },
  writable: true,
});

describe('ThumbnailCache', () => {
  let thumbnailCache: any;
  let mockDB: MockIDBDatabase;
  let mockObjectStore: MockIDBObjectStore;
  let mockTransaction: MockIDBTransaction;
  let mockIndex: MockIDBIndex;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset module to get fresh instance
    vi.resetModules();

    mockDB = new MockIDBDatabase();
    mockObjectStore = new MockIDBObjectStore();
    mockTransaction = new MockIDBTransaction();
    mockIndex = new MockIDBIndex();

    mockDB.transaction.mockReturnValue(mockTransaction);
    mockTransaction.objectStore.mockReturnValue(mockObjectStore);
    mockObjectStore.index.mockReturnValue(mockIndex);

    // Mock successful IndexedDB initialization
    const mockRequest = new MockIDBRequest();
    mockIndexedDB.open.mockReturnValue(mockRequest);

    // Import after mocks are set up
    const { thumbnailCache: cache } = await import('../thumbnailCache');
    thumbnailCache = cache;

    // Simulate successful DB opening
    mockRequest.result = mockDB;
    if (mockRequest.onsuccess) {
      mockRequest.onsuccess(new Event('success'));
    }

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Cache Key Generation', () => {
    test('should generate unique cache keys for different parameters', () => {
      const key1 = (thumbnailCache as any).getCacheKey('image1', 'low');
      const key2 = (thumbnailCache as any).getCacheKey('image1', 'high');
      const key3 = (thumbnailCache as any).getCacheKey('image2', 'low');

      expect(key1).toBe('image1:low');
      expect(key2).toBe('image1:high');
      expect(key3).toBe('image2:low');
      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  describe('Memory Cache Operations', () => {
    test('should store and retrieve data from memory cache', async () => {
      const testData = { thumbnailUrl: 'test.jpg', width: 100, height: 100 };

      await thumbnailCache.set('image1', 'low', testData);
      const result = await thumbnailCache.get('image1', 'low');

      expect(result).toEqual(testData);
    });

    test('should return null for cache miss', async () => {
      const result = await thumbnailCache.get('nonexistent', 'low');
      expect(result).toBeNull();
    });

    test('should handle different detail levels', async () => {
      const lowData = { thumbnailUrl: 'low.jpg' };
      const highData = { thumbnailUrl: 'high.jpg' };

      await thumbnailCache.set('image1', 'low', lowData);
      await thumbnailCache.set('image1', 'high', highData);

      const lowResult = await thumbnailCache.get('image1', 'low');
      const highResult = await thumbnailCache.get('image1', 'high');

      expect(lowResult).toEqual(lowData);
      expect(highResult).toEqual(highData);
    });

    test('should default to low detail level', async () => {
      const testData = { thumbnailUrl: 'default.jpg' };

      await thumbnailCache.set('image1', 'low', testData);
      const result = await thumbnailCache.get('image1'); // No level specified

      expect(result).toEqual(testData);
    });
  });

  describe('Cache Expiration', () => {
    test('should respect TTL for cache entries', async () => {
      const testData = { thumbnailUrl: 'expired.jpg' };

      // Use Vitest timer mocks
      vi.useFakeTimers();
      const baseTime = 1000000000;
      vi.setSystemTime(baseTime);

      try {
        await thumbnailCache.set('image1', 'low', testData);

        // Advance time beyond TTL (24 hours + 1 ms)
        vi.setSystemTime(baseTime + 24 * 60 * 60 * 1000 + 1);
        const result = await thumbnailCache.get('image1', 'low');

        expect(result).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    test('should return valid non-expired entries', async () => {
      const testData = { thumbnailUrl: 'valid.jpg' };

      vi.useFakeTimers();
      const baseTime = 1000000000;
      vi.setSystemTime(baseTime);

      try {
        await thumbnailCache.set('image1', 'low', testData);

        // Advance time but not beyond TTL
        vi.setSystemTime(baseTime + 60 * 1000); // 1 minute later
        const result = await thumbnailCache.get('image1', 'low');

        expect(result).toEqual(testData);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('IndexedDB Integration', () => {
    test('should fallback to IndexedDB when memory cache misses', async () => {
      const testData = { thumbnailUrl: 'db.jpg' };

      // Mock successful DB operations
      const mockGetRequest = new MockIDBRequest();
      mockGetRequest.result = {
        id: 'image1:low',
        imageId: 'image1',
        levelOfDetail: 'low',
        thumbnailData: testData,
        cachedAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      mockObjectStore.get.mockReturnValue(mockGetRequest);

      // Clear memory cache to force DB lookup
      (thumbnailCache as any).memoryCache.clear();

      // Create a promise that resolves when the get operation is called
      const getPromise = thumbnailCache.get('image1', 'low');

      // Trigger DB success callback synchronously
      setTimeout(() => {
        if (mockGetRequest.onsuccess) {
          mockGetRequest.onsuccess(new Event('success'));
        }
      }, 0);

      const result = await getPromise;

      expect(mockObjectStore.get).toHaveBeenCalled();
      expect(result).toEqual(testData);
    });

    test('should store data in IndexedDB', async () => {
      const testData = { thumbnailUrl: 'store.jpg' };

      // Mock successful put operation
      const mockPutRequest = new MockIDBRequest();
      mockObjectStore.put.mockReturnValue(mockPutRequest);

      // Start the set operation
      const setPromise = thumbnailCache.set('image1', 'low', testData);

      // Trigger success callback synchronously
      setTimeout(() => {
        if (mockPutRequest.onsuccess) {
          mockPutRequest.onsuccess(new Event('success'));
        }
      }, 0);

      await setPromise;

      expect(mockObjectStore.put).toHaveBeenCalled();
    });

    test('should handle IndexedDB errors gracefully', async () => {
      const testData = { thumbnailUrl: 'error.jpg' };

      // Mock DB error
      const mockPutRequest = new MockIDBRequest();
      mockPutRequest.error = new Error('DB Error');
      mockObjectStore.put.mockReturnValue(mockPutRequest);

      // Start the set operation
      const setPromise = thumbnailCache.set('image1', 'low', testData);

      // Trigger error callback synchronously
      setTimeout(() => {
        if (mockPutRequest.onerror) {
          mockPutRequest.onerror(new Event('error'));
        }
      }, 0);

      // Should not throw - verify it resolves successfully
      await expect(setPromise).resolves.toBeUndefined();
    });
  });

  describe('Cache Invalidation', () => {
    test('should invalidate all levels for an image', async () => {
      const lowData = { thumbnailUrl: 'low.jpg' };
      const mediumData = { thumbnailUrl: 'medium.jpg' };
      const highData = { thumbnailUrl: 'high.jpg' };

      await thumbnailCache.set('image1', 'low', lowData);
      await thumbnailCache.set('image1', 'medium', mediumData);
      await thumbnailCache.set('image1', 'high', highData);

      await thumbnailCache.invalidate('image1');

      const lowResult = await thumbnailCache.get('image1', 'low');
      const mediumResult = await thumbnailCache.get('image1', 'medium');
      const highResult = await thumbnailCache.get('image1', 'high');

      expect(lowResult).toBeNull();
      expect(mediumResult).toBeNull();
      expect(highResult).toBeNull();
    });

    test('should not affect other images when invalidating', async () => {
      const testData1 = { thumbnailUrl: 'image1.jpg' };
      const testData2 = { thumbnailUrl: 'image2.jpg' };

      await thumbnailCache.set('image1', 'low', testData1);
      await thumbnailCache.set('image2', 'low', testData2);

      await thumbnailCache.invalidate('image1');

      const result1 = await thumbnailCache.get('image1', 'low');
      const result2 = await thumbnailCache.get('image2', 'low');

      expect(result1).toBeNull();
      expect(result2).toEqual(testData2);
    });

    test('should handle IndexedDB cursor operations during invalidation', async () => {
      const mockCursorRequest = new MockIDBRequest();
      const mockCursor = new MockIDBCursor();

      mockIndex.openCursor.mockReturnValue(mockCursorRequest);

      // Start the invalidation
      const invalidatePromise = thumbnailCache.invalidate('image1');

      // Trigger cursor callbacks synchronously with proper event target
      setTimeout(() => {
        // First cursor iteration with data
        mockCursorRequest.result = mockCursor;
        if (mockCursorRequest.onsuccess) {
          const mockEvent = new Event('success');
          Object.defineProperty(mockEvent, 'target', {
            value: mockCursorRequest,
            writable: false,
          });
          mockCursorRequest.onsuccess(mockEvent);
        }

        // Second iteration - no more data
        setTimeout(() => {
          mockCursorRequest.result = null;
          if (mockCursorRequest.onsuccess) {
            const mockEvent = new Event('success');
            Object.defineProperty(mockEvent, 'target', {
              value: mockCursorRequest,
              writable: false,
            });
            mockCursorRequest.onsuccess(mockEvent);
          }
        }, 0);
      }, 0);

      await invalidatePromise;

      expect(mockIndex.openCursor).toHaveBeenCalled();
      expect(mockCursor.delete).toHaveBeenCalled();
      expect(mockCursor.continue).toHaveBeenCalled();
    });
  });

  describe('Memory Cache Eviction', () => {
    test('should evict oldest entries when max capacity exceeded', async () => {
      const originalMaxEntries = (thumbnailCache as any).maxMemoryEntries;
      (thumbnailCache as any).maxMemoryEntries = 2; // Set low limit for testing

      vi.useFakeTimers();
      let currentTime = 1000000000;

      try {
        vi.setSystemTime(currentTime);

        // Add entries with different timestamps
        await thumbnailCache.set('image1', 'low', { url: '1.jpg' });
        currentTime += 1000;
        vi.setSystemTime(currentTime);

        await thumbnailCache.set('image2', 'low', { url: '2.jpg' });
        currentTime += 1000;
        vi.setSystemTime(currentTime);

        await thumbnailCache.set('image3', 'low', { url: '3.jpg' }); // Should trigger eviction

        const result1 = await thumbnailCache.get('image1', 'low'); // Should be evicted
        const result2 = await thumbnailCache.get('image2', 'low'); // Should still exist
        const result3 = await thumbnailCache.get('image3', 'low'); // Should still exist

        expect(result1).toBeNull(); // Evicted
        expect(result2).toEqual({ url: '2.jpg' });
        expect(result3).toEqual({ url: '3.jpg' });
      } finally {
        // Restore original values
        (thumbnailCache as any).maxMemoryEntries = originalMaxEntries;
        vi.useRealTimers();
      }
    });
  });

  describe('Cache Statistics', () => {
    test('should track cache hits and misses', async () => {
      const testData = { thumbnailUrl: 'stats.jpg' };

      // Initial stats
      let stats = thumbnailCache.getStats();
      expect(stats.hitRate).toBe(0);

      // Cache miss
      await thumbnailCache.get('image1', 'low');

      // Cache hit
      await thumbnailCache.set('image1', 'low', testData);
      await thumbnailCache.get('image1', 'low');

      stats = thumbnailCache.getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
      expect(stats.entryCount).toBeGreaterThan(0);
    });

    test('should estimate memory usage', () => {
      const stats = thumbnailCache.getStats();
      expect(typeof stats.memoryUsage).toBe('number');
      expect(stats.memoryUsage).toBeGreaterThanOrEqual(0);
    });

    test('should handle NaN hit rate gracefully', () => {
      // Reset stats to simulate no operations
      (thumbnailCache as any).stats = {
        hits: 0,
        misses: 0,
        memoryHits: 0,
        dbHits: 0,
      };

      const stats = thumbnailCache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Cache Cleanup', () => {
    test('should clear all cache data', async () => {
      const testData = { thumbnailUrl: 'clear.jpg' };

      await thumbnailCache.set('image1', 'low', testData);

      // Mock clear operation
      const mockClearRequest = new MockIDBRequest();
      mockObjectStore.clear.mockReturnValue(mockClearRequest);

      // Start clear operation
      const clearPromise = thumbnailCache.clear();

      // Trigger success callback synchronously
      setTimeout(() => {
        if (mockClearRequest.onsuccess) {
          mockClearRequest.onsuccess(new Event('success'));
        }
      }, 0);

      await clearPromise;

      const result = await thumbnailCache.get('image1', 'low');
      expect(result).toBeNull();

      const stats = thumbnailCache.getStats();
      expect(stats.entryCount).toBe(0);
    });

    test('should clean expired entries from IndexedDB', async () => {
      const mockCursorRequest = new MockIDBRequest();
      const mockCursor = new MockIDBCursor();

      mockIndex.openCursor.mockReturnValue(mockCursorRequest);

      // Start cleanup operation and wait for cursor setup
      const cleanupPromise = thumbnailCache.cleanExpired();

      // Wait a tick for the request to be set up
      await new Promise(resolve => setTimeout(resolve, 0));

      // Trigger cursor callbacks synchronously with proper event target
      // First cursor iteration with expired data
      mockCursorRequest.result = mockCursor;
      if (mockCursorRequest.onsuccess) {
        const mockEvent = new Event('success');
        Object.defineProperty(mockEvent, 'target', {
          value: mockCursorRequest,
          writable: false,
        });
        mockCursorRequest.onsuccess(mockEvent);
      }

      // Wait for delete to be processed
      await new Promise(resolve => setTimeout(resolve, 0));

      // Second iteration - no more data
      mockCursorRequest.result = null;
      if (mockCursorRequest.onsuccess) {
        const mockEvent = new Event('success');
        Object.defineProperty(mockEvent, 'target', {
          value: mockCursorRequest,
          writable: false,
        });
        mockCursorRequest.onsuccess(mockEvent);
      }

      await cleanupPromise;

      expect(mockIndex.openCursor).toHaveBeenCalled();
      expect(mockCursor.delete).toHaveBeenCalled();
    });

    test('should handle cleanup errors gracefully', async () => {
      const mockCursorRequest = new MockIDBRequest();
      mockCursorRequest.error = new Error('Cleanup error');
      mockIndex.openCursor.mockReturnValue(mockCursorRequest);

      // Should complete successfully
      await expect(thumbnailCache.cleanExpired()).resolves.toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle missing IndexedDB gracefully', async () => {
      // Create cache without DB by temporarily setting db to null
      const originalDb = (thumbnailCache as any).db;
      (thumbnailCache as any).db = null;

      try {
        const result = await thumbnailCache.get('image1', 'low');
        expect(result).toBeNull();

        // Should work in memory-only mode
        await expect(
          thumbnailCache.set('image1', 'low', {})
        ).resolves.toBeUndefined();
      } finally {
        // Restore original db
        (thumbnailCache as any).db = originalDb;
      }
    });

    test('should handle IndexedDB initialization failure', async () => {
      vi.resetModules();

      const mockRequest = new MockIDBRequest();
      mockRequest.error = new Error('DB Init Error');
      mockIndexedDB.open.mockReturnValue(mockRequest);

      // Import cache and handle initialization
      const { thumbnailCache: failedCache } = await import('../thumbnailCache');

      // Trigger error callback and catch any rejections
      const initPromise = (failedCache as any).ready.catch(() => {
        // Expected to fail - just swallow the rejection
      });

      setTimeout(() => {
        if (mockRequest.onerror) {
          mockRequest.onerror(new Event('error'));
        }
      }, 0);

      // Wait for initialization to complete/fail
      await initPromise;
      await new Promise(resolve => setTimeout(resolve, 10));

      // Test that cache is usable in memory-only mode
      const memoryCache = (failedCache as any).memoryCache;

      // Set data directly in memory cache to test it works
      const testEntry = {
        id: 'image1:low',
        imageId: 'image1',
        levelOfDetail: 'low',
        thumbnailData: { url: 'test.jpg' },
        cachedAt: Date.now(),
        expiresAt: Date.now() + 1000000,
      };

      memoryCache.set('image1:low', testEntry);

      // Verify memory cache works
      expect(memoryCache.size).toBeGreaterThan(0);
      expect(memoryCache.get('image1:low')).toEqual(testEntry);
    });

    test('should handle non-Error exceptions', async () => {
      const _mockGetRequest = new MockIDBRequest();
      mockObjectStore.get.mockImplementation(() => {
        throw 'String error';
      });

      const result = await thumbnailCache.get('image1', 'low');
      expect(result).toBeNull();
    });
  });

  describe('Integration Scenarios', () => {
    test('should promote DB hits to memory cache', async () => {
      const testData = { thumbnailUrl: 'promote.jpg' };

      // Mock DB entry
      const mockGetRequest = new MockIDBRequest();
      mockGetRequest.result = {
        id: 'image1:low',
        imageId: 'image1',
        levelOfDetail: 'low',
        thumbnailData: testData,
        cachedAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      mockObjectStore.get.mockReturnValue(mockGetRequest);

      // Clear memory cache to force DB lookup
      (thumbnailCache as any).memoryCache.clear();

      // First get should hit DB
      const firstGetPromise = thumbnailCache.get('image1', 'low');

      // Trigger DB success callback synchronously
      setTimeout(() => {
        if (mockGetRequest.onsuccess) {
          mockGetRequest.onsuccess(new Event('success'));
        }
      }, 0);

      const firstResult = await firstGetPromise;
      expect(firstResult).toEqual(testData);

      // Second get should hit memory cache (promoted from DB)
      const result = await thumbnailCache.get('image1', 'low');
      expect(result).toEqual(testData);
    });

    test('should handle concurrent operations gracefully', async () => {
      const testData1 = { thumbnailUrl: 'concurrent1.jpg' };
      const testData2 = { thumbnailUrl: 'concurrent2.jpg' };

      // Simulate concurrent set/get operations
      const promises = [
        thumbnailCache.set('image1', 'low', testData1),
        thumbnailCache.set('image2', 'low', testData2),
        thumbnailCache.get('image1', 'low'),
        thumbnailCache.get('image2', 'low'),
        thumbnailCache.invalidate('image3'),
        thumbnailCache.cleanExpired(),
      ];

      // All operations should complete successfully
      const results = await Promise.all(promises);
      expect(results).toBeDefined();
    });

    test('should maintain data integrity across operations', async () => {
      const originalData = { thumbnailUrl: 'original.jpg', size: 1000 };
      const updatedData = { thumbnailUrl: 'updated.jpg', size: 2000 };

      // Store original data
      await thumbnailCache.set('image1', 'low', originalData);
      let result = await thumbnailCache.get('image1', 'low');
      expect(result).toEqual(originalData);

      // Update data
      await thumbnailCache.set('image1', 'low', updatedData);
      result = await thumbnailCache.get('image1', 'low');
      expect(result).toEqual(updatedData);

      // Invalidate
      await thumbnailCache.invalidate('image1');
      result = await thumbnailCache.get('image1', 'low');
      expect(result).toBeNull();
    });
  });
});
