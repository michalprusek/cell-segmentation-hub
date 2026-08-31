import { describe, it, expect } from 'vitest';
import {
  findSparseChannel,
  findStaticChannel,
  projectionDelta,
  projectPolygons,
  planSparseCollapse,
  planStaticCollapse,
  sparseFollowers,
  withMintedTrackIds,
  type ProjectablePolygon,
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
    expect(
      findStaticChannel([{ name: 'irm', staticSource: false }], 'irm')
    ).toBeNull();
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

describe('withMintedTrackIds', () => {
  /** The shape a freshly segmented microtubule frame actually has — read off
   *  production container 4972cad8 on 2026-08-31. Note what is NOT there: the
   *  model emits `instanceId`, never `trackId`. */
  const freshFromTheModel: ProjectablePolygon[] = [
    {
      id: 'polyline_1',
      points: [
        { x: 1786, y: 34 },
        { x: 1769.18, y: 37.46 },
      ],
      geometry: 'polyline',
      class: 'microtubule',
      instanceId: 'mt_a01c27c9',
      confidence: 1,
    },
    {
      id: 'polyline_2',
      points: [
        { x: 120, y: 900 },
        { x: 131.5, y: 902.25 },
      ],
      geometry: 'polyline',
      class: 'microtubule',
      instanceId: 'mt_7a7fa955',
      confidence: 1,
    },
  ];

  /** Deterministic, and — like the real generator — never repeats. */
  function counter(prefix = 'mt_'): () => string {
    let n = 0;
    return () => `${prefix}${++n}`;
  }

  it('gives a model result an id where it has none — the whole fix', () => {
    // Without this the projection copies `undefined` onto every frame and the
    // container ends up segmented with no cross-frame identity anywhere.
    const { polygons, minted } = withMintedTrackIds(
      freshFromTheModel,
      counter()
    );
    expect(minted).toBe(2);
    expect(polygons.map(p => p.trackId)).toEqual(['mt_1', 'mt_2']);
  });

  it('keeps an id the user already established', () => {
    // A hand-propagated polyline outranks a fresh id: replacing it would
    // detach the filament from the track the user built.
    const { polygons, minted } = withMintedTrackIds(
      [{ ...freshFromTheModel[0], trackId: 'mt_userpicked' }, freshFromTheModel[1]],
      counter()
    );
    expect(minted).toBe(1);
    expect(polygons.map(p => p.trackId)).toEqual(['mt_userpicked', 'mt_1']);
  });

  it('never reuses an id already on the frame', () => {
    // A collision would silently MERGE two filaments into one track — a wrong
    // answer that looks like a right one.
    const { polygons } = withMintedTrackIds(
      [{ ...freshFromTheModel[0], trackId: 'mt_1' }, freshFromTheModel[1]],
      counter()
    );
    expect(polygons[1].trackId).not.toBe('mt_1');
    expect(new Set(polygons.map(p => p.trackId)).size).toBe(2);
  });

  it('terminates and stays unique even for a degenerate generator', () => {
    // The uniqueness loop must not be able to hang the queue worker.
    const { polygons } = withMintedTrackIds(
      [
        { ...freshFromTheModel[0], trackId: 'same' },
        freshFromTheModel[1],
        { ...freshFromTheModel[1], id: 'polyline_3' },
      ],
      () => 'same'
    );
    expect(new Set(polygons.map(p => p.trackId)).size).toBe(3);
  });

  it('touches nothing else on the polygon', () => {
    const { polygons } = withMintedTrackIds(freshFromTheModel, counter());
    expect(polygons[0]).toEqual({ ...freshFromTheModel[0], trackId: 'mt_1' });
  });

  it('leaves the input array alone', () => {
    withMintedTrackIds(freshFromTheModel, counter());
    expect(freshFromTheModel[0]).not.toHaveProperty('trackId');
  });

  it('mints nothing when every polyline already has an id', () => {
    const tracked = freshFromTheModel.map((p, i) => ({
      ...p,
      trackId: `track_${i}`,
    }));
    const { polygons, minted } = withMintedTrackIds(tracked, counter());
    expect(minted).toBe(0);
    expect(polygons).toEqual(tracked);
  });

  it('mints a distinct id for all 60 filaments of the real frame', () => {
    // The production container carries 60 polylines per frame, all untracked.
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...freshFromTheModel[0],
      id: `polyline_${i + 1}`,
      instanceId: `mt_${i.toString(16).padStart(8, '0')}`,
    }));
    const { polygons, minted } = withMintedTrackIds(many, counter());
    expect(minted).toBe(60);
    expect(new Set(polygons.map(p => p.trackId)).size).toBe(60);
    expect(polygons.every(p => (p.trackId?.length ?? 0) > 0)).toBe(true);
  });

  it('treats an empty-string trackId as no id at all', () => {
    // `coerceNonEmptyString` in polygonValidation drops it on the way out, so
    // an empty string is indistinguishable from absent everywhere downstream.
    const { polygons, minted } = withMintedTrackIds(
      [{ ...freshFromTheModel[0], trackId: '' }],
      counter()
    );
    expect(minted).toBe(1);
    expect(polygons[0].trackId).toBe('mt_1');
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

// ---------------------------------------------------------------------------
// Sparse channels: the microscope only refreshed this one every N-th frame.
// ---------------------------------------------------------------------------

/** The reported case — a reference channel refreshed every 3rd frame.
 *  `sparseFill` is written by the extractor (`plane_coverage.py`). */
const sparseEveryThird: StaticChannelLike = {
  name: 'irm',
  sparseSource: true,
  sparseFill: { '1': 0, '2': 0, '4': 3, '5': 3, '7': 6, '8': 6 },
};

const nineFrames = Array.from({ length: 9 }, (_, i) => ({
  id: `f${i}`,
  frameIndex: i,
}));

describe('findSparseChannel', () => {
  it('finds a channel the extractor measured as sparse', () => {
    expect(findSparseChannel([sparseEveryThird], 'irm')?.name).toBe('irm');
  });

  it('refuses the flag without the map, and the map without the flag', () => {
    // Either alone is a half-written record, and acting on it would drop frames
    // from the queue with nothing able to fill them back in.
    expect(
      findSparseChannel([{ name: 'irm', sparseSource: true }], 'irm')
    ).toBeNull();
    expect(
      findSparseChannel([{ name: 'irm', sparseFill: { '1': 0 } }], 'irm')
    ).toBeNull();
  });

  it('refuses an EMPTY map — a channel with no gaps is not sparse', () => {
    // It would drop nothing from the queue but would still take the sparse
    // branch in the projection service, costing the static short-circuit.
    expect(
      findSparseChannel(
        [{ name: 'irm', sparseSource: true, sparseFill: {} }],
        'irm'
      )
    ).toBeNull();
  });

  it('does not mistake a static channel for a sparse one', () => {
    expect(findSparseChannel([staticNoAlign], 'irm')).toBeNull();
  });

  it('returns null for an unknown name, no name, or no channels', () => {
    expect(findSparseChannel([sparseEveryThird], 'tirf')).toBeNull();
    expect(findSparseChannel([sparseEveryThird], null)).toBeNull();
    expect(findSparseChannel(null, 'irm')).toBeNull();
  });
});

describe('planSparseCollapse', () => {
  it('segments only the real frames and projects each gap from ITS anchor', () => {
    // The piecewise part: frame 4 must NOT take frame 0's polylines just
    // because frame 0 is also an anchor.
    const plan = planSparseCollapse(sparseEveryThird, nineFrames);

    expect(plan.segment.map(f => f.id)).toEqual(['f0', 'f3', 'f6']);
    expect(plan.projectFrom.get('f0')?.map(f => f.id)).toEqual(['f1', 'f2']);
    expect(plan.projectFrom.get('f3')?.map(f => f.id)).toEqual(['f4', 'f5']);
    expect(plan.projectFrom.get('f6')?.map(f => f.id)).toEqual(['f7', 'f8']);
    expect(plan.unknownShift).toEqual([]);
  });

  it('leaves a gap alone when its anchor is not in this batch', () => {
    // A hand-picked selection that excludes the real frames. Segmenting a blank
    // plane is a wasted pass, but it is what happened before this existed, so
    // the fallback is never worse than the status quo — and it is never wrong.
    const selection = [nineFrames[4], nineFrames[5]];
    const plan = planSparseCollapse(sparseEveryThird, selection);

    expect(plan.projectFrom.size).toBe(0);
    expect(plan.unknownShift.map(f => f.id)).toEqual(['f4', 'f5']);
    expect(plan.segment.map(f => f.id)).toEqual(['f4', 'f5']);
  });

  it('mixes: an anchor in the batch fills its own gaps, the rest fall back', () => {
    const selection = [nineFrames[3], nineFrames[4], nineFrames[7]];
    const plan = planSparseCollapse(sparseEveryThird, selection);

    expect(plan.projectFrom.get('f3')?.map(f => f.id)).toEqual(['f4']);
    expect(plan.unknownShift.map(f => f.id)).toEqual(['f7']);
    expect(plan.segment.map(f => f.id)).toEqual(['f3', 'f7']);
  });

  it('changes nothing for a channel with no recorded gaps', () => {
    const plan = planSparseCollapse(
      { name: 'irm', sparseSource: true },
      nineFrames
    );
    expect(plan.segment).toHaveLength(9);
    expect(plan.projectFrom.size).toBe(0);
  });

  it('leaves frames the map says nothing about to segment themselves', () => {
    // The aborted-acquisition tail: the extractor deliberately records no fill
    // for a timepoint that was never imaged at all, so it must not be dropped.
    const withTail = [
      ...nineFrames,
      { id: 'f9', frameIndex: 9 },
      { id: 'f10', frameIndex: 10 },
    ];
    const plan = planSparseCollapse(sparseEveryThird, withTail);
    expect(plan.segment.map(f => f.id)).toEqual([
      'f0',
      'f3',
      'f6',
      'f9',
      'f10',
    ]);
  });

  it('collapses the real Well7 shape: 29 frames, one acquisition', () => {
    const fill: Record<string, number> = {};
    for (let i = 1; i < 29; i++) fill[String(i)] = 0;
    const many = Array.from({ length: 29 }, (_, i) => ({
      id: `f${i}`,
      frameIndex: i,
    }));

    const plan = planSparseCollapse(
      { name: 'Channel_1', sparseSource: true, sparseFill: fill },
      many
    );

    expect(plan.segment.map(f => f.id)).toEqual(['f0']);
    expect(plan.projectFrom.get('f0')).toHaveLength(28);
  });

  it('is zero-delta: a sparse channel records no per-frame shift', () => {
    // Which is what lets the projection reuse the static path unchanged.
    expect(projectionDelta(sparseEveryThird, 'f0', 'f1')).toEqual([0, 0]);
  });
});

describe('sparseFollowers', () => {
  it('claims exactly the gaps that read from this anchor', () => {
    expect(
      sparseFollowers(sparseEveryThird, 3, nineFrames).map(f => f.id)
    ).toEqual(['f4', 'f5']);
    expect(
      sparseFollowers(sparseEveryThird, 0, nineFrames).map(f => f.id)
    ).toEqual(['f1', 'f2']);
  });

  it('claims nothing for a frame that is nobody’s anchor', () => {
    expect(sparseFollowers(sparseEveryThird, 1, nineFrames)).toEqual([]);
  });

  it('resolves in INDEX space, ignoring the id-space mirror entirely', () => {
    // The invariant that keeps the queue collapse and the projection from
    // disagreeing: `planSparseCollapse` drops a gap on the strength of
    // `sparseFill`, so the projection has to fill in the SAME set. A container
    // whose `sparseFillFrameIds` never landed (or landed partially) must still
    // get every dropped frame back.
    const noIdMap: StaticChannelLike = {
      name: 'irm',
      sparseSource: true,
      sparseFill: sparseEveryThird.sparseFill,
    };
    const dropped = planSparseCollapse(noIdMap, nineFrames);
    const anchors = [...dropped.projectFrom.keys()];
    const refilled = anchors.flatMap(anchorId => {
      const idx = nineFrames.find(f => f.id === anchorId)!.frameIndex;
      return sparseFollowers(noIdMap, idx, nineFrames).map(f => f.id);
    });

    expect(refilled.sort()).toEqual(
      [...dropped.projectFrom.values()]
        .flat()
        .map(f => f.id)
        .sort()
    );
    expect(refilled).toHaveLength(6);
  });

  it('is empty for a channel with no map at all', () => {
    expect(sparseFollowers({ name: 'irm' }, 0, nineFrames)).toEqual([]);
  });
});
