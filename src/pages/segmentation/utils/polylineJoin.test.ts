import { describe, it, expect } from 'vitest';
import type { Polygon, Point } from '@/lib/segmentation';
import {
  joinClassesCompatible,
  findJoinTarget,
  scanJoinTargets,
  inheritJoinClass,
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

describe('joinClassesCompatible', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  // The structural guards are scanJoinTargets' job, not this predicate's —
  // asserted on the live path so they keep their coverage now that the old
  // `canJoinPolylines` wrapper (which merged both concerns) is gone.
  it('the live scan rejects self, non-polyline and <2-point candidates', () => {
    const at = { x: 20, y: 0 };
    expect(findJoinTarget([A], A, at, 5, 'microtubules')).toBeNull();
    const poly = line('p', B.points, { geometry: 'polygon' });
    expect(findJoinTarget([A, poly], A, at, 5, 'microtubules')).toBeNull();
    const short = line('s', [{ x: 20, y: 0 }]);
    expect(findJoinTarget([A, short], A, at, 5, 'microtubules')).toBeNull();
  });
  it('microtubule: joins same mtType incl. both untyped, rejects different', () => {
    expect(joinClassesCompatible(A, B, 'microtubules')).toBe(true); // both undefined
    const at = line('a', A.points, { mtType: 't1' });
    const bt = line('b', B.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    expect(joinClassesCompatible(at, bt, 'microtubules')).toBe(true);
    expect(joinClassesCompatible(at, bx, 'microtubules')).toBe(false);
  });
  // Reported 2026-09-04: joining "did not work" because one microtubule was
  // labelled and the other was not yet. An unlabelled side joins ANY label,
  // in either direction.
  it('microtubule: an UNLABELLED polyline joins a labelled one, both ways', () => {
    const typed = line('a', A.points, { mtType: 't1' });
    const untyped = line('b', B.points);
    expect(joinClassesCompatible(typed, untyped, 'microtubules')).toBe(true);
    expect(
      joinClassesCompatible(
        line('a', A.points),
        line('b', B.points, { mtType: 't1' }),
        'microtubules'
      )
    ).toBe(true);
  });
  it('microtubule: null / empty-string mtType count as unlabelled, not as a distinct label', () => {
    const typed = line('a', A.points, { mtType: 't1' });
    // `null` reaches the editor from paths that skip the null→undefined
    // normalisation; it must behave exactly like `undefined`.
    const nulled = line('b', B.points, {
      mtType: null as unknown as string,
    });
    const empty = line('b', B.points, { mtType: '' });
    expect(joinClassesCompatible(typed, nulled, 'microtubules')).toBe(true);
    expect(joinClassesCompatible(typed, empty, 'microtubules')).toBe(true);
    // …and two unlabelled ones still join when they disagree on WHICH
    // flavour of unlabelled they are.
    expect(
      joinClassesCompatible(nulled, line('a', A.points), 'microtubules')
    ).toBe(true);
  });
  it('sperm: joins same partClass, rejects different', () => {
    const at = line('a', A.points, { partClass: 'tail' });
    const bt = line('b', B.points, { partClass: 'tail' });
    const bh = line('b', B.points, { partClass: 'head' });
    expect(joinClassesCompatible(at, bt, 'sperm')).toBe(true);
    expect(joinClassesCompatible(at, bh, 'sperm')).toBe(false);
  });
  it('sperm: an unclassed polyline joins a classed one', () => {
    const at = line('a', A.points, { partClass: 'tail' });
    const plain = line('b', B.points);
    expect(joinClassesCompatible(at, plain, 'sperm')).toBe(true);
    expect(joinClassesCompatible(plain, at, 'sperm')).toBe(true);
  });
  it('microtubule: partClass is NOT the gate (and vice versa for sperm)', () => {
    // Cross-check that the kind picks the right field — an mtType clash must
    // not block a sperm join and a partClass clash must not block an MT one.
    const a = line('a', A.points, { mtType: 't1', partClass: 'head' });
    const b = line('b', B.points, { mtType: 't1', partClass: 'tail' });
    expect(joinClassesCompatible(a, b, 'microtubules')).toBe(true);
    expect(joinClassesCompatible(a, b, 'sperm')).toBe(false);
  });
  it('generic: joins any two polylines regardless of fields', () => {
    const at = line('a', A.points, { partClass: 'tail' });
    const bh = line('b', B.points, { partClass: 'head' });
    expect(joinClassesCompatible(at, bh, 'spheroid')).toBe(true);
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
  it('does not offer a farther compatible endpoint when a mismatched one is nearer', () => {
    // The hover ring must follow the same rule as the click, or it would
    // advertise a merge into a polyline that is not the one under the cursor.
    const at = line('a', A.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    const ok = line('c', [
      { x: 25, y: 0 },
      { x: 40, y: 0 },
    ]);
    expect(
      findJoinTarget([at, bx, ok], at, { x: 21, y: 0 }, 5, 'microtubules')
    ).toBeNull();
  });
  it('finds an unlabelled candidate for a labelled source', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const plain = line('b', B.points);
    expect(
      findJoinTarget([at, plain], at, { x: 20, y: 0 }, 5, 'microtubules')
    ).toEqual({ polygonId: 'b', endpoint: 'head', distanceSq: 0 });
  });
});

describe('scanJoinTargets', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  it('reports a class-mismatched neighbour as blockedByClass', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    const scan = scanJoinTargets(
      [at, bx],
      at,
      { x: 21, y: 0 },
      5,
      'microtubules'
    );
    expect(scan.target).toBeNull();
    expect(scan.blockedByClass).toEqual({
      polygonId: 'b',
      endpoint: 'head',
      distanceSq: 1,
    });
  });
  // The NEAREST endpoint decides, compatible or not. Preferring the nearest
  // COMPATIBLE one would merge into a polyline the user did not click.
  it('refuses when the NEAREST endpoint is mismatched, even with a compatible one in range', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' }); // head at 20 → dSq 1
    const ok = line('c', [
      { x: 25, y: 0 }, // → dSq 16, also in range
      { x: 40, y: 0 },
    ]);
    const scan = scanJoinTargets(
      [at, bx, ok],
      at,
      { x: 21, y: 0 },
      5,
      'microtubules'
    );
    expect(scan.target).toBeNull();
    expect(scan.blockedByClass?.polygonId).toBe('b');
  });

  it('joins when the nearest endpoint is the compatible one', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' }); // head at 20 → dSq 4
    const ok = line('c', [
      { x: 22, y: 0 }, // → dSq 0
      { x: 40, y: 0 },
    ]);
    const scan = scanJoinTargets(
      [at, bx, ok],
      at,
      { x: 22, y: 0 },
      5,
      'microtubules'
    );
    expect(scan.target?.polygonId).toBe('c');
    expect(scan.blockedByClass).toBeNull();
  });
  it('reports neither when the mismatched endpoint is out of range', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    const scan = scanJoinTargets(
      [at, bx],
      at,
      { x: 100, y: 100 },
      5,
      'microtubules'
    );
    expect(scan).toEqual({ target: null, blockedByClass: null });
  });
  it('generic projects never block on class', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    const scan = scanJoinTargets([at, bx], at, { x: 21, y: 0 }, 5, 'spheroid');
    expect(scan.target?.polygonId).toBe('b');
    expect(scan.blockedByClass).toBeNull();
  });
});

describe('inheritJoinClass', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  it('an unlabelled A takes B’s mtType', () => {
    expect(
      inheritJoinClass(A, line('b', B.points, { mtType: 't1' }), 'microtubules')
    ).toEqual({ mtType: 't1' });
  });
  it('an unclassed A takes B’s partClass', () => {
    expect(
      inheritJoinClass(A, line('b', B.points, { partClass: 'tail' }), 'sperm')
    ).toEqual({ partClass: 'tail' });
  });
  it('a labelled A keeps its own label', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const bt = line('b', B.points, { mtType: 't1' });
    expect(inheritJoinClass(at, bt, 'microtubules')).toEqual({});
  });
  it('two unlabelled sides inherit nothing', () => {
    expect(inheritJoinClass(A, B, 'microtubules')).toEqual({});
    // …including when the "unlabelled" is a raw null on either side.
    expect(
      inheritJoinClass(
        A,
        line('b', B.points, { mtType: null as unknown as string }),
        'microtubules'
      )
    ).toEqual({});
  });
  it('generic projects inherit nothing even when B carries fields', () => {
    expect(
      inheritJoinClass(
        A,
        line('b', B.points, { partClass: 'tail' }),
        'spheroid'
      )
    ).toEqual({});
  });
  it('does not cross the field over between project kinds', () => {
    // A sperm project must never copy an mtType, and vice versa.
    expect(
      inheritJoinClass(A, line('b', B.points, { mtType: 't1' }), 'sperm')
    ).toEqual({});
    expect(
      inheritJoinClass(
        A,
        line('b', B.points, { partClass: 'tail' }),
        'microtubules'
      )
    ).toEqual({});
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
