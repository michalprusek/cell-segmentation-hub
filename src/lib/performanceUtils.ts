/**
 * Performance utilities for smooth animations and optimized rendering
 */

// RequestAnimationFrame wrapper for smooth updates
export function rafSchedule<T extends unknown[]>(
  callback: (...args: T) => void
): (...args: T) => void {
  let rafId: number | null = null;
  let lastArgs: T | null = null;

  return (...args: T) => {
    lastArgs = args;
    
    if (rafId !== null) {
      return; // Already scheduled
    }

    rafId = requestAnimationFrame(() => {
      if (lastArgs) {
        callback(...lastArgs);
        lastArgs = null;
      }
      rafId = null;
    });
  };
}

// Throttle function with requestAnimationFrame for smooth 60fps updates
export function rafThrottle<T extends unknown[]>(
  callback: (...args: T) => void,
  interval: number = 16 // ~60fps
): { fn: (...args: T) => void; cancel: () => void } {
  let lastTime = 0;
  let rafId: number | null = null;
  let lastArgs: T | null = null;

  const throttledFn = (...args: T) => {
    lastArgs = args;
    
    if (rafId !== null) {
      return; // Already scheduled
    }

    rafId = requestAnimationFrame((currentTime) => {
      if (currentTime - lastTime >= interval && lastArgs) {
        callback(...lastArgs);
        lastTime = currentTime;
        lastArgs = null;
      }
      rafId = null;
    });
  };

  const cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastArgs = null;
  };

  return { fn: throttledFn, cancel };
}

// Debounce function for delayed updates after user stops interacting
export function debounce<T extends unknown[]>(
  callback: (...args: T) => void,
  delay: number
): { (...args: T): void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  const debouncedFunction = (...args: T) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  };
  
  debouncedFunction.cancel = () => {
    clearTimeout(timeoutId);
  };
  
  return debouncedFunction;
}

// Progressive rendering state manager
export class ProgressiveRenderer {
  private isAnimating = false;
  private onAnimationStart?: () => void;
  private onAnimationEnd?: () => void;

  private endAnimation: () => void;

  constructor(
    onAnimationStart?: () => void,
    onAnimationEnd?: () => void,
    debounceTime: number = 100
  ) {
    this.onAnimationStart = onAnimationStart;
    this.onAnimationEnd = onAnimationEnd;
    
    this.endAnimation = debounce(() => {
      if (this.isAnimating) {
        this.isAnimating = false;
        this.onAnimationEnd?.();
      }
    }, debounceTime);
  }

  startAnimation() {
    if (!this.isAnimating) {
      this.isAnimating = true;
      this.onAnimationStart?.();
    }
    this.endAnimation();
  }

  dispose() {
    // Cancel any pending debounced calls
    if (this.endAnimation && typeof this.endAnimation.cancel === 'function') {
      this.endAnimation.cancel();
    }
    
    // Clear references to prevent memory leaks
    this.onAnimationStart = undefined;
    this.onAnimationEnd = undefined;
  }

  get isInProgress() {
    return this.isAnimating;
  }
}

// Spatial indexing for efficient viewport culling
export class SpatialIndex {
  private points: { x: number; y: number; index: number }[] = [];
  private sortedByX: { x: number; y: number; index: number }[] = [];
  private sortedByY: { x: number; y: number; index: number }[] = [];

  updatePoints(points: { x: number; y: number }[]) {
    this.points = points.map((point, index) => ({ ...point, index }));
    this.sortedByX = [...this.points].sort((a, b) => a.x - b.x);
    this.sortedByY = [...this.points].sort((a, b) => a.y - b.y);
  }

  getVisibleIndices(
    viewportX: number,
    viewportY: number,
    viewportWidth: number,
    viewportHeight: number,
    buffer: number = 50
  ): number[] {
    const minX = viewportX - buffer;
    const maxX = viewportX + viewportWidth + buffer;
    const minY = viewportY - buffer;
    const maxY = viewportY + viewportHeight + buffer;

    // Binary search for X range
    const xStart = this.binarySearch(this.sortedByX, minX, 'x');
    const xEnd = this.binarySearchEnd(this.sortedByX, maxX, 'x');

    // Get candidates from X range
    const xCandidates = this.sortedByX.slice(xStart, xEnd + 1);

    // Filter by Y range
    const visible = xCandidates.filter(
      point => point.y >= minY && point.y <= maxY
    );

    return visible.map(point => point.index);
  }

  private binarySearch(
    arr: { x: number; y: number; index: number }[],
    target: number,
    key: 'x' | 'y'
  ): number {
    let left = 0;
    let right = arr.length - 1;
    let result = arr.length;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (arr[mid][key] >= target) {
        result = mid;
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return result;
  }

  private binarySearchEnd(
    arr: { x: number; y: number; index: number }[],
    target: number,
    key: 'x' | 'y'
  ): number {
    let left = 0;
    let right = arr.length - 1;
    let result = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (arr[mid][key] <= target) {
        result = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return result;
  }
}