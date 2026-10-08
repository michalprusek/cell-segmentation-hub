import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  OVERLAY_DOT_CLASS,
  OVERLAY_PX_VAR,
  OVERLAY_RADIUS_VAR,
  OVERLAY_STROKE_VAR,
  POLYLINE_HIT_BAND_MULTIPLIER,
  STROKE_MULTIPLIER,
  overlayScaleStyle,
  overlayStrokeBasePx,
  vertexRadiusPx,
} from '../overlayScale';

const vars = (zoom: number) =>
  overlayScaleStyle(zoom) as unknown as Record<string, string>;
/** On-screen px of `multiplier` base strokes at `zoom`. */
const screenWidth = (zoom: number, multiplier: number) =>
  parseFloat(vars(zoom)[OVERLAY_STROKE_VAR]) * multiplier * zoom;

describe('overlayScaleStyle', () => {
  it('sets one screen pixel to 1/zoom user units', () => {
    expect(vars(1)[OVERLAY_PX_VAR]).toBe('1px');
    expect(vars(4)[OVERLAY_PX_VAR]).toBe('0.25px');
    expect(vars(10)[OVERLAY_PX_VAR]).toBe('0.1px');
  });

  it('keeps every stroke the same width ON SCREEN from zoom 0.7 to 10', () => {
    // Before: an idle polyline measured 2.99 px at zoom 2.35, 2.24 px at
    // 4.06 and 5.02 px at 10.
    for (const zoom of [0.7, 1, 2.35, 4.06, 8.3, 10]) {
      expect(screenWidth(zoom, STROKE_MULTIPLIER.polyline)).toBeCloseTo(3, 9);
      expect(screenWidth(zoom, STROKE_MULTIPLIER.polylineHovered)).toBeCloseTo(
        5,
        9
      );
      expect(screenWidth(zoom, STROKE_MULTIPLIER.polygon)).toBeCloseTo(2, 9);
      expect(screenWidth(zoom, POLYLINE_HIT_BAND_MULTIPLIER)).toBeCloseTo(
        24,
        9
      );
    }
  });

  it('keeps the thinner strokes of a zoomed-out view', () => {
    expect(overlayStrokeBasePx(0.3)).toBe(0.8);
    expect(overlayStrokeBasePx(0.6)).toBe(1.2);
    expect(overlayStrokeBasePx(0.7)).toBe(2);
    expect(screenWidth(0.55, STROKE_MULTIPLIER.polyline)).toBeCloseTo(1.8, 9);
  });

  it('never emits an invalid length for a bad zoom', () => {
    for (const zoom of [0, -1, NaN, Infinity]) {
      expect(vars(zoom)[OVERLAY_PX_VAR]).toBe('1px');
      expect(vars(zoom)[OVERLAY_STROKE_VAR]).toBe('2px');
    }
  });
});

describe('vertexRadiusPx', () => {
  it('is 5 px, scaled by interaction state', () => {
    expect(vertexRadiusPx()).toBe(5);
    expect(vertexRadiusPx(true)).toBe(6.5);
    expect(vertexRadiusPx(false, true)).toBe(5.5);
    expect(vertexRadiusPx(false, false, true)).toBe(6);
    expect(vertexRadiusPx(true, true, true)).toBe(8.58);
  });
});

// The components emit a class and a custom property; the stylesheet turns the
// pair into a radius. jsdom applies no stylesheet, so nothing in the component
// suites can tell whether the rule still exists, still has that selector, or
// still reads those properties — deleting the declaration left every suite of
// `src/pages/segmentation` green while every vertex handle in the browser had
// radius 0. This reads the CSS as text and ties it to the exported names.
describe('the stylesheet half of the overlay sizes (src/index.css)', () => {
  const css = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'index.css'
    ),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, ''); // a rule quoted in a comment is not a rule

  /** Declarations of the ONE rule with exactly this selector. */
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = [
      ...css.matchAll(
        new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, 'g')
      ),
    ];
    expect(found).toHaveLength(1);
    return found[0][1].replace(/\s+/g, ' ').trim();
  };

  it('gives the overlay dot class its radius from the two properties', () => {
    expect(rule(`.${OVERLAY_DOT_CLASS}`)).toBe(
      `r: calc(var(${OVERLAY_PX_VAR}, 1px) * var(${OVERLAY_RADIUS_VAR}, 5));`
    );
  });

  it('sizes the selection glow in screen pixels', () => {
    expect(rule('.polygon-selected')).toBe(
      `filter: drop-shadow( 0 0 calc(var(${OVERLAY_PX_VAR}, 1px) * 8) var(--polygon-selected-glow, #3b82f6) );`
    );
  });
});
