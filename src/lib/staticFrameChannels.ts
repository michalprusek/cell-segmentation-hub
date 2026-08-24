/**
 * Collapse a STATIC channel's per-frame identities onto one frame.
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
 */

/** channel name → the frame id whose copy stands for all of them. */
let anchors: Record<string, string> = {};

export interface StaticChannelSource {
  name: string;
  staticSource?: boolean;
  /** Present ⇒ the copies are translations of each other, not duplicates. */
  staticShifts?: Record<string, [number, number]>;
  frameIds?: string[];
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
  for (const c of channels) {
    if (c.staticSource !== true) continue;
    // Added with alignment: the copies differ. Leave every frame its own id.
    if (c.staticShifts && Object.keys(c.staticShifts).length > 0) continue;
    const anchor = c.frameIds?.[0];
    if (anchor) next[c.name] = anchor;
  }
  anchors = next;
}

/** Forget every anchor — leaving the editor, and the test seam. */
export function clearStaticChannelAnchors(): void {
  anchors = {};
}

/** What the registry currently holds. Exposed for assertions and debugging. */
export function staticChannelAnchors(): Readonly<Record<string, string>> {
  return anchors;
}

/**
 * The frame id to FETCH and CACHE for this (frame, channel) pair.
 *
 * Identity for a static channel, so 300 frames resolve to one URL and one
 * decoded entry; the argument unchanged for everything else.
 */
export function resolveFrameId(
  frameId: string,
  channel: string | null
): string {
  if (!channel) return frameId;
  return anchors[channel] ?? frameId;
}
