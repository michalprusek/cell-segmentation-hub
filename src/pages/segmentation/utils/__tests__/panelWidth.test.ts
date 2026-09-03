import { describe, it, expect } from 'vitest';
import {
  clampPanelWidth,
  widthFromDrag,
  readStoredPanelWidth,
  MIN_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  DEFAULT_PANEL_WIDTH,
  PANEL_WIDTH_STORAGE_KEY,
} from '../panelWidth';

describe('widthFromDrag', () => {
  it('grows the panel when the pointer moves LEFT', () => {
    // The handle is the panel's left edge and the panel is anchored right, so
    // the delta is inverted. This is the assertion that catches the sign error.
    expect(widthFromDrag(300, 500, 420)).toBe(380);
  });

  it('shrinks the panel when the pointer moves RIGHT', () => {
    expect(widthFromDrag(300, 500, 560)).toBe(240);
  });

  it('clamps at both ends rather than letting the panel vanish or eat the canvas', () => {
    expect(widthFromDrag(300, 500, 5000)).toBe(MIN_PANEL_WIDTH);
    expect(widthFromDrag(300, 500, -5000)).toBe(MAX_PANEL_WIDTH);
  });
});

describe('clampPanelWidth', () => {
  it('rounds to whole pixels', () => {
    expect(clampPanelWidth(300.6)).toBe(301);
  });

  it('allows the panel to be made NARROWER than its old fixed width', () => {
    // The pre-resize width is the default, not the floor — a user who wants
    // more canvas must be able to go below it.
    expect(clampPanelWidth(220)).toBe(220);
    expect(MIN_PANEL_WIDTH).toBeLessThan(DEFAULT_PANEL_WIDTH);
  });
});

describe('readStoredPanelWidth', () => {
  const store = (value: string | null) => ({ getItem: () => value });

  it('returns the stored width', () => {
    expect(readStoredPanelWidth(store('360'))).toBe(360);
  });

  it('falls back to the default when nothing is stored', () => {
    expect(readStoredPanelWidth(store(null))).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('falls back to the default on a garbage value', () => {
    expect(readStoredPanelWidth(store('wide please'))).toBe(
      DEFAULT_PANEL_WIDTH
    );
  });

  it('clamps a stored value that is out of range', () => {
    // A value saved before the bounds changed, or hand-edited.
    expect(readStoredPanelWidth(store('99999'))).toBe(MAX_PANEL_WIDTH);
  });

  it('survives storage that throws instead of returning null', () => {
    // Private windows / "block site data" throw on access.
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readStoredPanelWidth(throwing)).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('survives no storage at all (SSR / disabled)', () => {
    expect(readStoredPanelWidth(null)).toBe(DEFAULT_PANEL_WIDTH);
    expect(readStoredPanelWidth(undefined)).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('uses a namespaced storage key', () => {
    // A bare key like "sidebarWidth" would collide with anything else on the
    // origin.
    expect(PANEL_WIDTH_STORAGE_KEY).toContain('spheroseg');
  });
});
