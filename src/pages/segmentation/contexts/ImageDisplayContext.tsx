/**
 * Session-only display state for the editor.
 *
 * Holds the currently-selected channel, the active video frame index,
 * the min/max window-level cutoffs (ImageJ-style LUT remap), and the
 * brightness/contrast values applied via a CSS filter on the rendered
 * canvas. None of it is persisted across reloads. Brightness/Contrast
 * persist across both frame and channel changes; the Min/Max window
 * persists across frame scrubs (so scrubbing a 300-frame video keeps the
 * user's adjustment) but auto-refits to the new data range whenever the
 * visible-channel set or video changes, ImageJ-style.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { logger } from '@/lib/logger';

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
  /** Per-channel opacity 0..100 (% of channel intensity contributed to
   *  the additive overlay). Missing entry = 100 (full intensity). */
  channelOpacities: Record<string, number>;
  /** Lower window cutoff (0..windowRangeMax) — pixels at/below this map to
   *  black. Same units as the source samples: 0..255 for 8-bit, 0..65535
   *  for 16-bit microscopy frames. */
  windowMin: number;
  /** Upper window cutoff (0..windowRangeMax) — pixels at/above this map to
   *  white. */
  windowMax: number;
  /** Slider/clamp upper bound = the brightest sample value of the current
   *  channel set. 255 until a frame reports its true range (8-bit default,
   *  and standalone <img> images that never decode). ImageJ-style: opening
   *  a 16-bit frame rescales this to the data's max. */
  windowRangeMax: number;
  /** Dimmest sample value of the current channel set — the auto-scaled
   *  window floor and the Reset target. */
  dataMin: number;
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
  /** Set the display colour (hex `#RRGGBB`) for a single channel. Marks the
   *  channel as user-edited so a persisted pref cannot later overwrite it. */
  setChannelColor: (channel: string, color: string) => void;
  /** Seed default colours (from container metadata) for channels that have no
   *  colour yet. Unlike {@link setChannelColor} this does NOT mark the channel
   *  as a user edit, so a saved custom colour still wins during the userId
   *  re-hydrate merge even when seeding raced ahead of auth resolving. */
  seedChannelColors: (defaults: Record<string, string>) => void;
  /** Set per-channel opacity (0..100). Clamped at write. */
  setChannelOpacity: (channel: string, opacity: number) => void;
  setWindow: (min: number, max: number) => void;
  setWindowMin: (min: number) => void;
  setWindowMax: (max: number) => void;
  /** Called by the canvas once it has decoded a frame's true sample range.
   *  `key` fingerprints the video container + channel set; a new key auto-fits
   *  the window to [min, max] (ImageJ default), while frame scrubs within the
   *  same key keep the user's window but still widen the clamp ceiling/floor so
   *  a brighter/dimmer later frame stays reachable. */
  reportDataRange: (min: number, max: number, key: string) => void;
  setBrightness: (brightness: number) => void;
  setContrast: (contrast: number) => void;
  /** Reset window/level back to the auto-scaled data range (ImageJ-style
   *  full-data view), or 0..255 before any frame has reported a range. */
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
  channelOpacities: {},
  windowMin: 0,
  windowMax: 255,
  windowRangeMax: 255,
  dataMin: 0,
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

const clampWindow = (n: number, maxv: number) =>
  Math.max(0, Math.min(maxv, Math.round(n)));
const clampPercent = (n: number) => Math.max(0, Math.min(200, n));
const clampOpacity = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** localStorage key prefix for per-user channel-colour overrides. We
 *  key on userId so two researchers sharing a browser don't see each
 *  other's custom tints, and so an anonymous reload doesn't resurrect
 *  the previous user's choices. */
const COLOR_PREFS_KEY_PREFIX = 'spheroseg.channelColors.';
const OPACITY_PREFS_KEY_PREFIX = 'spheroseg.channelOpacities.';

function loadColorPrefs(userId: string | undefined): Record<string, string> {
  if (!userId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(COLOR_PREFS_KEY_PREFIX + userId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Validate values are strings (mirrors loadOpacityPrefs), so corrupt
    // entries can't reach hexToRgb and silently degrade to white.
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') clean[k] = v;
    }
    return clean;
  } catch (err) {
    logger.debug('loadColorPrefs: dropping corrupt channelColors prefs', err);
    return {};
  }
}

function loadOpacityPrefs(userId: string | undefined): Record<string, number> {
  if (!userId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(OPACITY_PREFS_KEY_PREFIX + userId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v))
        clean[k] = clampOpacity(v);
    }
    return clean;
  } catch (err) {
    logger.debug(
      'loadOpacityPrefs: dropping corrupt channelOpacities prefs',
      err
    );
    return {};
  }
}

export function ImageDisplayProvider({
  children,
  initialChannel = null,
  userId,
}: {
  children: ReactNode;
  initialChannel?: string | null;
  /** Drives per-user persistence of channel-colour overrides. When
   *  unset (anonymous browsing) channel colours stay session-only. */
  userId?: string;
}) {
  // Lazy initializer: hydrate the user's channel-colour preferences
  // from localStorage on first render so reopens of the editor preserve
  // "ch0 → red", "ch1 → green", etc.
  const [state, setState] = useState<ImageDisplayState>(() => ({
    ...DEFAULT_STATE,
    channel: initialChannel,
    channelColors: loadColorPrefs(userId),
    channelOpacities: loadOpacityPrefs(userId),
  }));

  // Channels whose colour the user explicitly changed this session (via the
  // colour picker → setChannelColor). Only these override a persisted pref in
  // the re-hydrate merge below — a metadata-seeded default must NOT, or it
  // would clobber a saved custom colour whenever the seed effect wins the race
  // against auth resolving `userId`.
  const userEditedColorsRef = useRef<Set<string>>(new Set());

  // Re-hydrate when userId becomes available (auth init races the first
  // ImageDisplayProvider mount on cold loads). Precedence: a genuine session
  // user-edit > the persisted pref > a metadata-seeded default. Starting from
  // the current colours and overlaying persisted only for channels the user
  // has NOT edited gives that ordering regardless of whether the seed effect
  // or auth resolved first.
  useEffect(() => {
    if (!userId) return;
    setState(s => {
      const persistedColors = loadColorPrefs(userId);
      const mergedColors: Record<string, string> = { ...s.channelColors };
      for (const [k, v] of Object.entries(persistedColors)) {
        if (!userEditedColorsRef.current.has(k)) mergedColors[k] = v;
      }
      const persistedOpacities = loadOpacityPrefs(userId);
      const mergedOpacities: Record<string, number> = { ...persistedOpacities };
      for (const [k, v] of Object.entries(s.channelOpacities))
        mergedOpacities[k] = v;
      return {
        ...s,
        channelColors: mergedColors,
        channelOpacities: mergedOpacities,
      };
    });
  }, [userId]);

  // Persist on every channelColors change. Safari private + quota
  // errors degrade silently — colour preference is best-effort UX.
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        COLOR_PREFS_KEY_PREFIX + userId,
        JSON.stringify(state.channelColors)
      );
    } catch (err) {
      // Best-effort UX pref (Safari private mode / quota); log for the
      // "my colours keep resetting" case but don't disrupt rendering.
      logger.debug('Persisting channelColors failed', err);
    }
  }, [userId, state.channelColors]);

  useEffect(() => {
    if (!userId || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        OPACITY_PREFS_KEY_PREFIX + userId,
        JSON.stringify(state.channelOpacities)
      );
    } catch (err) {
      logger.debug('Persisting channelOpacities failed', err);
    }
  }, [userId, state.channelOpacities]);

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
    userEditedColorsRef.current.add(channel);
    setState(s => ({
      ...s,
      channelColors: { ...s.channelColors, [channel]: color },
    }));
  }, []);

  const seedChannelColors = useCallback((defaults: Record<string, string>) => {
    setState(s => {
      const next = { ...s.channelColors };
      let changed = false;
      for (const [channel, color] of Object.entries(defaults)) {
        if (next[channel] == null) {
          next[channel] = color;
          changed = true;
        }
      }
      return changed ? { ...s, channelColors: next } : s;
    });
  }, []);

  const setChannelOpacity = useCallback((channel: string, opacity: number) => {
    setState(s => ({
      ...s,
      channelOpacities: {
        ...s.channelOpacities,
        [channel]: clampOpacity(opacity),
      },
    }));
  }, []);

  const setWindow = useCallback((min: number, max: number) => {
    setState(s => ({
      ...s,
      windowMin: clampWindow(min, s.windowRangeMax),
      windowMax: clampWindow(max, s.windowRangeMax),
    }));
  }, []);

  const setWindowMin = useCallback((min: number) => {
    setState(s => ({
      ...s,
      windowMin: clampWindow(Math.min(min, s.windowMax), s.windowRangeMax),
    }));
  }, []);

  const setWindowMax = useCallback((max: number) => {
    setState(s => ({
      ...s,
      windowMax: clampWindow(Math.max(max, s.windowMin), s.windowRangeMax),
    }));
  }, []);

  // Called by the multi-channel canvas after it decodes a frame's true
  // 16-bit samples. `key` fingerprints the video container + channel set
  // (`<containerId>::<channelsKey>`), so:
  //   - a NEW key (different video or channel mix) auto-fits the window to
  //     the data, ImageJ's "open a 16-bit image" behaviour;
  //   - the SAME key (scrubbing frames within one video+channel set) keeps
  //     the user's window position, but still WIDENS the clamp ceiling/floor
  //     to encompass a brighter/dimmer later frame — otherwise a stale LUT
  //     would clip a later frame's bright signal to white and the Max slider
  //     couldn't reach it.
  const lastRangeKeyRef = useRef<string | null>(null);
  const reportDataRange = useCallback(
    (min: number, max: number, key: string) => {
      const hi = Math.max(1, Math.round(max));
      const lo = Math.max(0, Math.min(Math.round(min), hi));
      const isNewKey = lastRangeKeyRef.current !== key;
      lastRangeKeyRef.current = key;
      setState(s => {
        if (isNewKey) {
          return {
            ...s,
            dataMin: lo,
            windowRangeMax: hi,
            windowMin: lo,
            windowMax: hi,
          };
        }
        const nextRangeMax = Math.max(s.windowRangeMax, hi);
        const nextDataMin = Math.min(s.dataMin, lo);
        if (nextRangeMax === s.windowRangeMax && nextDataMin === s.dataMin) {
          return s;
        }
        return { ...s, dataMin: nextDataMin, windowRangeMax: nextRangeMax };
      });
    },
    []
  );

  const setBrightness = useCallback((brightness: number) => {
    setState(s => ({ ...s, brightness: clampPercent(brightness) }));
  }, []);

  const setContrast = useCallback((contrast: number) => {
    setState(s => ({ ...s, contrast: clampPercent(contrast) }));
  }, []);

  const resetWindow = useCallback(() => {
    setState(s => ({
      ...s,
      windowMin: s.dataMin,
      windowMax: s.windowRangeMax,
    }));
  }, []);

  const resetBrightnessContrast = useCallback(() => {
    setState(s => ({ ...s, brightness: 100, contrast: 100 }));
  }, []);

  const resetDisplay = useCallback(() => {
    setState(s => ({
      ...s,
      windowMin: s.dataMin,
      windowMax: s.windowRangeMax,
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
      seedChannelColors,
      setChannelOpacity,
      setWindow,
      setWindowMin,
      setWindowMax,
      reportDataRange,
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
      seedChannelColors,
      setChannelOpacity,
      setWindow,
      setWindowMin,
      setWindowMax,
      reportDataRange,
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
