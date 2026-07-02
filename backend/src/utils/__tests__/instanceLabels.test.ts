/**
 * Unit tests for buildInstanceLabelMap — the single source of truth for the
 * per-instance polyline badge numbering shared by the export visualization
 * (draws "S1"/"MT1" on the image) and the MT metrics table (writes the same
 * label into a column). The two must never drift, so this locks the rule.
 */

import { describe, it, expect } from 'vitest';
import {
  buildInstanceLabelMap,
  SPERM_LABEL_PREFIX,
  MICROTUBULE_LABEL_PREFIX,
  type LabelablePolyline,
} from '../instanceLabels';

const pts = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

describe('buildInstanceLabelMap', () => {
  it('returns an empty map when there are no polylines', () => {
    expect(buildInstanceLabelMap([], MICROTUBULE_LABEL_PREFIX).size).toBe(0);
  });

  it('numbers unique instances in first-appearance order', () => {
    const polygons: LabelablePolyline[] = [
      { geometry: 'polyline', instanceId: 'b', points: pts },
      { geometry: 'polyline', instanceId: 'a', points: pts },
    ];
    const labels = buildInstanceLabelMap(polygons, MICROTUBULE_LABEL_PREFIX);
    // 'b' appears first, so it is MT1 (order, not id sort).
    expect(labels.get('b')).toBe('MT1');
    expect(labels.get('a')).toBe('MT2');
  });

  it('reuses one label across repeated segments of the same instance', () => {
    const polygons: LabelablePolyline[] = [
      { geometry: 'polyline', instanceId: 'a', points: pts },
      { geometry: 'polyline', instanceId: 'a', points: pts },
      { geometry: 'polyline', instanceId: 'b', points: pts },
    ];
    const labels = buildInstanceLabelMap(polygons, MICROTUBULE_LABEL_PREFIX);
    expect(labels.get('a')).toBe('MT1');
    expect(labels.get('b')).toBe('MT2');
    expect(labels.size).toBe(2);
  });

  it('skips closed polygons entirely', () => {
    const polygons: LabelablePolyline[] = [
      { geometry: 'polygon', instanceId: 'poly', points: pts },
      { geometry: 'polyline', instanceId: 'line', points: pts },
    ];
    const labels = buildInstanceLabelMap(polygons, MICROTUBULE_LABEL_PREFIX);
    expect(labels.has('poly')).toBe(false);
    expect(labels.get('line')).toBe('MT1');
  });

  it('does not label polylines without an instanceId', () => {
    const polygons: LabelablePolyline[] = [
      { geometry: 'polyline', points: pts },
      { geometry: 'polyline', instanceId: 'a', points: pts },
    ];
    const labels = buildInstanceLabelMap(polygons, MICROTUBULE_LABEL_PREFIX);
    // Only the instance with an id earns a number, and it is the first number.
    expect(labels.size).toBe(1);
    expect(labels.get('a')).toBe('MT1');
  });

  it('does not consume a number for an instance with only <2-point polylines', () => {
    const polygons: LabelablePolyline[] = [
      // 'a' only ever has a single point — never drawable, gets no badge.
      { geometry: 'polyline', instanceId: 'a', points: [{ x: 0, y: 0 }] },
      { geometry: 'polyline', instanceId: 'b', points: pts },
    ];
    const labels = buildInstanceLabelMap(polygons, MICROTUBULE_LABEL_PREFIX);
    expect(labels.has('a')).toBe(false);
    // 'b' is the first *drawable* instance, so it is MT1 (not MT2).
    expect(labels.get('b')).toBe('MT1');
  });

  it('numbers by FIRST-APPEARANCE, not first-drawable, order', () => {
    // 'a' appears first (via a <2-point, non-drawable polyline), then 'b'
    // becomes drawable first, then 'a' becomes drawable later. Numbering must
    // follow first appearance ('a' before 'b'), matching the visualization's
    // insertion order — NOT the order in which instances first became drawable.
    const polygons: LabelablePolyline[] = [
      { geometry: 'polyline', instanceId: 'a', points: [{ x: 0, y: 0 }] },
      { geometry: 'polyline', instanceId: 'b', points: pts },
      { geometry: 'polyline', instanceId: 'a', points: pts },
    ];
    const labels = buildInstanceLabelMap(polygons, MICROTUBULE_LABEL_PREFIX);
    expect(labels.get('a')).toBe('MT1');
    expect(labels.get('b')).toBe('MT2');
  });

  it('labels a mixed instance as drawable if any of its polylines has >=2 points', () => {
    const polygons: LabelablePolyline[] = [
      { geometry: 'polyline', instanceId: 'a', points: [{ x: 0, y: 0 }] },
      { geometry: 'polyline', instanceId: 'a', points: pts },
    ];
    const labels = buildInstanceLabelMap(polygons, MICROTUBULE_LABEL_PREFIX);
    expect(labels.get('a')).toBe('MT1');
  });

  it('honours the prefix argument', () => {
    const polygons: LabelablePolyline[] = [
      { geometry: 'polyline', instanceId: 'a', points: pts },
    ];
    expect(buildInstanceLabelMap(polygons, SPERM_LABEL_PREFIX).get('a')).toBe(
      'S1'
    );
  });
});
