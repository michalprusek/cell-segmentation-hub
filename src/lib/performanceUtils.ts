/**
 * Performance utilities for smooth animations and optimized rendering
 */

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

    rafId = requestAnimationFrame(currentTime => {
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
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const debouncedFunction = (...args: T) => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  };

  debouncedFunction.cancel = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };

  return debouncedFunction;
}

// Helper type for debounced functions
type DebouncedVoid = (() => void) & { cancel: () => void };

// Progressive rendering state manager
export class ProgressiveRenderer {
  private isAnimating = false;
  private onAnimationStart?: () => void;
  private onAnimationEnd?: () => void;

  private endAnimation: DebouncedVoid;

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
    this.endAnimation.cancel();

    // Clear references to prevent memory leaks
    this.onAnimationStart = undefined;
    this.onAnimationEnd = undefined;
  }

  get isInProgress() {
    return this.isAnimating;
  }
}
