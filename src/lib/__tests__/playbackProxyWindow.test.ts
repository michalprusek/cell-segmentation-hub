import { describe, it, expect, beforeEach } from 'vitest';
import {
  windowNeedsFullDepth,
  noteProxyRange,
  clearProxyRanges,
  observedProxyRanges,
  PROXY_LEVELS,
  MIN_LEVELS_IN_WINDOW,
} from '../playbackProxyWindow';

beforeEach(() => clearProxyRanges());

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

describe('judging against the range a channel is really encoded at', () => {
  /** The measured container: irm is bright, 640 nm is dim. */
  const CONTAINER = 32767;

  it('stops the brightest channel deciding for a dim one', () => {
    // The bug this fixes: with only the container figure, a window sized to
    // look at the dim channel (data never above 1177) fell below the 4096
    // threshold and forced full depth — switching the feature off in the
    // normal working state for this tool.
    expect(windowNeedsFullDepth(0, 1177, CONTAINER, ['640_nm'])).toBe(true);

    noteProxyRange('640_nm', 1023);

    // Against its own range, that window holds ~294 of the 256 levels' worth
    // of resolution — nowhere near banding.
    expect(windowNeedsFullDepth(0, 1177, CONTAINER, ['640_nm'])).toBe(false);
  });

  it('takes the coarsest of the visible channels, since one window serves all', () => {
    noteProxyRange('640_nm', 1023);
    noteProxyRange('irm', 32767);

    // 1177 wide is fine for 640 nm and hopeless for irm; drawing both means
    // the answer has to be the worse one.
    expect(windowNeedsFullDepth(0, 1177, CONTAINER, ['640_nm', 'irm'])).toBe(
      true
    );
  });

  it('falls back to the container figure until every visible channel is known', () => {
    noteProxyRange('640_nm', 1023);

    // irm has not been seen yet, so judging by 640 nm alone would be
    // optimistic about a channel that is about to be drawn.
    expect(windowNeedsFullDepth(0, 1177, CONTAINER, ['640_nm', 'irm'])).toBe(
      true
    );
  });

  it('remembers the widest range seen for a channel, not the latest', () => {
    // A channel's frames differ; the guard has to be right about its worst.
    noteProxyRange('488_nm', 16383);
    noteProxyRange('488_nm', 2047);

    expect(observedProxyRanges()['488_nm']).toBe(16383);
  });

  it('ignores a range that is not a positive number', () => {
    noteProxyRange('488_nm', Number.NaN);
    noteProxyRange('488_nm', 0);
    noteProxyRange('488_nm', -1);

    expect(observedProxyRanges()).toEqual({});
  });

  it('forgets everything on leaving a container', () => {
    noteProxyRange('640_nm', 1023);
    clearProxyRanges();

    expect(observedProxyRanges()).toEqual({});
    expect(windowNeedsFullDepth(0, 1177, CONTAINER, ['640_nm'])).toBe(true);
  });
});
