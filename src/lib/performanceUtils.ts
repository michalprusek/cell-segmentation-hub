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

    rafId = requestAnimationFrame(run);
  };

  // A frame that arrives before `interval` has elapsed must RE-ARM, not just
  // give up. The old body cleared `rafId` and returned, leaving `lastArgs`
  // parked until some later call happened to schedule again — so on a
  // 120 Hz display (8.3 ms frames against the 16 ms default) every other
  // call was deferred, and the LAST call of a burst was never delivered at
  // all: the cursor read-out stopped one event short of where the pointer
  // came to rest.
  //
  // The frame's timestamp is NOT trusted to exist. Browsers always pass one,
  // but a `requestAnimationFrame` stand-in need not — this project's own test
  // setup is `setTimeout(callback, 16)`, which passes nothing. `undefined -
  // lastTime` is NaN, NaN is never `>= interval`, and with the re-arm above
  // that is a frame scheduled every 16 ms for ever with the callback never
  // delivered (measured: 25 frames armed and 0 calls in 400 ms after one
  // call). So a non-finite timestamp falls back to the clock it stands for.
  const run = (timestamp?: number) => {
    rafId = null;
    if (!lastArgs) return;
    const currentTime =
      typeof timestamp === 'number' && Number.isFinite(timestamp)
        ? timestamp
        : performance.now();
    if (currentTime - lastTime >= interval) {
      const args = lastArgs;
      lastArgs = null;
      lastTime = currentTime;
      callback(...args);
    } else {
      rafId = requestAnimationFrame(run);
    }
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
