import { describe, it, expect } from 'vitest';
import {
  findStaticChannel,
  projectionDelta,
  projectPolygons,
  planStaticCollapse,
  type StaticChannelLike,
} from '../staticChannelProjection';

const staticNoAlign: StaticChannelLike = { name: 'irm', staticSource: true };

const staticAligned: StaticChannelLike = {
  name: 'irm',
  staticSource: true,
  staticShifts: {
    f0: [0, 0],
    f1: [3, -2],
    f2: [7, 5],
  },
};

const frames = [
  { id: 'f0', frameIndex: 0 },
  { id: 'f1', frameIndex: 1 },
  { id: 'f2', frameIndex: 2 },
];

describe('findStaticChannel', () => {
  it('finds a channel that was built from one image', () => {
    expect(findStaticChannel([staticNoAlign], 'irm')?.name).toBe('irm');
  });

  it('refuses a channel that is merely uniform, without the flag', () => {
    // "The pixels look the same" is not the same claim as "this came from one
    // image", and only the second one licenses skipping the work.
    expect(findStaticChannel([{ name: 'irm' }], 'irm')).toBeNull();
    expect(findStaticChannel([{ name: 'irm', staticSource: false }], 'irm')).toBeNull();
  });

  it('returns null for an unknown name, no name, or no channels', () => {
    expect(findStaticChannel([staticNoAlign], '640_nm')).toBeNull();
    expect(findStaticChannel([staticNoAlign], undefined)).toBeNull();
    expect(findStaticChannel(null, 'irm')).toBeNull();
  });
});

describe('projectionDelta', () => {
  it('is zero everywhere when the channel was added without alignment', () => {
    expect(projectionDelta(staticNoAlign, 'f0', 'f2')).toEqual([0, 0]);
  });

  it('is the difference of the two recorded shifts', () => {
    expect(projectionDelta(staticAligned, 'f1', 'f2')).toEqual([4, 7]);
    expect(projectionDelta(staticAligned, 'f2', 'f1')).toEqual([-4, -7]);
    expect(projectionDelta(staticAligned, 'f1', 'f1')).toEqual([0, 0]);
  });

  it('refuses rather than assuming zero when a shift is unknown', () => {
    // The dangerous failure: an unrecorded offset treated as none would place
    // filaments somewhere they are not, and look entirely plausible.
    expect(projectionDelta(staticAligned, 'f0', 'missing')).toBeNull();
    expect(projectionDelta(staticAligned, 'missing', 'f0')).toBeNull();
  });
});

describe('projectPolygons', () => {
  const polys = [
    {
      points: [
        { x: 10, y: 20 },
        { x: 12, y: 24 },
      ],
      trackId: 'mt_a',
      mtType: 'growing',
    },
    { points: [{ x: 0, y: 0 }], trackId: 'mt_b' },
  ];

  it('carries trackId across unchanged — identity is the whole point', () => {
    const out = projectPolygons(polys, [3, -2]);
    expect(out.map(p => p.trackId)).toEqual(['mt_a', 'mt_b']);
  });

  it('translates by (dx, dy) with dy applied to y', () => {
    const out = projectPolygons(polys, [3, -2]);
    expect(out[0].points).toEqual([
      { x: 8, y: 23 },
      { x: 10, y: 27 },
    ]);
    expect(out[1].points).toEqual([{ x: -2, y: 3 }]);
  });

  it('preserves unrelated fields', () => {
    expect(projectPolygons(polys, [1, 1])[0].mtType).toBe('growing');
  });

  it('deep-copies points so a projected frame cannot mutate the source', () => {
    const out = projectPolygons(polys, [0, 0]);
    out[0].points[0].x = 999;
    expect(polys[0].points[0].x).toBe(10);
  });

  it('is a faithful copy at zero shift', () => {
    const out = projectPolygons(polys, [0, 0]);
    expect(out[0].points).toEqual(polys[0].points);
  });
});

describe('planStaticCollapse', () => {
  it('segments one frame and projects onto the rest', () => {
    const plan = planStaticCollapse(staticAligned, frames);
    expect(plan.segment.map(f => f.id)).toEqual(['f0']);
    expect(plan.projectFrom.get('f0')?.map(f => f.id)).toEqual(['f1', 'f2']);
    expect(plan.unknownShift).toEqual([]);
  });

  it('picks the lowest-index frame that actually has a usable shift', () => {
    // Choosing f0 blindly would make every projection from it unusable, so the
    // representative has to be a frame whose own offset is known.
    const ch: StaticChannelLike = {
      name: 'irm',
      staticSource: true,
      staticShifts: { f1: [1, 1], f2: [2, 2] },
    };
    const plan = planStaticCollapse(ch, frames);
    expect(plan.segment[0].id).toBe('f1');
    expect(plan.projectFrom.get('f1')?.map(f => f.id)).toEqual(['f2']);
    expect(plan.unknownShift.map(f => f.id)).toEqual(['f0']);
    // f0 still gets segmented normally rather than being dropped.
    expect(plan.segment.map(f => f.id)).toContain('f0');
  });

  it('segments everything when no frame has a usable shift', () => {
    const ch: StaticChannelLike = {
      name: 'irm',
      staticSource: true,
      staticShifts: {},
    };
    const plan = planStaticCollapse(ch, frames);
    expect(plan.segment.map(f => f.id)).toEqual(['f0', 'f1', 'f2']);
    expect(plan.projectFrom.size).toBe(0);
  });

  it('leaves frames outside the channel coverage to segment themselves', () => {
    const ch: StaticChannelLike = {
      name: 'irm',
      staticSource: true,
      frameIds: ['f0', 'f1'],
    };
    const plan = planStaticCollapse(ch, frames);
    expect(plan.projectFrom.get('f0')?.map(f => f.id)).toEqual(['f1']);
    expect(plan.segment.map(f => f.id)).toContain('f2');
  });

  it('does nothing for a single covered frame', () => {
    const plan = planStaticCollapse(staticNoAlign, [frames[0]]);
    expect(plan.segment.map(f => f.id)).toEqual(['f0']);
    expect(plan.projectFrom.size).toBe(0);
  });

  it('orders by frameIndex, not by input order', () => {
    const shuffled = [frames[2], frames[0], frames[1]];
    const plan = planStaticCollapse(staticAligned, shuffled);
    expect(plan.segment[0].id).toBe('f0');
    expect(plan.projectFrom.get('f0')?.map(f => f.id)).toEqual(['f1', 'f2']);
  });

  it('collapses 299 frames to one segmentation', () => {
    // The shape of the real container this exists for.
    const many = Array.from({ length: 299 }, (_, i) => ({
      id: `f${i}`,
      frameIndex: i,
    }));
    const plan = planStaticCollapse(staticNoAlign, many);
    expect(plan.segment).toHaveLength(1);
    expect(plan.projectFrom.get('f0')).toHaveLength(298);
  });
});
