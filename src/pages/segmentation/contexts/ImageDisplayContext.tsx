/**
 * Session-only display state for the editor.
 *
 * Holds the currently-selected channel, the min/max window-level cutoffs
 * for the ImageJ-style image adjustment, and the active frame index for
 * video containers. Nothing here is persisted — switching frames, channels
 * or closing the editor resets it. The window/level slider applies as a
 * canvas-side LUT remap; the source pixel data never changes.
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
  /** Active channel name (e.g. 'irm' or 'gfp'). Null when there is no
   *  channel concept (single-channel video / standalone image). */
  channel: string | null;
  /** Lower window cutoff (0..255) — pixels below this are mapped to 0. */
  windowMin: number;
  /** Upper window cutoff (0..255) — pixels above this are mapped to 255. */
  windowMax: number;
}

interface ImageDisplayContextValue extends ImageDisplayState {
  setFrameIndex: (frameIndex: number) => void;
  setChannel: (channel: string | null) => void;
  setWindow: (min: number, max: number) => void;
  resetWindow: () => void;
}

const DEFAULT_STATE: ImageDisplayState = {
  frameIndex: undefined,
  channel: null,
  windowMin: 0,
  windowMax: 255,
};

const ImageDisplayContext = createContext<ImageDisplayContextValue | null>(
  null
);

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

  const setFrameIndex = useCallback((frameIndex: number) => {
    // Reset window/level when navigating to a new frame — different frames
    // (especially in fluorescence) can have wildly different histograms.
    setState(s => ({ ...s, frameIndex, windowMin: 0, windowMax: 255 }));
  }, []);

  const setChannel = useCallback((channel: string | null) => {
    setState(s => ({ ...s, channel, windowMin: 0, windowMax: 255 }));
  }, []);

  const setWindow = useCallback((min: number, max: number) => {
    setState(s => ({
      ...s,
      windowMin: Math.max(0, Math.min(255, min)),
      windowMax: Math.max(0, Math.min(255, max)),
    }));
  }, []);

  const resetWindow = useCallback(() => {
    setState(s => ({ ...s, windowMin: 0, windowMax: 255 }));
  }, []);

  const value = useMemo<ImageDisplayContextValue>(
    () => ({
      ...state,
      setFrameIndex,
      setChannel,
      setWindow,
      resetWindow,
    }),
    [state, setFrameIndex, setChannel, setWindow, resetWindow]
  );

  return (
    <ImageDisplayContext.Provider value={value}>
      {children}
    </ImageDisplayContext.Provider>
  );
}

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
