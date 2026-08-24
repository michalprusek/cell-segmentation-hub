/**
 * Session-only display state for the editor.
 *
 * Holds the currently-selected channel, the active video frame index,
 * the min/max window-level cutoffs (ImageJ-style LUT remap), and the
 * brightness/contrast values applied via a CSS filter on the rendered
 * canvas. None of it is persisted across reloads. Brightness/Contrast
 * persist across both frame and channel changes; the Min/Max window
 * is held PER CHANNEL: it persists across frame scrubs (so scrubbing a
 * 300-frame video keeps the user's adjustment) and each channel auto-refits to
 * its own data the first time that channel is seen, or whenever the video
 * changes, ImageJ-style.
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

/** One channel's window/level, in raw sample units.
 *
 *  `min`/`max` are the user-facing cutoffs; `rangeMax`/`dataMin` are the
 *  brightest/dimmest samples the channel has actually shown, which bound the
 *  sliders and are what "Reset" re-fits to. Keeping the bounds per channel is
 *  what lets a 12-bit IRM channel and a 16-bit fluorescence channel each be
 *  legible in the same composite. */
export interface ChannelWindow {
  min: number;
  max: number;
  rangeMax: number;
  dataMin: number;
}

/** Window for images with no channel set (standalone frames, single-channel
 *  videos). The empty string can never collide with a real channel name. */
export const FALLBACK_CHANNEL = '';

/** 8-bit defaults, used until a frame reports its true range. */
const DEFAULT_CHANNEL_WINDOW: ChannelWindow = {
  min: 0,
  max: 255,
  rangeMax: 255,
  dataMin: 0,
};

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
  /** Per-channel frame coverage for PNG-backed channels added post-upload
   *  (see addChannelService): channel name → frame Image ids it covers. A
   *  channel absent from this map covers EVERY frame (the volume-backed
   *  default). Lets the canvas + prefetcher skip requesting a channel for
   *  frames it doesn't cover, so a partial channel produces no 404 noise. */
  channelCoverage: Record<string, string[]>;
  /** Upper bound on the container's sample values, or null before the backend
   *  has derived one. NOT the value that maps to 255 — that is per frame and
   *  arrives in `X-Proxy-Range`. It is the starting point for the banding
   *  guard, which switches to each channel's real range as frames arrive. */
  proxyRangeMax: number | null;
  /** Window/level PER CHANNEL, keyed by channel name; {@link FALLBACK_CHANNEL}
   *  ('') holds the window for images that have no channel set at all.
   *
   *  One shared window was the bug Marika reported on 2026-08-24 as "model
   *  segments MTs where there is nothing": it auto-fitted to the UNION of every
   *  visible channel's range, so an IRM channel spanning 2941..4145 was drawn
   *  through the 489..53927 window its TIRF siblings opened — 2 % of the range,
   *  i.e. a flat grey field. The microtubules the model had correctly traced
   *  were invisible underneath their own polylines. Channels differ in dynamic
   *  range by more than an order of magnitude, so each needs its own window;
   *  this is also what ImageJ does for a composite stack. */
  channelWindows: Readonly<Partial<Record<string, ChannelWindow>>>;
  /** Which channel the Display panel's Min/Max sliders edit, and which one the
   *  scalar `window*` fields below project. Null = {@link FALLBACK_CHANNEL}. */
  activeWindowChannel: string | null;
  /** Brightness as a percentage (0..200, 100 = unchanged). Applied via
   *  CSS `filter: brightness(b/100)` on the rendered image. */
  brightness: number;
  /** Contrast as a percentage (0..200, 100 = unchanged). Applied via
   *  CSS `filter: contrast(c/100)` on the rendered image. */
  contrast: number;
}

interface ImageDisplayContextValue extends ImageDisplayState {
  /** The active channel's window, flattened for the four consumers that only
   *  ever need one at a time (the Display panel's sliders, and the proxy gate's
   *  no-channel fallback). A VIEW of `channelWindows[windowChannel]`, never a
   *  second copy: every write goes through `channelWindows`. */
  readonly windowMin: number;
  readonly windowMax: number;
  /** Slider ceiling for the active channel = its brightest sample so far. */
  readonly windowRangeMax: number;
  /** The window for images with no channel set. Exposed so the playback-proxy
   *  gate can ask for it directly instead of reaching into `channelWindows`
   *  with the pseudo-key, or — worse — reading it off the scalar projection,
   *  which only happens to be the fallback because of how the slider-focus
   *  resolver orders its last branch. */
  readonly fallbackWindow: ChannelWindow;
  setFrameIndex: (frameIndex: number) => void;
  setChannel: (channel: string | null) => void;
  /** Toggle whether `channel` is composited onto the canvas. The order
   *  list grows on enable, removes the entry on disable. */
  toggleChannelVisibility: (channel: string) => void;
  /** Replace the full visible-channel list (used when initialising from
   *  container metadata). */
  setVisibleChannels: (channels: string[]) => void;
  /** Seed the per-channel frame coverage map (from container metadata).
   *  Only PNG-backed partial channels appear here. */
  setChannelCoverage: (coverage: Record<string, string[]>) => void;
  setProxyRangeMax: (rangeMax: number | null) => void;
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
  /** Called by the multi-channel canvas with EVERY decoded channel's own sample
   *  range. `containerKey` fingerprints the video container: a new container
   *  drops the old windows entirely, while within one container a channel seen
   *  for the first time auto-fits and an already-fitted one keeps the user's
   *  window (its bounds still widen so a brighter/dimmer later frame stays
   *  reachable). Toggling a channel on therefore fits just that channel and
   *  leaves the others exactly where the user put them. */
  reportChannelRanges: (
    ranges: Record<string, { min: number; max: number }>,
    containerKey: string | null
  ) => void;
  /** Choose which channel the Min/Max sliders edit. Null restores the default
   *  pick (the segmentation source). */
  setActiveWindowChannel: (channel: string | null) => void;
  /** The channel the scalar `window*` fields above actually describe, after
   *  defaulting. `''` means the no-channel fallback window. */
  windowChannel: string;
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
  channelCoverage: {},
  proxyRangeMax: null,
  channelWindows: { [FALLBACK_CHANNEL]: DEFAULT_CHANNEL_WINDOW },
  activeWindowChannel: null,
  brightness: 100,
  contrast: 100,
};

/**
 * Which channel's window the Min/Max sliders read and write.
 *
 * An explicit pick wins for as long as that channel is still VISIBLE and still
 * has a window. With no pick we default to the SEGMENTATION SOURCE (`state.channel`, seeded from the
 * container's `isSegmentationSource`): it is the channel the model actually ran
 * on, so it is the one whose window decides whether the user can see what was
 * segmented. Falling back further: the first visible channel, then the
 * no-channel pseudo-window.
 */
function resolveWindowChannel(s: ImageDisplayState): string {
  const { activeWindowChannel, channelWindows, visibleChannels, channel } = s;
  // The pick must still be VISIBLE, not merely still have a window. Hiding a
  // channel leaves its window in the map (only a container switch sweeps
  // those), so without this test the sliders stayed bound to a channel nothing
  // draws: no tab read as selected, and once one channel was left the tab row
  // disappeared entirely while the sliders went on editing the hidden one.
  if (
    activeWindowChannel &&
    visibleChannels.includes(activeWindowChannel) &&
    activeWindowChannel in channelWindows
  ) {
    return activeWindowChannel;
  }
  if (
    channel &&
    visibleChannels.includes(channel) &&
    channel in channelWindows
  ) {
    return channel;
  }
  return visibleChannels.find(c => c in channelWindows) ?? FALLBACK_CHANNEL;
}

/** Every window back to its channel's own [dataMin, rangeMax]. */
function refitAllWindows(
  windows: Readonly<Partial<Record<string, ChannelWindow>>>
): Partial<Record<string, ChannelWindow>> {
  const out: Partial<Record<string, ChannelWindow>> = {};
  for (const [channel, w] of Object.entries(windows)) {
    if (w) out[channel] = { ...w, min: w.dataMin, max: w.rangeMax };
  }
  return out;
}

/**
 * Fold decoded sample ranges into the per-channel windows.
 *
 * A channel seen for the first time (or every channel, when `refitAll` is set
 * because the container changed) AUTO-FITS to its own data — ImageJ's behaviour
 * on opening a 16-bit image. A channel already carrying a window keeps the
 * user's cutoffs and only widens its bounds, so scrubbing to a brighter or
 * dimmer frame never yanks the view but also never leaves the new extremes
 * unreachable by the sliders. The one exception is a channel that has never had
 * a usable range to fit to; see the re-fit branch below.
 *
 * `refitAll` and `dropUnlisted` are not independent in practice: `dropUnlisted`
 * clears `current`, which already forces the fit, and the sole caller passes
 * the same flag to both. They are separate parameters only so the two effects
 * are named where they happen.
 *
 * `dropUnlisted` removes windows for channels not in `ranges`; it is set only
 * on a container switch, where a same-named channel of a different video would
 * otherwise inherit a stale window.
 */
function applyRanges(
  s: ImageDisplayState,
  ranges: Record<string, { min: number; max: number }>,
  refitAll: boolean,
  dropUnlisted: boolean
): ImageDisplayState {
  const next: Partial<Record<string, ChannelWindow>> = dropUnlisted
    ? {}
    : { ...s.channelWindows };
  let changed = dropUnlisted
    ? Object.keys(s.channelWindows).some(k => !(k in ranges))
    : false;

  for (const [channel, raw] of Object.entries(ranges)) {
    const hi = Math.max(1, Math.round(raw.max));
    const lo = Math.max(0, Math.min(Math.round(raw.min), hi));
    const current = dropUnlisted ? undefined : s.channelWindows[channel];
    if (!current || refitAll) {
      const fitted = { min: lo, max: hi, rangeMax: hi, dataMin: lo };
      if (
        !current ||
        current.min !== lo ||
        current.max !== hi ||
        current.rangeMax !== hi ||
        current.dataMin !== lo
      ) {
        changed = true;
      }
      next[channel] = fitted;
      continue;
    }
    const rangeMax = Math.max(current.rangeMax, hi);
    const dataMin = Math.min(current.dataMin, lo);
    // A frame that decoded flat (an unilluminated channel reports min === max,
    // at 0 or at whatever baseline offset the camera adds) fits to a zero-width
    // window. The widening branch below moves only the BOUNDS, so that window
    // would stand for the rest of the container and clamp every later frame to
    // white. Re-fit it once a frame arrives with real range.
    //
    // `noRealRangeYet` is what identifies that state — a window collapsed on
    // REAL data has wide bounds and never reaches here. `untouched` does
    // something else, and is the deliberate part: if the user moved the sliders
    // while the channel was still flat, they own the window from then on and it
    // is never auto-recovered, even though that leaves the channel white until
    // they widen it themselves. Silently overruling an explicit adjustment is
    // the worse surprise.
    const untouched =
      current.min === current.dataMin && current.max === current.rangeMax;
    const noRealRangeYet = current.rangeMax - current.dataMin <= 1;
    if (untouched && noRealRangeYet && hi > lo) {
      next[channel] = { min: lo, max: hi, rangeMax, dataMin };
      changed = true;
      continue;
    }
    if (rangeMax === current.rangeMax && dataMin === current.dataMin) continue;
    next[channel] = { ...current, rangeMax, dataMin };
    changed = true;
  }

  // The fallback window belongs to no channel, so a container switch must not
  // sweep it away with the rest.
  if (dropUnlisted && !(FALLBACK_CHANNEL in next)) {
    next[FALLBACK_CHANNEL] =
      s.channelWindows[FALLBACK_CHANNEL] ?? DEFAULT_CHANNEL_WINDOW;
  }

  return changed ? { ...s, channelWindows: next } : s;
}

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

  const setChannelCoverage = useCallback(
    (coverage: Record<string, string[]>) => {
      setState(s => ({ ...s, channelCoverage: coverage }));
    },
    []
  );

  const setProxyRangeMax = useCallback((rangeMax: number | null) => {
    setState(s => ({ ...s, proxyRangeMax: rangeMax }));
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

  const setActiveWindowChannel = useCallback((channel: string | null) => {
    setState(s => ({ ...s, activeWindowChannel: channel }));
  }, []);

  /** Rewrite the active channel's window. `edit` receives the channel's CURRENT
   *  window (never undefined — an unseen channel starts at the 8-bit default),
   *  so every setter below clamps against that channel's own bounds instead of
   *  a global ceiling that may belong to a much brighter sibling. */
  const editActiveWindow = useCallback(
    (edit: (w: ChannelWindow) => ChannelWindow) => {
      setState(s => {
        const key = resolveWindowChannel(s);
        const current = s.channelWindows[key] ?? DEFAULT_CHANNEL_WINDOW;
        const next = edit(current);
        if (next.min === current.min && next.max === current.max) return s;
        return { ...s, channelWindows: { ...s.channelWindows, [key]: next } };
      });
    },
    []
  );

  const setWindow = useCallback(
    (min: number, max: number) => {
      editActiveWindow(w => ({
        ...w,
        min: clampWindow(min, w.rangeMax),
        max: clampWindow(max, w.rangeMax),
      }));
    },
    [editActiveWindow]
  );

  const setWindowMin = useCallback(
    (min: number) => {
      editActiveWindow(w => ({
        ...w,
        min: clampWindow(Math.min(min, w.max), w.rangeMax),
      }));
    },
    [editActiveWindow]
  );

  const setWindowMax = useCallback(
    (max: number) => {
      editActiveWindow(w => ({
        ...w,
        max: clampWindow(Math.max(max, w.min), w.rangeMax),
      }));
    },
    [editActiveWindow]
  );

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
  // Keyed on the CONTAINER, not on the channel set: toggling a channel must fit
  // only the newcomer, not re-fit (and so discard) the windows the user has
  // already tuned on the channels that were already showing.
  const lastContainerKeyRef = useRef<string | null>(null);
  const reportChannelRanges = useCallback(
    (
      ranges: Record<string, { min: number; max: number }>,
      containerKey: string | null
    ) => {
      // A null key means "no container id to compare", which has to read as a
      // NEW container every time. Folding it to '' instead made two different
      // id-less videos share one key, so the second inherited the first's
      // window over data it does not describe — the same flat-field failure
      // this per-channel work exists to remove.
      const isNewContainer =
        containerKey === null || lastContainerKeyRef.current !== containerKey;
      lastContainerKeyRef.current = containerKey;
      setState(s => applyRanges(s, ranges, isNewContainer, isNewContainer));
    },
    []
  );

  const setBrightness = useCallback((brightness: number) => {
    setState(s => ({ ...s, brightness: clampPercent(brightness) }));
  }, []);

  const setContrast = useCallback((contrast: number) => {
    setState(s => ({ ...s, contrast: clampPercent(contrast) }));
  }, []);

  /** Re-fit EVERY channel to its own data range. Per-channel windows mean a
   *  reset that only touched the selected channel would leave the composite
   *  half-adjusted, which is not what "Reset" reads as. */
  const resetWindow = useCallback(() => {
    setState(s => ({
      ...s,
      channelWindows: refitAllWindows(s.channelWindows),
    }));
  }, []);

  const resetBrightnessContrast = useCallback(() => {
    setState(s => ({ ...s, brightness: 100, contrast: 100 }));
  }, []);

  const resetDisplay = useCallback(() => {
    setState(s => ({
      ...s,
      channelWindows: refitAllWindows(s.channelWindows),
      brightness: 100,
      contrast: 100,
    }));
  }, []);

  // The scalar window fields are a VIEW of one entry of channelWindows, never a
  // second copy: everything that writes goes through channelWindows, so the
  // panel and the canvas can never disagree about what the window is.
  const windowChannel = resolveWindowChannel(state);
  const activeWindow =
    state.channelWindows[windowChannel] ?? DEFAULT_CHANNEL_WINDOW;

  const value = useMemo<ImageDisplayContextValue>(
    () => ({
      ...state,
      windowMin: activeWindow.min,
      windowMax: activeWindow.max,
      windowRangeMax: activeWindow.rangeMax,
      fallbackWindow:
        state.channelWindows[FALLBACK_CHANNEL] ?? DEFAULT_CHANNEL_WINDOW,
      windowChannel,
      setFrameIndex,
      setChannel,
      toggleChannelVisibility,
      setVisibleChannels,
      setChannelCoverage,
      setProxyRangeMax,
      setChannelColor,
      seedChannelColors,
      setChannelOpacity,
      setWindow,
      setWindowMin,
      setWindowMax,
      reportChannelRanges,
      setActiveWindowChannel,
      setBrightness,
      setContrast,
      resetWindow,
      resetBrightnessContrast,
      resetDisplay,
    }),
    [
      state,
      activeWindow,
      windowChannel,
      setFrameIndex,
      setChannel,
      toggleChannelVisibility,
      setVisibleChannels,
      setChannelCoverage,
      setProxyRangeMax,
      setChannelColor,
      seedChannelColors,
      setChannelOpacity,
      setWindow,
      setWindowMin,
      setWindowMax,
      reportChannelRanges,
      setActiveWindowChannel,
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
