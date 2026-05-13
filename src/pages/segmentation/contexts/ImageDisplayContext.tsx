/**
 * Session-only display state for the editor.
 *
 * Holds the currently-selected channel, the active video frame index,
 * the min/max window-level cutoffs (ImageJ-style LUT remap), and the
 * brightness/contrast values applied via a CSS filter on the rendered
 * canvas. None of it is persisted across reloads — but within one
 * session all four display sliders **persist across frame and channel
 * changes** so the user can scrub a 300-frame video without losing
 * their adjustments every frame.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

interface ImageDisplayState {
  /** Active video frame (0-based). Undefined for non-video images. */
  frameIndex: number | undefined;
  /** Single-channel back-compat — kept so the segmentation-source URL
   *  fallback still works for non-video / single-channel videos. For
   *  multi-channel overlay UX, drive rendering off `visibleChannels`. */
  channel: string | null;
  /** Channels currently composited onto the canvas. Empty for non-video
   *  images. Order is the rendering order (later channels paint on top
   *  with additive blending). */
  visibleChannels: string[];
  /** Per-channel display colour (hex `#RRGGBB`). Default comes from the
   *  video container's `displayColor` metadata; the user can change it
   *  via the colour-picker modal. Grayscale = `#FFFFFF` (white). */
  channelColors: Record<string, string>;
  /** Lower window cutoff (0..255) — pixels below this are mapped to 0. */
  windowMin: number;
  /** Upper window cutoff (0..255) — pixels above this are mapped to 255. */
  windowMax: number;
  /** Brightness as a percentage (0..200, 100 = unchanged). Applied via
   *  CSS `filter: brightness(b/100)` on the rendered image. */
  brightness: number;
  /** Contrast as a percentage (0..200, 100 = unchanged). Applied via
   *  CSS `filter: contrast(c/100)` on the rendered image. */
  contrast: number;
}

interface ImageDisplayContextValue extends ImageDisplayState {
  setFrameIndex: (frameIndex: number) => void;
  setChannel: (channel: string | null) => void;
  /** Toggle whether `channel` is composited onto the canvas. The order
   *  list grows on enable, removes the entry on disable. */
  toggleChannelVisibility: (channel: string) => void;
  /** Replace the full visible-channel list (used when initialising from
   *  container metadata). */
  setVisibleChannels: (channels: string[]) => void;
  /** Set the display colour (hex `#RRGGBB`) for a single channel. */
  setChannelColor: (channel: string, color: string) => void;
  setWindow: (min: number, max: number) => void;
  setWindowMin: (min: number) => void;
  setWindowMax: (max: number) => void;
  setBrightness: (brightness: number) => void;
  setContrast: (contrast: number) => void;
  /** Reset window/level back to identity (0..255). */
  resetWindow: () => void;
  /** Reset brightness/contrast back to 100/100. */
  resetBrightnessContrast: () => void;
  /** Reset all four display parameters at once. */
  resetDisplay: () => void;
}

const DEFAULT_STATE: ImageDisplayState = {
  frameIndex: undefined,
  channel: null,
  visibleChannels: [],
  channelColors: {},
  windowMin: 0,
  windowMax: 255,
  brightness: 100,
  contrast: 100,
};

/**
 * Exported so callers that want to *optionally* read the context (e.g.
 * `<CanvasImage>` which renders for both standalone and video images)
 * can use `useContext(ImageDisplayContext)` directly and fall back to
 * defaults when unwrapped. The `useImageDisplay` hook below remains
 * the strict version that throws on a missing provider.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const ImageDisplayContext =
  createContext<ImageDisplayContextValue | null>(null);

const clampWindow = (n: number) => Math.max(0, Math.min(255, n));
const clampPercent = (n: number) => Math.max(0, Math.min(200, n));

export function ImageDisplayProvider({
  children,
  initialChannel = null,
}: {
  children: ReactNode;
  initialChannel?: string | null;
}) {
  const [state, setState] = useState<ImageDisplayState>({
    ...DEFAULT_STATE,
    channel: initialChannel,
  });

  // Frame/channel changes used to reset windowMin/Max — the user found
  // that annoying when scrubbing a 300-frame video. Now we only update
  // the index/channel and let all four display sliders persist.
  const setFrameIndex = useCallback((frameIndex: number) => {
    setState(s => ({ ...s, frameIndex }));
  }, []);

  const setChannel = useCallback((channel: string | null) => {
    setState(s => ({ ...s, channel }));
  }, []);

  const toggleChannelVisibility = useCallback((channel: string) => {
    setState(s => {
      const has = s.visibleChannels.includes(channel);
      return {
        ...s,
        visibleChannels: has
          ? s.visibleChannels.filter(c => c !== channel)
          : [...s.visibleChannels, channel],
      };
    });
  }, []);

  const setVisibleChannels = useCallback((channels: string[]) => {
    setState(s => ({ ...s, visibleChannels: channels }));
  }, []);

  const setChannelColor = useCallback((channel: string, color: string) => {
    setState(s => ({
      ...s,
      channelColors: { ...s.channelColors, [channel]: color },
    }));
  }, []);

  const setWindow = useCallback((min: number, max: number) => {
    setState(s => ({
      ...s,
      windowMin: clampWindow(min),
      windowMax: clampWindow(max),
    }));
  }, []);

  const setWindowMin = useCallback((min: number) => {
    setState(s => ({
      ...s,
      windowMin: clampWindow(Math.min(min, s.windowMax)),
    }));
  }, []);

  const setWindowMax = useCallback((max: number) => {
    setState(s => ({
      ...s,
      windowMax: clampWindow(Math.max(max, s.windowMin)),
    }));
  }, []);

  const setBrightness = useCallback((brightness: number) => {
    setState(s => ({ ...s, brightness: clampPercent(brightness) }));
  }, []);

  const setContrast = useCallback((contrast: number) => {
    setState(s => ({ ...s, contrast: clampPercent(contrast) }));
  }, []);

  const resetWindow = useCallback(() => {
    setState(s => ({ ...s, windowMin: 0, windowMax: 255 }));
  }, []);

  const resetBrightnessContrast = useCallback(() => {
    setState(s => ({ ...s, brightness: 100, contrast: 100 }));
  }, []);

  const resetDisplay = useCallback(() => {
    setState(s => ({
      ...s,
      windowMin: 0,
      windowMax: 255,
      brightness: 100,
      contrast: 100,
    }));
  }, []);

  const value = useMemo<ImageDisplayContextValue>(
    () => ({
      ...state,
      setFrameIndex,
      setChannel,
      toggleChannelVisibility,
      setVisibleChannels,
      setChannelColor,
      setWindow,
      setWindowMin,
      setWindowMax,
      setBrightness,
      setContrast,
      resetWindow,
      resetBrightnessContrast,
      resetDisplay,
    }),
    [
      state,
      setFrameIndex,
      setChannel,
      toggleChannelVisibility,
      setVisibleChannels,
      setChannelColor,
      setWindow,
      setWindowMin,
      setWindowMax,
      setBrightness,
      setContrast,
      resetWindow,
      resetBrightnessContrast,
      resetDisplay,
    ]
  );

  return (
    <ImageDisplayContext.Provider value={value}>
      {children}
    </ImageDisplayContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useImageDisplay(): ImageDisplayContextValue {
  const ctx = useContext(ImageDisplayContext);
  if (!ctx) {
    throw new Error(
      'useImageDisplay must be used inside <ImageDisplayProvider>'
    );
  }
  return ctx;
}

/** Apply a min/max window-level LUT to a source HTMLImageElement and
 *  draw it into the supplied canvas. ``min === 0 && max === 255`` is a
 *  no-op identity transform — callers may shortcut on that. */
// eslint-disable-next-line react-refresh/only-export-components
export function applyWindowLevel(
  canvas: HTMLCanvasElement,
  src: HTMLImageElement | HTMLCanvasElement,
  min: number,
  max: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Cover the case where ``src`` has not finished decoding yet.
  const width = (src as HTMLImageElement).naturalWidth ?? src.width;
  const height = (src as HTMLImageElement).naturalHeight ?? src.height;
  if (width === 0 || height === 0) return;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(src, 0, 0, width, height);
  if (min <= 0 && max >= 255) return; // identity — skip the pixel loop
  const data = ctx.getImageData(0, 0, width, height);
  const lut = new Uint8ClampedArray(256);
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  const range = Math.max(1, safeMax - safeMin);
  for (let i = 0; i < 256; i++) {
    if (i < safeMin) lut[i] = 0;
    else if (i > safeMax) lut[i] = 255;
    else lut[i] = Math.round(((i - safeMin) * 255) / range);
  }
  const buf = data.data;
  for (let p = 0; p < buf.length; p += 4) {
    buf[p] = lut[buf[p]];
    buf[p + 1] = lut[buf[p + 1]];
    buf[p + 2] = lut[buf[p + 2]];
  }
  ctx.putImageData(data, 0, 0);
}
