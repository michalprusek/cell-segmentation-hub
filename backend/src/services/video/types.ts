/**
 * Shared type definitions for the video extractor pipeline.
 *
 * The extractor's job: take an uploaded video file (mp4/avi/mov/webm, a
 * multi-page TIFF stack, or an ND2 microscopy file) and produce one PNG
 * per (frame, channel) tuple plus a metadata object that the rest of the
 * pipeline (channels API, segmentation enqueue, kymograph, export)
 * consumes.
 */

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
  /** This position's frame/channel/calibration metadata — identical in
   *  shape to a single-position extraction. */
  result: ExtractionResult;
}

/** What an extraction produced. Non-ND2 formats and single-position ND2
 *  yield ``single`` (frames at ``<dest>/frames/...``). A multi-position ND2
 *  yields ``positions`` — one entry per XY position, each destined for its
 *  own container. Exactly one of the two fields is set. */
export interface ExtractionOutcome {
  single?: ExtractionResult;
  positions?: ExtractedPosition[];
}

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
  if (!nm || nm <= 0) return '#cccccc'; // unknown / label-free → gray
  if (nm < 430) return '#0000ff'; // violet/blue (e.g. DAPI 405)
  if (nm < 490) return '#00aaff'; // blue (e.g. CFP 470)
  if (nm < 530) return '#00ff00'; // green (e.g. GFP/Alexa-488)
  if (nm < 580) return '#ffff00'; // yellow (e.g. YFP/Alexa-514)
  if (nm < 620) return '#ff8800'; // orange (e.g. mCherry/Alexa-594)
  return '#ff0000'; // red/far-red
}

/** Heuristic: is this channel name + wavelength label-free / IRM-like?
 *  Looks for IRM, BF (brightfield), DIC (differential interference
 *  contrast), or TL (transmitted light) and treats null/zero wavelength
 *  as a strong hint (fluorescence channels always have an emission λ). */
export function isIrmChannel(name: string | undefined,
                              wavelengthNm: number | undefined): boolean {
  if (!name) return wavelengthNm == null || wavelengthNm === 0;
  const upper = name.toUpperCase();
  if (/\b(IRM|BF|DIC|TL|BRIGHTFIELD|TRANSMITTED)\b/.test(upper)) return true;
  return wavelengthNm == null || wavelengthNm === 0;
}
