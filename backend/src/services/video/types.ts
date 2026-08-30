/**
 * Shared type definitions for the video extractor pipeline.
 *
 * The extractor's job: take an uploaded video file (mp4/avi/mov/webm, a
 * multi-page TIFF stack, or an ND2 microscopy file) and produce one PNG
 * per (frame, channel) tuple plus a metadata object that the rest of the
 * pipeline (channels API, segmentation enqueue, kymograph, export)
 * consumes.
 */

/**
 * SINGLE canonical definition of the channel-name whitelist. Filesystem-
 * safe alnum + underscore + dash; bans dots so a `.png` extension can't be
 * smuggled in, bans slashes so path traversal is impossible. Every layer
 * that reads, writes or validates a channel name — the upload pipeline
 * (`videoUploadService`), the read/PATCH gates (`videoController`), the
 * "add channel" flow, the MT metrics/kymograph exporters — must import
 * this rather than redeclaring the pattern, so the write side and the
 * read side can never drift out of sync again (see the 2026-08-26 Institut
 * Curie incident: the TIFF extractor emitted names up to ~140 chars, the
 * read gate enforced 64, and nine containers became permanently
 * unreadable because the two copies of this regex disagreed).
 */
export const CHANNEL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeChannelName(name: unknown): name is string {
  return typeof name === 'string' && CHANNEL_NAME_RE.test(name);
}

/**
 * The container's segmentation-source channel name: the channel explicitly
 * marked as the source, else the first one.
 *
 * The rule was written out at six call sites with three different null-handling
 * tails. It is not a display detail: drift correction is driven by this
 * channel, and on a motility assay picking a fluorescence channel measures
 * filament gliding and subtracts the signal the experiment records. If the rule
 * ever gains a step — "prefer `type === 'irm'` over index 0" is the obvious
 * next one — it must gain it everywhere at once.
 *
 * Returns undefined for an empty channel list; callers decide what that means.
 */
export function resolveSegmentationSource(
  channels: readonly { name: string; isSegmentationSource?: boolean }[]
): string | undefined {
  return channels.find(c => c.isSegmentationSource)?.name ?? channels[0]?.name;
}

export type ChannelType = 'irm' | 'fluorescent';

export interface ChannelMeta {
  /** Stable channel name (matches the on-disk filename). Path-safe:
   *  validated against `/^[A-Za-z0-9_-]{1,64}$/` at every boundary. */
  name: string;
  /** Human-friendly label sourced from upload metadata (TIFF ImageJ
   *  labels, ND2 channel names) or the `"Channel N"` (1-based) fallback.
   *  UI components should render `displayName ?? name`. Undefined for
   *  legacy uploads — consumers must tolerate that. */
  displayName?: string;
  /** Whether this channel shows label-free microtubule structure (IRM/BF/
   *  DIC) or fluorescent signal. The segmenter only runs on IRM channels. */
  type: ChannelType;
  /** Emission wavelength in nm — set when ND2 metadata provides it.
   *  Used to derive default display colors via a standard fluorescence LUT. */
  wavelengthNm?: number;
  /** Hex RGB display color (e.g. "#00ff00"). */
  displayColor?: string;
  /** Exactly one channel per video container should be marked as the
   *  segmentation source. The extractor auto-detects IRM and flips this
   *  on for that channel; users can override via the channels dialog. */
  isSegmentationSource: boolean;
  /** True for channels ADDED after upload via "Add channel" — their pixel
   *  data lives ONLY in the per-frame PNGs (``frames/<TTTT>/<name>.png``),
   *  not in the container's original ND2/TIFF volume. Consumers that sample
   *  the original volume by C-axis index (``mt_metrics.py``) must instead
   *  read the per-frame PNG for these. Added channels are always appended to
   *  the ``channels`` array so volume-backed channels keep array-index ==
   *  C-axis-index. Absent/false = the original volume-backed default. Such
   *  channels may be present on only SOME frames (coverage = the frames the
   *  user selected when adding), so a missing per-frame PNG is expected. */
  pngBacked?: boolean;
  /** For a PNG-backed channel that covers only SOME frames: the child frame
   *  Image ids that actually have this channel's PNG. Lets the editor skip
   *  requesting the channel for frames it doesn't cover (no 404 noise).
   *  OMITTED when the channel covers every frame of the container (full
   *  coverage → always request it). Frame ids (not indices) so the FE can
   *  filter directly against the canvas / prefetch frame id. */
  frameIds?: string[];
  /** True when this channel was added from a SINGLE source image stamped onto
   *  every covered frame, rather than from a video/stack paired frame-by-frame.
   *  Every covered frame therefore shows the SAME picture — a static IRM
   *  snapshot laid over a time-lapse being the usual case.
   *
   *  Why it is worth recording. Segmenting such a channel frame-by-frame does
   *  the identical work N times and then asks the tracker to rediscover that
   *  the N results are the same objects. Observed in production: 299 frames,
   *  30498 polylines, resolving to exactly 102 tracks — one detection set,
   *  counted 299 times, at a cost that pushed the tracker past its timeout. A
   *  channel flagged here is segmented ONCE and the result is projected onto
   *  the rest, which makes cross-frame identity exact by construction instead
   *  of inferred. */
  staticSource?: boolean;
  /** For a `staticSource` channel added WITH alignment: the (dy, dx) actually
   *  applied to each covered frame's copy, keyed by frame Image id.
   *
   *  Alignment registers the one source image to each frame's own segmentation
   *  channel, so the stored copies are translations of one another rather than
   *  byte-identical. Recording the translation is what lets a single
   *  segmentation be projected onto the other frames instead of re-run: the
   *  geometry is the same shape moved by a known amount. Absent when the
   *  channel was added without alignment, which is the same thing as every
   *  shift being (0, 0). */
  staticShifts?: Record<string, [number, number]>;
  /** True when the SOURCE VOLUME only carries this channel on some frames — a
   *  microscope that refreshes IRM every N-th timepoint while imaging
   *  fluorescence continuously. The un-acquired planes are written by the
   *  acquisition software as a constant fill, and both extractors used to turn
   *  them into black PNGs indistinguishable from data.
   *
   *  Detected at extraction (`plane_coverage.py`: a plane is absent iff
   *  `min == max`, which no real exposure can be) and NOT inferred later —
   *  the same reason `staticSource` is a recorded fact rather than a guess.
   *
   *  A sparse channel is served on EVERY frame, so it does NOT use `frameIds`:
   *  `sparseFill` names the gaps and what each reads from, and every frame not
   *  in it is served from its own plane. Contrast `pngBacked` partial coverage,
   *  where the user picked a subset of frames on purpose and a frame outside it
   *  genuinely has no channel — those keep being skipped. The pixels are never
   *  duplicated on disk; only the read path redirects. */
  sparseSource?: boolean;
  /** For a `sparseSource` channel: gap frameIndex -> the frameIndex whose PNG
   *  stands in for it. Keys are stringified indices (JSON has no integer keys).
   *  Used by the frame-data route and the segmentation collapse, both of which
   *  hold a `frameIndex` and would otherwise need a second query to resolve an
   *  id. Frames absent from this map AND from `frameIds` were never acquired at
   *  all (every channel blank — an aborted run leaves a tail of them) and are
   *  deliberately left alone rather than back-filled with fabricated data. */
  sparseFill?: Record<string, number>;
  /** The same map keyed by frame Image id, for the editor: it resolves a gap
   *  frame to its anchor's URL and decode-cache key, so N frames sharing one
   *  picture cost one download and one decode instead of N. See
   *  `src/lib/staticFrameChannels.ts`.
   *
   *  PURELY A RENDERING OPTIMISATION, and deliberately so. Nothing on the
   *  correctness path may read it: the frame-data route and the segmentation
   *  collapse both resolve through `sparseFill` above, so a container that is
   *  missing this map (or has it only partially — a gap with no Image row is
   *  omitted rather than guessed) still shows the right pixels and still gets
   *  its gaps filled in. It just pays for the bytes more than once. */
  sparseFillFrameIds?: Record<string, string>;
  /** Upper bound on the sample values this container holds, rounded up to a
   *  power of two.
   *
   *  NOT the value that maps to 255 — that is chosen per FRAME by
   *  `make_playback_proxy.py` from the frame's own peak, and travels with the
   *  frame in `X-Proxy-Range`. This figure has one job: the client's banding
   *  guard needs something to judge against before it has seen any frame of a
   *  container. Absent until a multi-channel frame of the container has been
   *  requested at least once. */
  proxyRangeMax?: number;
}

export interface ExtractionResult {
  /** Number of extracted frames. */
  frameCount: number;
  /** Source duration in ms (best-effort: ffprobe / ND2 metadata / N * dt). */
  durationMs: number | null;
  /** Median wall-clock ms between consecutive frames. Best-effort:
   *  ND2 event timestamps, OME-TIFF TimeIncrement, ImageJ ``finterval``,
   *  or (for mp4/avi/mov) durationMs / frameCount. ``null`` when the
   *  source carries no temporal calibration. */
  frameIntervalMs: number | null;
  /** Isotropic XY pixel size in micrometers. Best-effort: ND2
   *  ``voxel_size().x``, OME-TIFF ``PhysicalSizeX``, ImageJ TIFF info
   *  block, or raw TIFF ``XResolution``. ``null`` when missing or
   *  ambiguous (e.g. raw TIFF without ``ResolutionUnit``). */
  pixelSizeUm: number | null;
  /** Channels detected in the source. For single-channel videos this is
   *  a one-element array with type='fluorescent' and isSegmentationSource=false
   *  (user retags via the channels dialog). */
  channels: ChannelMeta[];
  /** Frame image dimensions in pixels. */
  width: number;
  height: number;
}

/** One XY position split out of a multi-position ND2 (well-plate /
 *  multipoint). Each becomes its own video container. */
export interface ExtractedPosition {
  /** 0-based position index within the source acquisition. */
  positionIndex: number;
  /** Label from the ND2 ``XYPosLoop`` metadata (e.g. ``"D03_0000"``), or
   *  null when the acquisition left the point unnamed (caller falls back to
   *  a 1-based ordinal). */
  positionName: string | null;
  /** Stage coordinates in µm when present — traceability back to the
   *  microscope stage; not currently persisted, but carried for callers. */
  stageXUm: number | null;
  stageYUm: number | null;
  /** Subdirectory under the extraction dest holding this position's frames:
   *  ``<dest>/<framesSubdir>/frames/<TTTT>/<channel>.png``. */
  framesSubdir: string;
  /** Filename (inside ``framesSubdir``) of this position's self-contained
   *  single-position original — a 16-bit ``TCYX`` OME-TIFF the metrics
   *  reader can load (the multi-position source ND2 can't be indexed by
   *  position). Relocated alongside the frames into the container dir. */
  originalFile: string;
  /** This position's frame/channel/calibration metadata — identical in
   *  shape to a single-position extraction. */
  result: ExtractionResult;
}

/** What an extraction produced — a discriminated union so the
 *  "single vs multi" choice is a compile-time tag, not a documented
 *  convention.
 *
 *  - ``single``: non-ND2 formats and single-position ND2; frames at
 *    ``<dest>/frames/...``.
 *  - ``multi``: a multi-position ND2 — one ``ExtractedPosition`` per XY
 *    position (non-empty by construction), each destined for its own
 *    container. */
export type ExtractionOutcome =
  | { kind: 'single'; result: ExtractionResult }
  | { kind: 'multi'; positions: ExtractedPosition[] };

export interface ExtractionProgress {
  /** 0 to 1, monotonically increasing. */
  progress: number;
  /** Optional human-readable status (translated client-side). */
  message?: string;
  /** Current frame being processed (0-indexed). */
  currentFrame?: number;
  /** Total expected frames; may be -1 if unknown until first read. */
  totalFrames?: number;
}

/** Callback used by extractors to stream progress to the WebSocket layer. */
export type ProgressCallback = (progress: ExtractionProgress) => void;

/** Maps emission wavelength (nm) to a sensible default display color. */
export function defaultColorForWavelength(nm: number | undefined): string {
  if (!nm || nm <= 0) {
    return '#cccccc'; // unknown / label-free → gray
  }
  if (nm < 430) {
    return '#0000ff'; // violet/blue (e.g. DAPI 405)
  }
  if (nm < 490) {
    return '#00aaff'; // blue (e.g. CFP 470)
  }
  if (nm < 530) {
    return '#00ff00'; // green (e.g. GFP/Alexa-488)
  }
  if (nm < 580) {
    return '#ffff00'; // yellow (e.g. YFP/Alexa-514)
  }
  if (nm < 620) {
    return '#ff8800'; // orange (e.g. mCherry/Alexa-594)
  }
  return '#ff0000'; // red/far-red
}

/** Heuristic: is this channel name + wavelength label-free / IRM-like?
 *
 *  Requires POSITIVE evidence: a label-free name (IRM, BF, DIC, TL, …) or an
 *  explicitly zero emission wavelength.
 *
 *  This used to also return true for an *unknown* wavelength, on the premise
 *  that "fluorescence channels always have an emission λ". Both halves of that
 *  premise are false in practice:
 *
 *  - Multi-page TIFFs carry no wavelength at all, so EVERY channel of every
 *    TIFF stack matched and the whole stack was typed `irm`. The 3-frame
 *    microtubule test fixture is exactly this: three channels all labelled
 *    `irm`, with a TIRF channel first in line and therefore chosen as the
 *    segmentation source for an IRM-trained model.
 *  - Real ND2 IRM channels report a NONZERO emission λ anyway (measured
 *    2026-08-17: 525 nm and 510 nm on two production files), so the fallback
 *    never identified a genuine IRM channel that the name did not already
 *    catch. It only ever fired where there was no evidence.
 *
 *  Absence of metadata is not evidence. Callers must therefore cope with "no
 *  IRM channel found" — see `buildChannelMeta`, which still nominates a
 *  segmentation source so a stack of unidentifiable channels stays segmentable.
 */
export function isIrmChannel(
  name: string | undefined,
  wavelengthNm: number | undefined
): boolean {
  if (wavelengthNm === 0) {
    return true;
  }
  if (!name) {
    return false;
  }
  // Underscores are separators in microscopy channel names (`IRM_widefield`,
  // `TIRF_488`), but `\b` counts `_` as a word character, so `\bIRM\b` does not
  // match `IRM_WIDEFIELD`. Normalise them to spaces before matching; this only
  // ever admits more label-free names, never a fluorescence one — none of the
  // tokens below appear inside a fluorophore name.
  const upper = name.toUpperCase().replace(/_/g, ' ');
  return /\b(IRM|BF|DIC|TL|BRIGHTFIELD|TRANSMITTED)\b/.test(upper);
}
