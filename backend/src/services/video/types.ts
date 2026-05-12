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
  /** Stable channel name (matches the on-disk filename). */
  name: string;
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
  /** Channels detected in the source. For single-channel videos this is
   *  a one-element array with type='fluorescent' and isSegmentationSource=false
   *  (user retags via the channels dialog). */
  channels: ChannelMeta[];
  /** Frame image dimensions in pixels. */
  width: number;
  height: number;
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
