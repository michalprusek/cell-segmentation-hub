/**
 * Collapse repeated per-frame identities onto the frame whose pixels they are.
 *
 * WHY THIS EXISTS. "Add channel" can stamp a single source image onto every
 * frame of a time-lapse — a fixed IRM snapshot over a moving fluorescence
 * series, which is the usual microtubule setup. The backend already knows this
 * and records `staticSource` on the channel (see `addChannelService`), because
 * segmenting such a channel frame by frame does one piece of work N times.
 *
 * The editor never learned the same thing about DISPLAY. Every frame's copy is
 * a separate Image row with its own id, so the same bytes live at 300 different
 * URLs; the HTTP cache cannot tell they are the same, and neither can the
 * decoded-frame cache. Measured on production (project 984eac50, 1474x1412,
 * three channels): over 72 s of playback the `irm` channel pulled 66.7 MB of
 * the 158.6 MB total — 42% of all traffic — and every byte of it was identical.
 * `md5sum` over four frames' `irm` PNGs returned one hash; `488_nm` returned
 * four. The link measures ~35 Mbit/s, so those bytes are the difference between
 * two dynamic channels arriving and three competing.
 *
 * So a static channel gets ONE identity. Resolving the frame id here rather
 * than in each caller is what makes it work: the window prefetcher, the
 * decode-ahead walk, the canvas and the `<img>` path all reach frames through
 * `buildFrameImageUrl`/`frameCacheKey`, and patching one of them would leave
 * the others downloading the other 299 copies.
 *
 * WHAT IS DELIBERATELY NOT COLLAPSED. `staticShifts` marks a static channel
 * added WITH alignment: each frame's copy is the source translated by a
 * per-frame (dy, dx), so the copies are NOT interchangeable and reusing one for
 * another would put the wrong pixels on screen — in a measurement tool. Such a
 * channel is left alone. This mirrors `staticChannelProjection.ts`, which is
 * equally strict on the segmentation side, and it is the reason the anchor is
 * registered from metadata rather than inferred by comparing bytes.
 *
 * Coverage is a separate question and stays keyed by the REAL frame id: a
 * static channel may cover 299 of 300 frames, and the uncovered one must still
 * render without it.
 *
 * SPARSE CHANNELS are the same saving with more than one anchor. A microscope
 * that refreshes IRM every N-th timepoint leaves the frames in between holding
 * no acquisition at all; the backend serves each of them from the last real
 * frame before it, so a run of frames again shares one picture — just a
 * different one per run. The container records which gap reads from which real
 * frame (`sparseFillFrameIds`), so this module can point the whole run at one
 * URL and one decoded entry exactly as it does for a static channel. Without
 * that, playback would re-download the same IRM plane once per gap frame; with
 * it, once per run.
 *
 * The redirect is NOT what makes the picture correct — the backend does that
 * regardless, and a container whose map never reached the client still renders
 * right. This is purely the de-duplication.
 */

/** channel name → the frame id whose copy stands for ALL of them (static). */
let anchors: Record<string, string> = {};
/** channel name → gap frame id → the frame id it actually reads from (sparse).
 *  One entry per gap rather than one per channel, because a sparse channel has
 *  an anchor per run of gaps instead of a single one. */
let sparseFills: Record<string, Record<string, string>> = {};

export interface StaticChannelSource {
  name: string;
  staticSource?: boolean;
  /** Present ⇒ the copies are translations of each other, not duplicates. */
  staticShifts?: Record<string, [number, number]>;
  frameIds?: string[];
  /** The microscope only refreshed this channel every N-th frame. */
  sparseSource?: boolean;
  /** Gap frame id → the frame id whose pixels the backend serves for it. */
  sparseFillFrameIds?: Record<string, string>;
}

/**
 * Register which channels may share one frame's bytes.
 *
 * Called from the same place that publishes `channelCoverage`, so the two
 * derived views of the channel list cannot drift apart. Replaces the whole
 * registry rather than merging: switching to another video must not leave the
 * previous one's anchors pointing at frames that no longer exist.
 */
export function setStaticChannelAnchors(
  channels: readonly StaticChannelSource[]
): void {
  const next: Record<string, string> = {};
  const nextSparse: Record<string, Record<string, string>> = {};
  for (const c of channels) {
    // Sparse first: the two flags come from different places (the extractor vs
    // `addChannelService`) and cannot both hold, but ordering the check makes
    // that independent of which one a future writer sets.
    if (c.sparseSource === true) {
      const fill = c.sparseFillFrameIds;
      if (fill && Object.keys(fill).length > 0) nextSparse[c.name] = fill;
      continue;
    }
    if (c.staticSource !== true) continue;
    // Added with alignment: the copies differ. Leave every frame its own id.
    if (c.staticShifts && Object.keys(c.staticShifts).length > 0) continue;
    const anchor = c.frameIds?.[0];
    if (anchor) next[c.name] = anchor;
  }
  anchors = next;
  sparseFills = nextSparse;
}

/** Forget every anchor — leaving the editor, and the test seam. */
export function clearStaticChannelAnchors(): void {
  anchors = {};
  sparseFills = {};
}

/** What the registry currently holds. Exposed for assertions and debugging. */
export function staticChannelAnchors(): Readonly<Record<string, string>> {
  return anchors;
}

/** The sparse half of the registry, for the same reason. */
export function sparseChannelFills(): Readonly<
  Record<string, Readonly<Record<string, string>>>
> {
  return sparseFills;
}

/**
 * The frame id to FETCH and CACHE for this (frame, channel) pair.
 *
 * Identity for a static channel, so 300 frames resolve to one URL and one
 * decoded entry. For a sparse channel, the frame the backend will serve this
 * one from, so a run of gaps resolves to the run's own real frame. The argument
 * unchanged for everything else — including a sparse channel's REAL frames,
 * which are absent from the fill map.
 */
export function resolveFrameId(
  frameId: string,
  channel: string | null
): string {
  if (!channel) return frameId;
  const staticAnchor = anchors[channel];
  if (staticAnchor) return staticAnchor;
  return sparseFills[channel]?.[frameId] ?? frameId;
}
