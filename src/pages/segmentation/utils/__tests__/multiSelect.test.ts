/**
 * The reported bug (Institut Curie, 2026-09-03):
 *
 *   "When selecting two or more microtubules in the segmentation window, the
 *    first selected microtubule is not taken into account when I try to change
 *    all microtubule types. So when selecting 3 microtubules, doing right-click
 *    and select 'set type', I see the text 'set type for 2 selected'."
 *
 * The editor keeps TWO selections: a lone `selectedPolygonId` (the vertex-edit /
 * cross-frame single selection) and `selectedPolygonIds` (the bulk set that
 * every "…for N selected" action reads). A plain click puts a microtubule in
 * the FIRST one; a Shift+click adds to the SECOND. So picking A, then
 * Shift+picking B and C, left A outside the bulk set — count 2, and the bulk
 * write skipped it silently.
 *
 * `planAdditiveToggle` is the rule both entry points now share.
 */
import { describe, it, expect } from 'vitest';
import { planAdditiveToggle } from '../multiSelect';

describe('planAdditiveToggle', () => {
  it('absorbs a lone single selection so the first pick is counted', () => {
    // A was plain-clicked (single), B is now Shift+clicked.
    expect(planAdditiveToggle('A', 'B')).toEqual({
      clearSingle: true,
      toggle: ['A', 'B'],
    });
  });

  it('toggles only the clicked polygon when there is no single selection', () => {
    // The all-Shift flow: nothing is in the single slot, so nothing to absorb.
    expect(planAdditiveToggle(null, 'A')).toEqual({
      clearSingle: false,
      toggle: ['A'],
    });
  });

  it('clears the single selection when it is the polygon toggled', () => {
    // Re-picking the single-selected MT means "deselect it". Absorbing it into
    // the bulk set and then toggling it would cancel out to a no-op, which
    // reads as a dead click.
    expect(planAdditiveToggle('A', 'A')).toEqual({
      clearSingle: true,
      toggle: [],
    });
  });

  it('orders the absorb before the toggle', () => {
    // Not cosmetic: both entries land in one `toggle` list precisely so the
    // caller cannot interleave a re-render between them and drop one.
    const { toggle } = planAdditiveToggle('first', 'second');
    expect(toggle[0]).toBe('first');
    expect(toggle[1]).toBe('second');
  });
});
