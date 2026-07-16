import { describe, it, expect } from 'vitest';
import type { Polygon, Point } from '@/lib/segmentation';
import {
  canJoinPolylines,
  findJoinTarget,
  joinPolylinePoints,
  nearestEndpoint,
  endpointPoint,
} from './polylineJoin';

const line = (
  id: string,
  pts: Point[],
  extra: Partial<Polygon> = {}
): Polygon => ({
  id,
  points: pts,
  type: 'external',
  geometry: 'polyline',
  ...extra,
});

const A = line('a', [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
]);

describe('endpointPoint / nearestEndpoint', () => {
  it('resolves head and tail', () => {
    expect(endpointPoint(A, 'head')).toEqual({ x: 0, y: 0 });
    expect(endpointPoint(A, 'tail')).toEqual({ x: 10, y: 0 });
  });
  it('picks the nearer endpoint (ties → head)', () => {
    expect(nearestEndpoint(A, { x: 1, y: 0 })).toBe('head');
    expect(nearestEndpoint(A, { x: 9, y: 0 })).toBe('tail');
    expect(nearestEndpoint(A, { x: 5, y: 0 })).toBe('head'); // tie
  });
});

describe('canJoinPolylines', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  it('rejects self, non-polyline, and <2 points', () => {
    expect(canJoinPolylines(A, A, 'microtubules')).toBe(false);
    const poly = line('p', A.points, { geometry: 'polygon' });
    expect(canJoinPolylines(A, poly, 'microtubules')).toBe(false);
    const short = line('s', [{ x: 0, y: 0 }]);
    expect(canJoinPolylines(A, short, 'microtubules')).toBe(false);
  });
  it('microtubule: joins same mtType incl. both untyped, rejects different', () => {
    expect(canJoinPolylines(A, B, 'microtubules')).toBe(true); // both undefined
    const at = line('a', A.points, { mtType: 't1' });
    const bt = line('b', B.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    expect(canJoinPolylines(at, bt, 'microtubules')).toBe(true);
    expect(canJoinPolylines(at, bx, 'microtubules')).toBe(false);
  });
  it('sperm: joins same partClass, rejects different', () => {
    const at = line('a', A.points, { partClass: 'tail' });
    const bt = line('b', B.points, { partClass: 'tail' });
    const bh = line('b', B.points, { partClass: 'head' });
    expect(canJoinPolylines(at, bt, 'sperm')).toBe(true);
    expect(canJoinPolylines(at, bh, 'sperm')).toBe(false);
  });
  it('generic: joins any two polylines regardless of fields', () => {
    const at = line('a', A.points, { partClass: 'tail' });
    const bh = line('b', B.points, { partClass: 'head' });
    expect(canJoinPolylines(at, bh, 'spheroid')).toBe(true);
  });
});

describe('findJoinTarget', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  const polygons = [A, B];
  it('returns the nearest foreign endpoint within range', () => {
    const t = findJoinTarget(polygons, A, { x: 21, y: 0 }, 5, 'microtubules');
    expect(t).toEqual({ polygonId: 'b', endpoint: 'head', distanceSq: 1 });
  });
  it('returns null when nothing is in range', () => {
    expect(
      findJoinTarget(polygons, A, { x: 100, y: 100 }, 5, 'microtubules')
    ).toBeNull();
  });
  it('ignores the source polyline itself', () => {
    // click right on A's own tail — must not return A
    const t = findJoinTarget(polygons, A, { x: 10, y: 0 }, 5, 'microtubules');
    expect(t).toBeNull();
  });
  it('skips class-mismatched candidates', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    expect(
      findJoinTarget([at, bx], at, { x: 20, y: 0 }, 5, 'microtubules')
    ).toBeNull();
  });
});

describe('joinPolylinePoints', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  it('tail→head: A as-is then B as-is', () => {
    expect(joinPolylinePoints(A, 'tail', B, 'head', [])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });
  it('tail→tail: A as-is then B reversed', () => {
    expect(joinPolylinePoints(A, 'tail', B, 'tail', [])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 30, y: 0 },
      { x: 20, y: 0 },
    ]);
  });
  it('head→head: A reversed then B as-is', () => {
    expect(joinPolylinePoints(A, 'head', B, 'head', [])).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });
  it('inserts bridge points between the two', () => {
    expect(joinPolylinePoints(A, 'tail', B, 'head', [{ x: 15, y: 5 }])).toEqual(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 15, y: 5 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ]
    );
  });
});
