import { CanvasRenderingContext2D } from 'canvas';
import { logger } from '../../utils/logger';

/**
 * Universal number rendering using geometric shapes with caching
 * This approach works across all environments without font dependencies
 */

// Cache for rendered number paths to improve performance
interface CachedPath {
  path: any | null; // Path2D not available in node-canvas, use null
  operations: Array<{ type: string; args: any[] }>;
  lastAccessed: number;
}

class NumberPathCache {
  private cache: Map<string, CachedPath> = new Map();
  private maxCacheSize = 100; // Maximum number of cached entries
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Generate cache key for a number at a specific size
   */
  private getCacheKey(number: number, size: number): string {
    // Round size to nearest integer to improve cache hits
    const roundedSize = Math.round(size);
    return `${number}-${roundedSize}`;
  }

  /**
   * Get cached path operations or null if not cached
   */
  get(number: number, size: number): Array<{ type: string; args: any[] }> | null {
    const key = this.getCacheKey(number, size);
    const cached = this.cache.get(key);
    
    if (cached) {
      cached.lastAccessed = Date.now();
      this.cacheHits++;
      
      // Log cache performance periodically
      if ((this.cacheHits + this.cacheMisses) % 100 === 0) {
        const hitRate = (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(1);
        logger.debug(`Number path cache hit rate: ${hitRate}% (${this.cacheHits} hits, ${this.cacheMisses} misses)`, 'NumberPathCache');
      }
      
      return cached.operations;
    }
    
    this.cacheMisses++;
    return null;
  }

  /**
   * Store path operations in cache
   */
  set(number: number, size: number, operations: Array<{ type: string; args: any[] }>): void {
    const key = this.getCacheKey(number, size);
    
    // Implement LRU eviction if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLeastRecentlyUsed();
    }
    
    this.cache.set(key, {
      path: null,
      operations: operations,
      lastAccessed: Date.now()
    });
  }

  /**
   * Evict least recently used entry from cache
   */
  private evictLeastRecentlyUsed(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, value] of this.cache.entries()) {
      if (value.lastAccessed < oldestTime) {
        oldestTime = value.lastAccessed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.cache.size,
      hitRate: total > 0 ? this.cacheHits / total : 0
    };
  }
}

// Create singleton cache instance
const pathCache = new NumberPathCache();

/**
 * Record canvas operations for caching
 */
class OperationRecorder {
  operations: Array<{ type: string; args: any[] }> = [];

  beginPath(): void {
    this.operations.push({ type: 'beginPath', args: [] });
  }

  moveTo(x: number, y: number): void {
    this.operations.push({ type: 'moveTo', args: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.operations.push({ type: 'lineTo', args: [x, y] });
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.operations.push({ type: 'quadraticCurveTo', args: [cpx, cpy, x, y] });
  }

  stroke(): void {
    this.operations.push({ type: 'stroke', args: [] });
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.operations.push({ type: 'arc', args: [x, y, radius, startAngle, endAngle] });
  }

  fill(): void {
    this.operations.push({ type: 'fill', args: [] });
  }

  /**
   * Replay recorded operations on a canvas context
   */
  replay(ctx: CanvasRenderingContext2D): void {
    for (const op of this.operations) {
      const method = (ctx as any)[op.type];
      if (typeof method === 'function') {
        method.apply(ctx, op.args);
      }
    }
  }
}

export const NUMBER_PATHS = {
  /**
   * Draw a single digit with caching support
   */
  drawDigit: (ctx: CanvasRenderingContext2D, digit: number, centerX: number, centerY: number, size: number): void => {
    // Check cache first
    const cachedOps = pathCache.get(digit, size);
    if (cachedOps) {
      // Replay cached operations
      for (const op of cachedOps) {
        const method = (ctx as any)[op.type];
        if (typeof method === 'function') {
          method.apply(ctx, op.args);
        }
      }
      return;
    }

    // Record operations for caching
    const recorder = new OperationRecorder();
    
    const width = size * 0.6;
    const height = size;
    const strokeWidth = Math.max(2, size * 0.12);
    
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const left = centerX - width / 2;
    const right = centerX + width / 2;
    const top = centerY - height / 2;
    const bottom = centerY + height / 2;
    const middle = centerY;
    
    switch (digit) {
      case 0:
        recorder.beginPath();
        recorder.moveTo(centerX, top);
        recorder.quadraticCurveTo(right, top, right, middle);
        recorder.quadraticCurveTo(right, bottom, centerX, bottom);
        recorder.quadraticCurveTo(left, bottom, left, middle);
        recorder.quadraticCurveTo(left, top, centerX, top);
        recorder.stroke();
        break;
        
      case 1:
        recorder.beginPath();
        recorder.moveTo(centerX, top);
        recorder.lineTo(centerX, bottom);
        recorder.moveTo(centerX - width * 0.2, top + height * 0.15);
        recorder.lineTo(centerX, top);
        recorder.stroke();
        break;
        
      case 2:
        recorder.beginPath();
        recorder.moveTo(left, top + height * 0.25);
        recorder.quadraticCurveTo(centerX, top, right, top + height * 0.25);
        recorder.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        recorder.lineTo(left, bottom - height * 0.1);
        recorder.lineTo(right, bottom);
        recorder.stroke();
        break;
        
      case 3:
        recorder.beginPath();
        recorder.moveTo(left, top + height * 0.2);
        recorder.quadraticCurveTo(centerX, top, right, top + height * 0.25);
        recorder.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        recorder.moveTo(centerX, middle);
        recorder.quadraticCurveTo(right, middle + height * 0.1, right, bottom - height * 0.25);
        recorder.quadraticCurveTo(centerX, bottom, left, bottom - height * 0.2);
        recorder.stroke();
        break;
        
      case 4:
        recorder.beginPath();
        recorder.moveTo(left + width * 0.2, top);
        recorder.lineTo(left + width * 0.2, middle);
        recorder.lineTo(right, middle);
        recorder.moveTo(right - width * 0.2, top);
        recorder.lineTo(right - width * 0.2, bottom);
        recorder.stroke();
        break;
        
      case 5:
        recorder.beginPath();
        recorder.moveTo(right, top);
        recorder.lineTo(left, top);
        recorder.lineTo(left, middle - height * 0.1);
        recorder.quadraticCurveTo(centerX, middle - height * 0.1, right, middle + height * 0.1);
        recorder.quadraticCurveTo(right, bottom - height * 0.1, centerX, bottom);
        recorder.lineTo(left, bottom - height * 0.2);
        recorder.stroke();
        break;
        
      case 6:
        recorder.beginPath();
        recorder.moveTo(right - width * 0.2, top);
        recorder.quadraticCurveTo(left, top, left, middle);
        recorder.quadraticCurveTo(left, bottom, centerX, bottom);
        recorder.quadraticCurveTo(right, bottom, right, middle + height * 0.1);
        recorder.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        recorder.lineTo(left, middle);
        recorder.stroke();
        break;
        
      case 7:
        recorder.beginPath();
        recorder.moveTo(left, top);
        recorder.lineTo(right, top);
        recorder.lineTo(centerX, bottom);
        recorder.stroke();
        break;
        
      case 8:
        recorder.beginPath();
        // Top circle
        recorder.moveTo(left, top + height * 0.2);
        recorder.quadraticCurveTo(centerX, top, right, top + height * 0.2);
        recorder.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        recorder.quadraticCurveTo(left, middle - height * 0.1, left, top + height * 0.2);
        // Bottom circle
        recorder.moveTo(left, middle + height * 0.1);
        recorder.quadraticCurveTo(left, bottom, centerX, bottom);
        recorder.quadraticCurveTo(right, bottom, right, middle + height * 0.1);
        recorder.quadraticCurveTo(right, middle + height * 0.1, centerX, middle);
        recorder.stroke();
        break;
        
      case 9:
        recorder.beginPath();
        recorder.moveTo(centerX, middle);
        recorder.quadraticCurveTo(right, middle - height * 0.1, right, top + height * 0.2);
        recorder.quadraticCurveTo(right, top, centerX, top);
        recorder.quadraticCurveTo(left, top, left, middle - height * 0.1);
        recorder.quadraticCurveTo(left, middle + height * 0.1, centerX, middle);
        recorder.lineTo(right, middle);
        recorder.quadraticCurveTo(right, bottom, left + width * 0.2, bottom);
        recorder.stroke();
        break;
    }
    
    // Cache the operations
    pathCache.set(digit, size, recorder.operations);
    
    // Apply the operations to the actual context
    recorder.replay(ctx);
  },
  
  /**
   * Draw numbers > 9 using dot pattern or multi-digit rendering
   */
  drawLargeNumber: (ctx: CanvasRenderingContext2D, number: number, centerX: number, centerY: number, size: number): void => {
    if (number <= 9) {
      NUMBER_PATHS.drawDigit(ctx, number, centerX, centerY, size);
      return;
    }
    
    // Check cache for large numbers too
    const cachedOps = pathCache.get(number, size);
    if (cachedOps) {
      for (const op of cachedOps) {
        const method = (ctx as any)[op.type];
        if (typeof method === 'function') {
          method.apply(ctx, op.args);
        }
      }
      return;
    }
    
    const recorder = new OperationRecorder();
    
    if (number <= 99) {
      // Draw two digits side by side
      const digitWidth = size * 0.4;
      const leftDigit = Math.floor(number / 10);
      const rightDigit = number % 10;
      
      NUMBER_PATHS.drawDigit(ctx, leftDigit, centerX - digitWidth * 0.6, centerY, size * 0.7);
      NUMBER_PATHS.drawDigit(ctx, rightDigit, centerX + digitWidth * 0.6, centerY, size * 0.7);
    } else if (number <= 999) {
      // Draw three digits
      const digitWidth = size * 0.3;
      const hundreds = Math.floor(number / 100);
      const tens = Math.floor((number % 100) / 10);
      const ones = number % 10;
      
      NUMBER_PATHS.drawDigit(ctx, hundreds, centerX - digitWidth, centerY, size * 0.5);
      NUMBER_PATHS.drawDigit(ctx, tens, centerX, centerY, size * 0.5);
      NUMBER_PATHS.drawDigit(ctx, ones, centerX + digitWidth, centerY, size * 0.5);
    } else {
      // For very large numbers, use dot pattern
      const dotSize = size * 0.15;
      const dots = Math.min(Math.floor(Math.log10(number)) + 1, 12); // Number of digits, max 12
      const angleStep = (Math.PI * 2) / dots;
      const dotRadius = size * 0.3;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
      for (let i = 0; i < dots; i++) {
        const angle = i * angleStep - Math.PI / 2;
        const dotX = centerX + Math.cos(angle) * dotRadius;
        const dotY = centerY + Math.sin(angle) * dotRadius;
        
        recorder.beginPath();
        recorder.arc(dotX, dotY, dotSize, 0, Math.PI * 2);
        recorder.fill();
      }
      
      // Draw abbreviated number in center if space allows
      if (size > 30) {
        ctx.save();
        ctx.font = `${size * 0.3}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        
        let displayText = '';
        if (number >= 1000000) {
          displayText = `${Math.floor(number / 1000000)}M`;
        } else if (number >= 1000) {
          displayText = `${Math.floor(number / 1000)}K`;
        } else {
          displayText = String(number);
        }
        
        ctx.fillText(displayText, centerX, centerY);
        ctx.restore();
      }
      
      // Cache operations for large numbers if they're common (e.g., 1000, 2000, etc.)
      if (number % 100 === 0 || number % 1000 === 0) {
        pathCache.set(number, size, recorder.operations);
      }
      
      recorder.replay(ctx);
    }
  },
  
  /**
   * Get cache statistics for monitoring
   */
  getCacheStats: () => pathCache.getStats(),
  
  /**
   * Clear the cache (useful for testing)
   */
  clearCache: () => pathCache.clear()
};