/**
 * Unit tests for the canvas-deselection mode configuration.
 *
 * The file under test used to carry six behaviour categories; five of them had
 * no caller and were removed, and the tests for them went with them — they
 * asserted that a list contained what the same file's literal said it did,
 * which held whether or not any component agreed. What remains covers the one
 * predicate the editor actually calls.
 */

import { describe, it, expect } from 'vitest';
import { EditMode } from '../../types';
import {
  MODE_BEHAVIOR_CONFIG,
  shouldPreventCanvasDeselection,
} from '../modeConfig';

describe('Canvas deselection prevention', () => {
  it('suppresses deselection in every multi-click placement mode', () => {
    expect(shouldPreventCanvasDeselection(EditMode.AddPoints)).toBe(true);
    expect(shouldPreventCanvasDeselection(EditMode.Slice)).toBe(true);
    expect(shouldPreventCanvasDeselection(EditMode.CreatePolygon)).toBe(true);
    expect(shouldPreventCanvasDeselection(EditMode.CreatePolyline)).toBe(true);
  });

  it('allows deselection in view and single-click modes', () => {
    expect(shouldPreventCanvasDeselection(EditMode.View)).toBe(false);
    expect(shouldPreventCanvasDeselection(EditMode.EditVertices)).toBe(false);
    expect(shouldPreventCanvasDeselection(EditMode.DeletePolygon)).toBe(false);
  });

  it('agrees with the configuration for every EditMode, in both directions', () => {
    const prevented = new Set<EditMode>(
      MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION
    );

    for (const mode of Object.values(EditMode)) {
      expect(shouldPreventCanvasDeselection(mode)).toBe(prevented.has(mode));
    }
  });

  it('covers a newly added EditMode explicitly, rather than by default', () => {
    // Every mode must be a deliberate decision. A mode added to the enum
    // without a decision here silently lands in the "deselects" bucket, which
    // is the failure that made Slice abort mid-slice before this config
    // existed. This asserts the enum has not grown past what was considered.
    expect(Object.values(EditMode).sort()).toEqual(
      [
        EditMode.View,
        EditMode.EditVertices,
        EditMode.AddPoints,
        EditMode.CreatePolygon,
        EditMode.CreatePolyline,
        EditMode.Slice,
        EditMode.DeletePolygon,
      ].sort()
    );
  });
});
