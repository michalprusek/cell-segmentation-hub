/**
 * This predicate decides what the export measures, so every case here is a
 * number a user would read off a spreadsheet.
 */
import { describe, it, expect } from 'vitest';

import {
  isMeasuredMicrocapsule,
  MICROCAPSULE_DEFAULT_TYPE_LABELS,
  MICROCAPSULE_NON_RELEVANT_LABEL_ID,
  MICROCAPSULE_RELEVANT_LABEL_ID,
} from '@/lib/microcapsuleRelevance';

describe('isMeasuredMicrocapsule', () => {
  it('measures an untyped whole capsule', () => {
    expect(isMeasuredMicrocapsule({ complete: true })).toBe(true);
    expect(isMeasuredMicrocapsule({})).toBe(true);
  });

  it('skips an untyped capsule the model found cut by the border', () => {
    expect(isMeasuredMicrocapsule({ complete: false })).toBe(false);
  });

  it('measures a border-cut capsule the user typed back in', () => {
    // The point of the whole feature: the model's flag is a default, and a
    // human who decides the capsule is usable gets it into the numbers.
    expect(
      isMeasuredMicrocapsule({
        complete: false,
        mtType: MICROCAPSULE_RELEVANT_LABEL_ID,
      })
    ).toBe(true);
  });

  it('skips a whole capsule the user typed out', () => {
    expect(
      isMeasuredMicrocapsule({
        complete: true,
        mtType: MICROCAPSULE_NON_RELEVANT_LABEL_ID,
      })
    ).toBe(false);
  });

  it('measures anything that is not the non-relevant label', () => {
    // Only `non_relevant` excludes. A label the user adds later counts, which
    // is what makes "type it as something else to include it" work without
    // having to pick one blessed label.
    for (const type of ['relevant', 'debris_but_usable', 'my_own_label']) {
      expect(isMeasuredMicrocapsule({ complete: false, mtType: type })).toBe(
        true
      );
    }
  });

  it('treats an empty or missing type as untyped', () => {
    expect(isMeasuredMicrocapsule({ complete: false, mtType: '' })).toBe(false);
    expect(isMeasuredMicrocapsule({ complete: false, mtType: null })).toBe(
      false
    );
    expect(isMeasuredMicrocapsule({ complete: true, mtType: '' })).toBe(true);
  });

  it('seeds exactly the two labels the canvas already drew', () => {
    expect(MICROCAPSULE_DEFAULT_TYPE_LABELS.map(l => l.id)).toEqual([
      MICROCAPSULE_RELEVANT_LABEL_ID,
      MICROCAPSULE_NON_RELEVANT_LABEL_ID,
    ]);
    // The colours are the editor's external-contour red and border-cut grey,
    // so an untyped capsule and one explicitly typed look identical.
    expect(MICROCAPSULE_DEFAULT_TYPE_LABELS.map(l => l.color)).toEqual([
      '#ef4444',
      '#969696',
    ]);
  });
});
