/**
 * The reported bug (Institut Curie, 2026-09-03):
 *
 *   "MT1 in the metrics file is labeled 'HeLa MT', while in the segmentation
 *    window 'microtubule 1' is labelled 'WT MT'. Is there a different way to
 *    find back a specific microtubule in the original image?"
 *
 * Two numbering rules existed. The export (and the badge burned onto the
 * exported image) numbered instances in FIRST-APPEARANCE order of `instanceId`;
 * the editor's sidebar numbered its own rows, which are sorted by `trackId`.
 * The orderings agree only by luck, so a metrics row could not be traced back.
 *
 * These tests pin the shared rule against the ordering that actually diverges.
 */
import { describe, it, expect } from 'vitest';
import {
  buildInstanceLabelMap,
  MICROTUBULE_LABEL_PREFIX,
} from '../instanceLabels';

const line = (instanceId: string | null, points = 2) => ({
  geometry: 'polyline',
  instanceId,
  points: Array.from({ length: points }, (_, i) => ({ x: i, y: i })),
});

describe('buildInstanceLabelMap', () => {
  it('numbers in first-appearance order, not sorted order', () => {
    // The exact divergence from the report: array order and trackId/id sort
    // order disagree. `zulu` appears first, so it is MT1 — even though it
    // sorts last.
    const labels = buildInstanceLabelMap(
      [line('zulu'), line('alpha'), line('mike')],
      MICROTUBULE_LABEL_PREFIX
    );
    expect(labels.get('zulu')).toBe('MT1');
    expect(labels.get('alpha')).toBe('MT2');
    expect(labels.get('mike')).toBe('MT3');
  });

  it('gives an instance one number however many polylines it has', () => {
    const labels = buildInstanceLabelMap(
      [line('a'), line('b'), line('a')],
      MICROTUBULE_LABEL_PREFIX
    );
    expect(labels.get('a')).toBe('MT1');
    expect(labels.get('b')).toBe('MT2');
    expect(labels.size).toBe(2);
  });

  it('skips instances with no drawable polyline, consuming no number', () => {
    // A 1-point polyline draws no curve and so earns no badge on the exported
    // image. It must not consume a number either, or every later label would
    // be off by one against the image.
    const labels = buildInstanceLabelMap(
      [line('single', 1), line('real')],
      MICROTUBULE_LABEL_PREFIX
    );
    expect(labels.has('single')).toBe(false);
    expect(labels.get('real')).toBe('MT1');
  });

  it('ignores closed polygons and polylines without an instanceId', () => {
    const labels = buildInstanceLabelMap(
      [
        { geometry: 'polygon', instanceId: 'closed', points: [{ x: 0, y: 0 }] },
        line(null),
        line('kept'),
      ],
      MICROTUBULE_LABEL_PREFIX
    );
    expect(labels.has('closed')).toBe(false);
    expect(labels.get('kept')).toBe('MT1');
    expect(labels.size).toBe(1);
  });
});
