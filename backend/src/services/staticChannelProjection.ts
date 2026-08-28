/**
 * Segment a static channel ONCE and project the result onto its other frames.
 *
 * A channel added from a single source image (`ChannelMeta.staticSource`) shows
 * the SAME picture on every frame it covers — a fixed IRM snapshot laid over a
 * time-lapse is the usual case. Segmenting it frame by frame therefore repeats
 * one piece of work N times and produces N detection sets that are identical by
 * construction, which the tracker is then asked to rediscover.
 *
 * That is not hypothetical. Production, 2026-08-20: one container reported
 * `299 frames, 30498 polylines, 102 tracklets -> 102 tracks` — a single set of
 * 102 filaments, found 299 times, at a tracking cost that overran the caller's
 * timeout so the answer was computed and thrown away. Both halves of that are
 * removed by not doing the work twice.
 *
 * Cross-frame identity becomes exact rather than inferred: every projected
 * polyline carries the reference frame's `trackId`, because it IS the same
 * object, not a match for it.
 *
 * ALIGNMENT. When such a channel is added with alignment on, each frame's copy
 * is the source image registered to that frame's own segmentation channel — so
 * the copies are translations of one another, not byte-identical. The applied
 * shifts are recorded at add time (`ChannelMeta.staticShifts`), so a projection
 * moves the geometry by the difference between the target's shift and the
 * reference's. With alignment off there are no recorded shifts and every
 * difference is zero, which is the same code path.
 *
 * A frame whose shift is NOT recorded is deliberately excluded rather than
 * assumed to be zero: an unknown offset silently treated as none would place
 * filaments in the wrong spot, and being slow is better than being wrong.
 *
 * SPARSE CHANNELS (`ChannelMeta.sparseSource`) are the same idea one step
 * further out. There the picture is not shared by every frame, only by a RUN of
 * them: a microscope that refreshes IRM every N-th timepoint leaves the frames
 * in between holding a constant fill, and each of those reads from the last real
 * frame before it. So the collapse is piecewise — one anchor per run instead of
 * one for the container — and `planSparseCollapse` is `planStaticCollapse` with
 * that single generalisation. Everything downstream of the plan is shared,
 * including the zero delta (a sparse channel is never registered per frame, so
 * `projectionDelta` returns `[0, 0]` for it).
 */

export interface ProjectionPoint {
  x: number;
  y: number;
}

export interface ProjectablePolygon {
  points: ProjectionPoint[];
  trackId?: string | null;
  [key: string]: unknown;
}

/** (dy, dx) as stored by the aligner: row shift first, column shift second. */
export type Shift = readonly [number, number];

export interface StaticChannelLike {
  name: string;
  staticSource?: boolean;
  staticShifts?: Record<string, Shift>;
  frameIds?: string[];
  /** See `ChannelMeta.sparseSource` — a channel the microscope refreshed only
   *  every N-th frame, so the frames in between hold no acquisition at all. */
  sparseSource?: boolean;
  /** Gap frameIndex (stringified) -> the frameIndex it reads from. */
  sparseFill?: Record<string, number>;
  /** The same relation in id space: gap frame Image id -> anchor Image id. */
  sparseFillFrameIds?: Record<string, string>;
}

/**
 * Shift to apply when moving geometry from `refFrameId` to `targetFrameId`.
 *
 * Returns null when either frame's own shift is unknown — see the note above on
 * why that is not treated as zero. `[0, 0]` when the channel records no shifts
 * at all, which means it was added without alignment and every copy is the same
 * pixels.
 */
export function projectionDelta(
  channel: StaticChannelLike,
  refFrameId: string,
  targetFrameId: string
): Shift | null {
  const shifts = channel.staticShifts;
  if (!shifts) {
    return [0, 0];
  }
  const ref = shifts[refFrameId];
  const target = shifts[targetFrameId];
  if (!ref || !target) {
    return null;
  }
  return [target[0] - ref[0], target[1] - ref[1]];
}

/**
 * Copy polygons onto another frame, translated by `delta`.
 *
 * `trackId` is carried across unchanged — that is the entire point. Every other
 * field is preserved so a consumer that reads e.g. `mtType` or `confidence`
 * sees what the reference frame saw.
 */
export function projectPolygons<T extends ProjectablePolygon>(
  polygons: readonly T[],
  delta: Shift
): T[] {
  const [dy, dx] = delta;
  if (dy === 0 && dx === 0) {
    return polygons.map(p => ({
      ...p,
      points: p.points.map(pt => ({ ...pt })),
    }));
  }
  return polygons.map(p => ({
    ...p,
    points: p.points.map(pt => ({ ...pt, x: pt.x + dx, y: pt.y + dy })),
  }));
}

export interface CollapsePlan<TFrame> {
  /** The frames to actually segment. */
  segment: TFrame[];
  /** Frames whose result will be projected, keyed by the frame that produces it. */
  projectFrom: Map<string, TFrame[]>;
  /** Frames that must be segmented normally because their shift is unknown. */
  unknownShift: TFrame[];
}

/**
 * Decide which frames of one container actually need segmenting.
 *
 * The representative is the frame with the LOWEST index that has a usable
 * shift, not simply the first: picking a frame whose own offset is unknown
 * would make every projection from it unusable.
 */
export function planStaticCollapse<
  TFrame extends { id: string; frameIndex: number | null },
>(channel: StaticChannelLike, frames: readonly TFrame[]): CollapsePlan<TFrame> {
  const covered = channel.frameIds
    ? frames.filter(f => channel.frameIds?.includes(f.id))
    : [...frames];
  const ordered = [...covered].sort(
    (a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0)
  );

  const empty: CollapsePlan<TFrame> = {
    segment: [...frames],
    projectFrom: new Map(),
    unknownShift: [],
  };
  if (ordered.length <= 1) {
    return empty;
  }

  const shifts = channel.staticShifts;
  const hasShift = (f: TFrame): boolean => !shifts || shifts[f.id] !== undefined;

  const reference = ordered.find(hasShift);
  if (!reference) {
    return empty;
  }

  const followers: TFrame[] = [];
  const unknownShift: TFrame[] = [];
  for (const f of ordered) {
    if (f.id === reference.id) {
      continue;
    }
    (hasShift(f) ? followers : unknownShift).push(f);
  }

  // Frames outside this channel's coverage still need segmenting on their own.
  const coveredIds = new Set(ordered.map(f => f.id));
  const uncovered = frames.filter(f => !coveredIds.has(f.id));

  return {
    segment: [reference, ...unknownShift, ...uncovered],
    projectFrom: followers.length
      ? new Map([[reference.id, followers]])
      : new Map(),
    unknownShift,
  };
}

/**
 * The sparse channel with this name on a container, or null.
 *
 * As strict as `findStaticChannel` and for the same reason: `sparseSource` is a
 * fact the extractor measured on the source volume, not a guess made later from
 * how the pixels happen to look.
 */
export function findSparseChannel(
  channels: readonly StaticChannelLike[] | null | undefined,
  channelName: string | null | undefined
): StaticChannelLike | null {
  if (!channelName || !Array.isArray(channels)) {
    return null;
  }
  const meta = channels.find(c => c?.name === channelName);
  if (meta?.sparseSource !== true) {
    return null;
  }
  // An EMPTY map is not a sparse channel. It would drop nothing from the queue
  // (correct) while still taking the sparse branch in the projection service
  // (wrong), so a channel with no gaps at all would lose the static
  // short-circuit for no reason.
  return meta.sparseFill && Object.keys(meta.sparseFill).length > 0
    ? meta
    : null;
}

/**
 * The gap frames that read from `anchorFrameIndex`, out of `frames`.
 *
 * Index space on purpose. The queue-side collapse (`planSparseCollapse`) drops
 * a gap frame from the batch on the strength of `sparseFill`, and the DB-side
 * projection has to be able to fill in EXACTLY the frames that were dropped. If
 * the two consulted different fields — `sparseFill` here and the id-keyed
 * `sparseFillFrameIds` there — a container that has one but not the other would
 * have its gaps dropped from the queue AND never projected, leaving them at
 * `no_segmentation` with nothing raising a word about it. `sparseFillFrameIds`
 * is a rendering optimisation and is deliberately not load-bearing for either.
 */
export function sparseFollowers<
  TFrame extends { id: string; frameIndex: number | null },
>(
  channel: StaticChannelLike,
  anchorFrameIndex: number,
  frames: readonly TFrame[]
): TFrame[] {
  const fill = channel.sparseFill;
  if (!fill) {
    return [];
  }
  return frames.filter(
    f =>
      f.frameIndex !== null && fill[String(f.frameIndex)] === anchorFrameIndex
  );
}

/**
 * Decide which frames of one container need segmenting for a SPARSE channel.
 *
 * A sparse channel's gap frames hold no acquisition — a constant fill the
 * acquisition software wrote for a timepoint it never imaged. Segmenting one is
 * strictly worse than pointless: it burns a GPU pass on a blank image and then
 * asks the tracker to reconcile whatever noise came back with the real frames
 * around it. The gap reads from the previous real frame, so its result IS that
 * frame's result, `trackId` included.
 *
 * The plan is PIECEWISE, unlike the static case: a static channel has ONE
 * anchor for the whole container, a sparse one has an anchor per run of gaps.
 *
 * A gap whose anchor is not in this batch is left in `unknownShift` and
 * segmented normally — the same "leave alone rather than write something
 * approximate" rule the rest of this module follows. It costs a wasted pass on
 * a blank frame, which is exactly what happened before this existed, so the
 * fallback is never worse than the status quo. In practice it is rare: it takes
 * a hand-picked subset of frames that excludes every anchor, where the ordinary
 * "segment the whole video" path always includes them.
 */
export function planSparseCollapse<
  TFrame extends { id: string; frameIndex: number | null },
>(channel: StaticChannelLike, frames: readonly TFrame[]): CollapsePlan<TFrame> {
  const fill = channel.sparseFill;
  const empty: CollapsePlan<TFrame> = {
    segment: [...frames],
    projectFrom: new Map(),
    unknownShift: [],
  };
  if (!fill) {
    return empty;
  }

  const byIndex = new Map<number, TFrame>();
  for (const f of frames) {
    if (f.frameIndex !== null) {
      byIndex.set(f.frameIndex, f);
    }
  }

  const segment: TFrame[] = [];
  const unknownShift: TFrame[] = [];
  const projectFrom = new Map<string, TFrame[]>();

  for (const f of frames) {
    const anchorIndex =
      f.frameIndex === null ? undefined : fill[String(f.frameIndex)];
    if (anchorIndex === undefined) {
      // Real acquisition (or a frame nothing was recorded about) — segment it.
      segment.push(f);
      continue;
    }
    const anchor = byIndex.get(anchorIndex);
    if (!anchor || anchor.id === f.id) {
      unknownShift.push(f);
      continue;
    }
    const followers = projectFrom.get(anchor.id);
    if (followers) {
      followers.push(f);
    } else {
      projectFrom.set(anchor.id, [f]);
    }
  }

  // A gap whose anchor is present but which the anchor never reaches (the
  // anchor itself is a gap — impossible for a well-formed map, cheap to
  // tolerate) still has to be segmented by someone.
  return { segment: [...segment, ...unknownShift], projectFrom, unknownShift };
}

/**
 * The static channel with this name on a container, or null.
 *
 * Deliberately strict about `staticSource`: a channel that merely happens to
 * look uniform must not take this path, because "the pixels are the same today"
 * is not the same claim as "this channel was built from one image".
 */
export function findStaticChannel(
  channels: readonly StaticChannelLike[] | null | undefined,
  channelName: string | null | undefined
): StaticChannelLike | null {
  if (!channelName || !Array.isArray(channels)) {
    return null;
  }
  const meta = channels.find(c => c?.name === channelName);
  return meta?.staticSource === true ? meta : null;
}
