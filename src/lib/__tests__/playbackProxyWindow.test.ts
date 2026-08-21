import { describe, it, expect } from 'vitest';
import {
  windowNeedsFullDepth,
  PROXY_LEVELS,
  MIN_LEVELS_IN_WINDOW,
} from '../playbackProxyWindow';

/** The measured container: 16-bit samples occupying 126..1566, so 11 bits. */
const RANGE = 2047;

describe('windowNeedsFullDepth', () => {
  it('is happy with a window spanning the whole range', () => {
    expect(windowNeedsFullDepth(0, RANGE, RANGE)).toBe(false);
  });

  it('demands full depth once the window holds too few proxy levels', () => {
    const tooNarrow = Math.floor(
      (RANGE * (MIN_LEVELS_IN_WINDOW - 1)) / PROXY_LEVELS
    );
    expect(windowNeedsFullDepth(100, 100 + tooNarrow, RANGE)).toBe(true);
  });

  it('is satisfied exactly at the threshold', () => {
    const atThreshold = Math.ceil(
      (RANGE * MIN_LEVELS_IN_WINDOW) / PROXY_LEVELS
    );
    expect(windowNeedsFullDepth(100, 100 + atThreshold, RANGE)).toBe(false);
  });

  it('treats an inverted window the same as the display code does', () => {
    expect(windowNeedsFullDepth(RANGE, 0, RANGE)).toBe(false);
  });

  it('treats a zero-width window as needing full depth', () => {
    expect(windowNeedsFullDepth(500, 500, RANGE)).toBe(true);
  });

  it('uses the original when the container has no proxies at all', () => {
    expect(windowNeedsFullDepth(0, RANGE, null)).toBe(true);
  });

  it('does not divide by a missing range', () => {
    expect(windowNeedsFullDepth(0, RANGE, 0)).toBe(true);
  });

  it('the window the user actually had is comfortably inside the proxy', () => {
    // Reported from production: Min 104, Max 29636 on 11-bit data. Wildly
    // wider than the range, so the proxy is plainly good enough — this is the
    // case the whole feature is for.
    expect(windowNeedsFullDepth(104, 29636, RANGE)).toBe(false);
  });
});
