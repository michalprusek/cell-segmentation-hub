import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { buildObjects, pointInRing, ringArea, type MlItem } from '../objects';

const ring = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('geometry helpers', () => {
  it('measures a ring by the shoelace formula, whatever its winding', () => {
    const square: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ];
    expect(ringArea(square)).toBe(12);
    expect(ringArea([...square].reverse())).toBe(12);
  });

  it('tests containment by even-odd', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(pointInRing([5, 5], square)).toBe(true);
    expect(pointInRing([15, 5], square)).toBe(false);
    expect(pointInRing([5, -1], square)).toBe(false);
  });
});

describe('buildObjects: the contour hierarchy', () => {
  it('turns OpenCV depth 0-4 into objects at even depth that own the holes at odd depth', () => {
    const fixture = JSON.parse(
      readFileSync(
        path.join(__dirname, 'fixtures', 'contours_nested.json'),
        'utf8'
      )
    );
    // ring > hole > island > hole > speck, plus one separate bar: every
    // nested contour is typed `internal` by the ML service, islands included.
    expect(fixture.max_depth).toBe(4);
    expect(
      fixture.polygons.filter((p: MlItem) => p.type === 'internal')
    ).toHaveLength(4);

    const { objects, warnings } = buildObjects('hrnet', fixture.polygons, []);

    expect(warnings).toEqual([]);
    expect(objects).toHaveLength(4);
    expect(objects.map(o => o.label)).toEqual([1, 2, 3, 4]);
    // Two of the four own exactly one hole each; holes never nest further.
    expect(objects.map(o => o.holes?.length ?? 0).sort()).toEqual([0, 0, 1, 1]);
    for (const object of objects) {
      expect(object.geometry).toBe('polygon');
      expect(object.class).toBe('spheroid');
    }
    // An object and the hole it owns are concentric: the hole is inside it.
    for (const object of objects.filter(o => o.holes)) {
      expect(pointInRing(object.holes![0][0], object.points)).toBe(true);
      expect(ringArea(object.holes![0])).toBeLessThan(ringArea(object.points));
    }
  });

  it('attaches a hole whose parent was filtered out to the smallest object containing it', () => {
    const { objects, warnings } = buildObjects(
      'hrnet',
      [
        { id: 'big', type: 'external', points: ring(0, 0, 100, 100) },
        { id: 'small', type: 'external', points: ring(200, 200, 260, 260) },
        // parent_id names a contour the ML service dropped (< 50 px)
        { id: 'h', type: 'internal', parent_id: 'gone', points: ring(210, 210, 220, 220) },
      ],
      []
    );
    expect(warnings).toEqual([]);
    expect(objects).toHaveLength(2);
    expect(objects[0].holes).toBeUndefined();
    expect(objects[1].holes).toEqual([
      [
        [210, 210],
        [220, 210],
        [220, 220],
        [210, 220],
      ],
    ]);
  });

  it('picks the SMALLEST container when several contain the orphan', () => {
    const { objects } = buildObjects(
      'hrnet',
      [
        { id: 'outer', type: 'external', points: ring(0, 0, 100, 100) },
        { id: 'inner', type: 'external', points: ring(20, 20, 60, 60) },
        { id: 'h', type: 'internal', points: ring(30, 30, 40, 40) },
      ],
      []
    );
    expect(objects[0].holes).toBeUndefined();
    expect(objects[1].holes).toHaveLength(1);
  });

  it('drops a hole nothing contains, and says so', () => {
    const { objects, warnings } = buildObjects(
      'hrnet',
      [
        { id: 'a', type: 'external', points: ring(0, 0, 10, 10) },
        { id: 'h', type: 'internal', points: ring(500, 500, 510, 510) },
      ],
      []
    );
    expect(objects).toHaveLength(1);
    expect(warnings.map(w => w.code)).toEqual(['orphan_holes_dropped']);
  });

  it('survives a parent_id cycle', () => {
    const { objects } = buildObjects(
      'hrnet',
      [
        { id: 'a', type: 'internal', parent_id: 'b', points: ring(0, 0, 10, 10) },
        { id: 'b', type: 'internal', parent_id: 'a', points: ring(2, 2, 8, 8) },
      ],
      []
    );
    expect(objects).toEqual([]);
  });

  it('drops degenerate and non-finite geometry with a warning', () => {
    const { objects, warnings } = buildObjects(
      'hrnet',
      [
        { id: 'ok', type: 'external', points: ring(0, 0, 10, 10) },
        { id: 'two', type: 'external', points: ring(0, 0, 10, 10).slice(0, 2) },
        {
          id: 'nan',
          type: 'external',
          points: [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 2, y: 2 }],
        },
        {
          id: 'inf',
          type: 'external',
          points: [{ x: 0, y: 0 }, { x: Infinity, y: 1 }, { x: 2, y: 2 }],
        },
      ],
      [{ id: 'one', points: [{ x: 1, y: 1 }] }]
    );
    expect(objects).toHaveLength(1);
    expect(warnings).toEqual([
      {
        code: 'invalid_geometry_dropped',
        detail: '4 object(s) with too few or non-finite points were dropped.',
      },
    ]);
  });
});

describe('buildObjects: classes, parts and instances per model', () => {
  it('reports disintegration cores by their own class', () => {
    const { objects } = buildObjects(
      'spheroid_disintegration',
      [
        { id: 'f', type: 'external', class: 'spheroid', points: ring(0, 0, 50, 50) },
        {
          id: 'c',
          type: 'external',
          class: 'spheroid',
          partClass: 'core',
          points: ring(10, 10, 30, 30),
        },
      ],
      []
    );
    expect(objects.map(o => o.class)).toEqual(['spheroid', 'core']);
    expect(objects.every(o => o.part === undefined)).toBe(true);
  });

  it('keeps sperm parts as parts of an instance, after any polygons', () => {
    const line = (y: number) => [
      { x: 0.5, y },
      { x: 9.25, y: y + 0.125 },
    ];
    const { objects } = buildObjects(
      'sperm',
      [],
      [
        { id: 'p0', class: 'sperm', partClass: 'head', instanceId: 'sperm_0', points: line(1) },
        { id: 'p1', class: 'sperm', partClass: 'tail', instanceId: 'sperm_0', points: line(2) },
      ]
    );
    expect(objects).toEqual([
      {
        label: 1,
        geometry: 'polyline',
        class: 'sperm',
        part: 'head',
        instance: 'sperm_0',
        points: [
          [0.5, 1],
          [9.25, 1.125],
        ],
      },
      {
        label: 2,
        geometry: 'polyline',
        class: 'sperm',
        part: 'tail',
        instance: 'sperm_0',
        points: [
          [0.5, 2],
          [9.25, 2.125],
        ],
      },
    ]);
  });

  it('does not pass on the microtubule model per-call random instance id', () => {
    const { objects } = buildObjects(
      'microtubule',
      [],
      [
        {
          id: 'm',
          class: 'microtubule',
          instanceId: 'mt_1a2b3c4d',
          confidence: 1,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
        },
      ]
    );
    expect(objects[0]).toEqual({
      label: 1,
      geometry: 'polyline',
      class: 'microtubule',
      confidence: 1,
      points: [
        [0, 0],
        [5, 5],
      ],
    });
  });

  it('carries microcapsule completeness and class', () => {
    const { objects } = buildObjects(
      'microcapsule',
      [
        { id: 'a', type: 'external', class: 'microcapsule', complete: false, confidence: 0.9, points: ring(0, 0, 9, 9) },
        { id: 'b', type: 'external', class: 'membrane', complete: true, points: ring(0, 0, 12, 12) },
      ],
      []
    );
    expect(objects.map(o => [o.class, o.complete, o.confidence])).toEqual([
      ['microcapsule', false, 0.9],
      ['membrane', true, undefined],
    ]);
  });

  it('falls back to the model first class for an unrecognised one', () => {
    const { objects } = buildObjects(
      'wound',
      [{ id: 'a', type: 'external', class: 'something-new', points: ring(0, 0, 9, 9) }],
      []
    );
    expect(objects[0].class).toBe('wound');
  });
});
