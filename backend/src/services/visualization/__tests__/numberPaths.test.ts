import { NUMBER_PATHS } from '../numberPaths';
import { createCanvas } from 'canvas';

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}));

describe('NumberPaths Caching System', () => {
  beforeEach(() => {
    // Clear cache before each test
    NUMBER_PATHS.clearCache();
    jest.clearAllMocks();
  });

  describe('Cache Functionality', () => {
    it('should cache single digit renders', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // First render - should miss cache
      NUMBER_PATHS.drawDigit(ctx, 5, 100, 100, 32);
      let stats = NUMBER_PATHS.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
      expect(stats.size).toBe(1);
      
      // Second render of same digit/size - should hit cache
      NUMBER_PATHS.drawDigit(ctx, 5, 100, 100, 32);
      stats = NUMBER_PATHS.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.5);
    });

    it('should round size to improve cache hits', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // These should all use the same cache entry (rounded to 32)
      NUMBER_PATHS.drawDigit(ctx, 7, 100, 100, 31.6);
      NUMBER_PATHS.drawDigit(ctx, 7, 100, 100, 32.2);
      NUMBER_PATHS.drawDigit(ctx, 7, 100, 100, 32.4);
      
      const stats = NUMBER_PATHS.getCacheStats();
      expect(stats.size).toBe(1); // Only one cache entry
      expect(stats.hits).toBe(2); // Two cache hits
      expect(stats.misses).toBe(1); // One cache miss (first render)
    });

    it('should cache multi-digit numbers', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Render a two-digit number
      NUMBER_PATHS.drawLargeNumber(ctx, 42, 100, 100, 32);
      let stats = NUMBER_PATHS.getCacheStats();
      const initialMisses = stats.misses;
      
      // Render same number again
      NUMBER_PATHS.drawLargeNumber(ctx, 42, 100, 100, 32);
      stats = NUMBER_PATHS.getCacheStats();
      
      // For two-digit numbers, individual digits are cached
      // So we should see cache hits for the digits 4 and 2
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should implement LRU eviction when cache is full', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Fill cache to maximum (100 entries)
      for (let i = 0; i < 105; i++) {
        NUMBER_PATHS.drawDigit(ctx, i % 10, 100, 100, 10 + i);
      }
      
      const stats = NUMBER_PATHS.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(100); // Cache size limit
    });

    it('should track cache hit rate accurately', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Create a pattern of hits and misses
      NUMBER_PATHS.drawDigit(ctx, 1, 100, 100, 20); // Miss
      NUMBER_PATHS.drawDigit(ctx, 1, 100, 100, 20); // Hit
      NUMBER_PATHS.drawDigit(ctx, 1, 100, 100, 20); // Hit
      NUMBER_PATHS.drawDigit(ctx, 2, 100, 100, 20); // Miss
      NUMBER_PATHS.drawDigit(ctx, 2, 100, 100, 20); // Hit
      
      const stats = NUMBER_PATHS.getCacheStats();
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(0.6); // 3/5 = 0.6
    });
  });

  describe('Operation Recording', () => {
    it('should correctly record and replay canvas operations', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Spy on canvas methods
      const beginPathSpy = jest.spyOn(ctx, 'beginPath');
      const moveToSpy = jest.spyOn(ctx, 'moveTo');
      const lineToSpy = jest.spyOn(ctx, 'lineTo');
      const strokeSpy = jest.spyOn(ctx, 'stroke');
      
      // Draw digit 1 (simple vertical line)
      NUMBER_PATHS.drawDigit(ctx, 1, 100, 100, 32);
      
      // Verify operations were called
      expect(beginPathSpy).toHaveBeenCalled();
      expect(moveToSpy).toHaveBeenCalled();
      expect(lineToSpy).toHaveBeenCalled();
      expect(strokeSpy).toHaveBeenCalled();
      
      // Reset spies
      beginPathSpy.mockClear();
      moveToSpy.mockClear();
      lineToSpy.mockClear();
      strokeSpy.mockClear();
      
      // Draw same digit again (from cache)
      NUMBER_PATHS.drawDigit(ctx, 1, 100, 100, 32);
      
      // Operations should still be called (replayed from cache)
      expect(beginPathSpy).toHaveBeenCalled();
      expect(moveToSpy).toHaveBeenCalled();
      expect(lineToSpy).toHaveBeenCalled();
      expect(strokeSpy).toHaveBeenCalled();
    });

    it('should handle all digit shapes (0-9)', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Test all digits render without errors
      for (let digit = 0; digit <= 9; digit++) {
        expect(() => {
          NUMBER_PATHS.drawDigit(ctx, digit, 100, 100, 32);
        }).not.toThrow();
      }
      
      // All digits should be cached
      const stats = NUMBER_PATHS.getCacheStats();
      expect(stats.size).toBe(10);
    });
  });

  describe('Large Number Handling', () => {
    it('should handle numbers up to 999 with digit rendering', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Test various multi-digit numbers
      const testNumbers = [10, 99, 100, 500, 999];
      
      for (const num of testNumbers) {
        expect(() => {
          NUMBER_PATHS.drawLargeNumber(ctx, num, 100, 100, 32);
        }).not.toThrow();
      }
    });

    it('should use dot pattern for numbers > 999', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      const fillSpy = jest.spyOn(ctx, 'fill');
      const arcSpy = jest.spyOn(ctx, 'arc');
      
      // Draw a large number
      NUMBER_PATHS.drawLargeNumber(ctx, 5000, 100, 100, 32);
      
      // Should use arc for dots
      expect(arcSpy).toHaveBeenCalled();
      expect(fillSpy).toHaveBeenCalled();
    });

    it('should cache common large numbers (multiples of 100/1000)', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // These should be cached
      NUMBER_PATHS.drawLargeNumber(ctx, 1000, 100, 100, 32);
      NUMBER_PATHS.drawLargeNumber(ctx, 2000, 100, 100, 32);
      NUMBER_PATHS.drawLargeNumber(ctx, 500, 100, 100, 32); // Multiple of 100
      
      const stats = NUMBER_PATHS.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
      
      // Draw 1000 again - should hit cache
      const missesBeforeRedraw = stats.misses;
      NUMBER_PATHS.drawLargeNumber(ctx, 1000, 100, 100, 32);
      const newStats = NUMBER_PATHS.getCacheStats();
      
      // Should not increase misses
      expect(newStats.misses).toBe(missesBeforeRedraw);
    });

    it('should display abbreviated text for very large numbers', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      const fillTextSpy = jest.spyOn(ctx, 'fillText');
      
      // Test with large size to enable text display
      NUMBER_PATHS.drawLargeNumber(ctx, 1500000, 100, 100, 40);
      
      // Should display "1M"
      expect(fillTextSpy).toHaveBeenCalledWith(
        expect.stringContaining('M'),
        expect.any(Number),
        expect.any(Number)
      );
      
      fillTextSpy.mockClear();
      
      NUMBER_PATHS.drawLargeNumber(ctx, 5000, 100, 100, 40);
      
      // Should display "5K"
      expect(fillTextSpy).toHaveBeenCalledWith(
        expect.stringContaining('K'),
        expect.any(Number),
        expect.any(Number)
      );
    });
  });

  describe('Cache Statistics', () => {
    it('should provide accurate statistics', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Start with empty cache
      let stats = NUMBER_PATHS.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.hitRate).toBe(0);
      
      // Add some entries
      for (let i = 0; i < 5; i++) {
        NUMBER_PATHS.drawDigit(ctx, i, 100, 100, 32);
      }
      
      stats = NUMBER_PATHS.getCacheStats();
      expect(stats.size).toBe(5);
      expect(stats.misses).toBe(5);
      expect(stats.hits).toBe(0);
      
      // Generate some hits
      for (let i = 0; i < 5; i++) {
        NUMBER_PATHS.drawDigit(ctx, i, 100, 100, 32);
      }
      
      stats = NUMBER_PATHS.getCacheStats();
      expect(stats.hits).toBe(5);
      expect(stats.hitRate).toBe(0.5); // 5 hits / 10 total
    });

    it('should clear cache properly', () => {
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Add entries to cache
      for (let i = 0; i < 5; i++) {
        NUMBER_PATHS.drawDigit(ctx, i, 100, 100, 32);
      }
      
      let stats = NUMBER_PATHS.getCacheStats();
      expect(stats.size).toBe(5);
      
      // Clear cache
      NUMBER_PATHS.clearCache();
      
      stats = NUMBER_PATHS.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Performance Logging', () => {
    it('should log cache performance periodically', async () => {
      const loggerModule = await import('../../../utils/logger');
      const { logger } = loggerModule;
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Generate 100 operations to trigger logging
      for (let i = 0; i < 50; i++) {
        NUMBER_PATHS.drawDigit(ctx, i % 10, 100, 100, 20 + (i % 5));
      }
      
      // Generate cache hits
      for (let i = 0; i < 50; i++) {
        NUMBER_PATHS.drawDigit(ctx, i % 10, 100, 100, 20 + (i % 5));
      }
      
      // Should have logged performance
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('cache hit rate'),
        'NumberPathCache'
      );
    });
  });
});