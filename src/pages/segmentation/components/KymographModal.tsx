/**
 * Modal that renders a kymograph for a microtubule polyline.
 *
 * The frontend orchestrates UI state; the backend samples raw image intensity
 * along the selected polyline across every frame and returns a colour-mapped
 * PNG plus the underlying CSV. When "Velocity analysis" is enabled the backend
 * also runs KymoButler trajectory detection and returns one track per moving
 * particle (with µm/s velocities derived from the container calibration). Those
 * are drawn as an interactive SVG overlay on top of the kymograph and listed in
 * a velocity table.
 *
 * Velocity analysis is **opt-in**. Measured on a 300-frame container the same
 * request costs 7.8–17.6 s without it and 18.6–29.4 s with it, so paying for it
 * on every open made every user wait roughly twice as long for the picture they
 * actually asked for. The image is fetched first; the trajectories are a second
 * request the user triggers from the "Analyse velocities" button (or the
 * matching checkbox), and because the PNG does not depend on the velocity flags
 * the kymograph stays on screen while they are computed.
 *
 * There are two React Query queries — the repo's home for server state — over
 * the one route, and exactly one of them is enabled at a time. The velocity
 * response is a strict superset of the plain one, so enabling both would rebuild
 * the same 300 frames twice; disabling the plain one instead of unmounting it
 * keeps its cached image on screen, which is what survives a velocity pass that
 * is still running or that failed, and makes un-ticking the box cost no request
 * at all. React Query also supplies the `AbortSignal` the hand-rolled effect
 * lacked: a superseded request is now cancelled rather than left to decode 300
 * frames server-side.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import {
  ArrowDown,
  Download,
  Loader2,
  Maximize,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/useLanguage';
import apiClient from '@/lib/api';
import type { VideoChannel } from '@/types';
import { useImageDisplay } from '../contexts/ImageDisplayContext';

interface KymographModalProps {
  open: boolean;
  onClose: () => void;
  videoContainerId: string;
  polylineId: string;
  frameIndex: number;
  channels: VideoChannel[] | null | undefined;
}

/** Sub-pixel trajectory sample `[frame, xPosition]`. Mirrors the backend
 *  `KymoPoint` (FE/BE wire types are hand-synced per repo convention). */
type KymoPoint = [frame: number, x: number];

/** Which kymograph end(s) a trajectory reaches. Closed set, hand-synced with the
 *  backend `EdgeFlag` and the ML `edge_touch` return. */
type EdgeFlag = 'left' | 'right' | 'both' | 'none';

interface KymographTrack {
  points: KymoPoint[]; // time-ordered
  netVelocityPxPerFrame: number;
  netVelocityUmPerSec: number | null;
  snr: number;
  /** Total processive distance (µm) and time in directed motion (s). */
  totalRunLengthUm: number | null;
  totalRunTimeS: number | null;
  /** Background-subtracted intensity along the trajectory (raw pixel units). */
  intensitySignal: number | null;
  intensityBackground: number | null;
  intensityMinusBackground: number | null;
  /** Which kymograph end(s) the trajectory reaches. */
  edge: EdgeFlag;
  /** Intensity outlier (signal > median + k·MAD of the other tracks on this
   *  kymograph) — likely a multi-motor aggregate, not a single motor. */
  bright: boolean;
}

interface KymographResponse {
  pngBase64: string;
  csvBase64: string;
  frameCount: number;
  lengthPx: number;
  tracked: boolean;
  sourceChannel: string;
  pixelSizeUm: number | null;
  frameIntervalMs: number | null;
  tracks?: KymographTrack[];
  /** Tracks hidden by the < 0.01 µm/s net-velocity cut-off (non-processive). */
  filteredTrackCount?: number;
  /** Tracks hidden by the absolute intensity floor the user typed. Separate
   *  from the velocity count so the message can name the actual reason. */
  filteredDimTrackCount?: number;
  /** Set when ML velocity detection crashed (vs. found no particles). */
  velocityError?: string;
}

/** The route answers through `ResponseHelper.success`, i.e. `{ data: … }`; the
 *  older shape returned the payload flat. Accept both, as the effect did. */
type KymographEnvelope = KymographResponse & { data?: KymographResponse };

/** Request body. `intensityWidth` is only meaningful with `detectVelocity`;
 *  `lineWidth` / `lineReduce` change the image itself and so belong to both
 *  queries. */
interface KymographRequest {
  videoContainerId: string;
  polylineId: string;
  frameIndex: number;
  sourceChannel: string;
  channelColor: string;
  detectVelocity: boolean;
  intensityWidth?: number;
  lineWidth?: number;
  lineReduce?: 'mean' | 'max';
  minIntensityMinusBg?: number;
}

async function fetchKymograph(
  body: KymographRequest,
  signal: AbortSignal
): Promise<KymographResponse> {
  const res = await apiClient.post<KymographEnvelope>(
    '/segmentation/kymograph',
    body,
    // Consuming `signal` is what makes React Query cancel this request when the
    // query is superseded or the modal unmounts (query-core `removeObserver`
    // only aborts a fetch whose queryFn read the signal).
    { signal }
  );
  return res.data?.data ?? res.data;
}

/** Scopes every cached kymograph to one open of the modal — see `cacheEpoch`. */
let kymographCacheEpoch = 0;

// Direction-coded colours for the overlay + table dots.
const ANTERO = '#f87171'; // net position increasing (+)
const RETRO = '#38bdf8'; // net position decreasing (−)
const STATIC = '#a3a3a3';
function trackColor(netPxFrame: number): string {
  if (Math.abs(netPxFrame) < 0.02) return STATIC;
  return netPxFrame > 0 ? ANTERO : RETRO;
}

/** Constrain the viewer zoom to a sane range (5 %…2000 %). */
const clampScale = (s: number) => Math.min(Math.max(s, 0.05), 20);

/** Intensity-band width, clamped to the ML/route bounds (1…50 columns). Not the
 *  kymograph's line width: it is the thickness of the band rasterised
 *  perpendicular to a detected trajectory on the finished kymograph, and it
 *  also scales the background ring drawn around that band.
 *
 *  Raised 3 → 5 on 2026-09-01 at the user's request; must stay in step with
 *  `DEFAULT_INTENSITY_WIDTH` in `backend/src/services/kymographService.ts` and
 *  `intensity_width` in the ML `KymographRequest`, or the modal's opening view
 *  disagrees with what an export of the same microtubule reports.
 *
 *  The default is also the fallback for NaN-producing (truly non-numeric)
 *  input; empty or whitespace input parses to 0 and clamps up to 1. */
const DEFAULT_INTENSITY_WIDTH = 5;
const clampWidth = (raw: string | number): number => {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_INTENSITY_WIDTH;
  return Math.min(Math.max(n, 1), 50);
};

/** The absolute intensity floor, in raw sample units.
 *
 *  An empty field, or anything that is not a number, means OFF rather than an
 *  error — clearing the box has to restore the unfiltered view. Not rounded:
 *  the measurement it is compared against is a band mean, and on a dim channel
 *  the useful range is single digits where 1 count is a real step. No ceiling
 *  either, because a 16-bit frame can legitimately need one in the thousands. */
const clampMinIntensity = (raw: string | number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
};

/** How many image pixels wide the sampled line is, PERPENDICULAR to the
 *  polyline. 1 = a single-pixel line profile — what this modal has always
 *  shown — so the opening view is unchanged until the user raises it.
 *
 *  Not `DEFAULT_INTENSITY_WIDTH`, which is a band in kymograph COLUMN space
 *  around an already-detected trajectory on the finished image. This one
 *  decides what the image contains. Must stay in step with `DEFAULT_LINE_WIDTH`
 *  in `backend/src/services/kymographService.ts` and `line_width` in the ML
 *  `KymographRequest`. */
const DEFAULT_LINE_WIDTH = 1;

/** Upper bound mirrors the ML `_LINE_WIDTH_MAX` and the route's validator; a
 *  larger value 422s. Measured on real IRM frames, a band wider than ~11 px
 *  carries none of the filament's contrast (the interference halo cancels the
 *  dark core), so this is a guard rail rather than a useful setting. */
const MAX_LINE_WIDTH = 51;

const clampLineWidth = (raw: string | number): number => {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_LINE_WIDTH;
  return Math.min(Math.max(n, 1), MAX_LINE_WIDTH);
};

/** Glyph marking which kymograph end(s) the trajectory reaches (position only —
 *  the motor's antero/retro travel direction is shown by track colour). */
const edgeGlyph = (edge: EdgeFlag): string =>
  edge === 'both' ? '↔' : edge === 'left' ? '←' : edge === 'right' ? '→' : '—';

/** Compact metric formatters (em-dash when the value is unavailable, e.g.
 *  run length / time are null on uncalibrated containers). */
const fmtUm = (v: number | null): string => (v != null ? v.toFixed(2) : '—');
const fmtSec = (v: number | null): string => (v != null ? v.toFixed(1) : '—');
const fmtIntensity = (v: number | null): string =>
  v != null ? v.toFixed(0) : '—';

export function KymographModal({
  open,
  onClose,
  videoContainerId,
  polylineId,
  frameIndex,
  channels,
}: KymographModalProps) {
  const { t } = useLanguage();
  const { channelColors } = useImageDisplay();

  // Pick a default source channel: prefer the first fluorescent channel
  // (typical kymograph use case is intensity dynamics on a labelled
  // microtubule); fall back to the IRM / segmentation source for
  // structural kymographs.
  const defaultChannel = useMemo(() => {
    if (!channels || channels.length === 0) return null;
    const fluorescent = channels.find(c => c.type === 'fluorescent');
    if (fluorescent) return fluorescent.name;
    const source = channels.find(c => c.isSegmentationSource);
    return source?.name ?? channels[0].name;
  }, [channels]);

  const [sourceChannel, setSourceChannel] = useState<string | null>(
    defaultChannel
  );
  // Opt-in: the velocity pass roughly doubles the wait (7.8–17.6 s → 18.6–29.4 s
  // on a 300-frame container), so the image is fetched without it and the user
  // asks for the trajectories when they want them.
  const [detectVelocity, setDetectVelocity] = useState(false);
  const [intensityWidth, setIntensityWidth] = useState(DEFAULT_INTENSITY_WIDTH);
  // Debounced width drives the (expensive) kymograph refetch — each rebuild
  // re-reads every frame PNG + re-runs blob detection, so we coalesce rapid
  // keystrokes instead of firing a full ML round-trip per character.
  const [debouncedWidth, setDebouncedWidth] = useState(DEFAULT_INTENSITY_WIDTH);
  // Line width + its reduction. Unlike `intensityWidth` these change the
  // PICTURE, so they are part of `imageKey` below and both queries refetch.
  const [lineWidth, setLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const [debouncedLineWidth, setDebouncedLineWidth] =
    useState(DEFAULT_LINE_WIDTH);
  const [lineReduce, setLineReduce] = useState<'mean' | 'max'>('mean');
  // Absolute intensity floor, in RAW SAMPLE UNITS (counts above each
  // trajectory's own local background) — deliberately NOT a fraction of the
  // image range, so the number means the same thing however the kymograph is
  // rendered. 0 = off, which is the default and what every kymograph did
  // before this control existed.
  //
  // It is a per-channel judgement: on a real container 488 nm trajectories sit
  // at 9-51 counts above background where 640 nm sits at 228. That is why the
  // control lives here, next to the channel picker, rather than in settings.
  const [minIntensity, setMinIntensity] = useState(0);
  const [debouncedMinIntensity, setDebouncedMinIntensity] = useState(0);
  const [activeTrack, setActiveTrack] = useState<number | null>(null);

  // A kymograph is derived from polyline geometry the user can edit between two
  // opens of this modal, so no cached entry may survive a close→reopen.
  // `VideoModeOverlay` mounts this component per open, so a token minted once
  // per mount scopes the cache to exactly one open: every open refetches, and
  // inside that open a velocity toggle or a return to an already-fetched
  // channel is served from memory instead of rebuilding the whole video.
  const [cacheEpoch] = useState(() => ++kymographCacheEpoch);

  // Match the kymograph render colour to the per-channel tint the user already
  // chose in the editor's multi-channel overlay. Default white (#FFFFFF) is
  // "grayscale" — sent as #FFFFFF, the ML linear gradient collapses to a
  // black→white intensity ramp, which is the natural single-channel grayscale
  // kymograph. Reading ONE colour out of the record matters: ImageDisplayContext
  // mints a fresh `channelColors` object on every recolour, so depending on the
  // record itself rebuilt this kymograph whenever any *other* channel was
  // recoloured in the editor.
  const channelColor = sourceChannel
    ? (channelColors[sourceChannel] ?? '#FFFFFF')
    : '#FFFFFF';

  const queryEnabled = open && !!sourceChannel;

  /** Everything that decides the rendered PNG; the shared prefix of both keys.
   *  `debouncedLineWidth` and `lineReduce` are here rather than on the velocity
   *  key alone because they change the sampled matrix, i.e. the image. */
  const imageKey: QueryKey = [
    'kymograph',
    cacheEpoch,
    videoContainerId,
    polylineId,
    frameIndex,
    sourceChannel,
    channelColor,
    debouncedLineWidth,
    lineReduce,
  ];
  const request = {
    videoContainerId,
    polylineId,
    frameIndex,
    sourceChannel: sourceChannel as string,
    channelColor,
    // Omitted at the default so the body stays exactly what it was before the
    // control existed — the backend and the ML service both treat an absent
    // field as "single-pixel line profile, mean".
    ...(debouncedLineWidth > DEFAULT_LINE_WIDTH
      ? { lineWidth: debouncedLineWidth, lineReduce }
      : {}),
  };
  /** Deterministic per key, and `cacheEpoch` already scopes every key to one
   *  open of the modal, so there is nothing to revalidate. `retry` is off
   *  because the axios client already retries 429/502/503/504 with backoff and
   *  a second layer on a 10-second request only doubles the wait for an error
   *  the user is going to see anyway. */
  const cacheOptions = {
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  } as const;

  // The kymograph on its own — the cheapest request that can answer "show me
  // this kymograph". Disabled, not unmounted, while velocity analysis is the
  // request in flight: the observer stays, so the image already fetched keeps
  // its cache entry and stays on screen, and un-ticking the box needs no
  // request at all.
  const imageQuery = useQuery({
    queryKey: imageKey,
    queryFn: ({ signal }) =>
      fetchKymograph({ ...request, detectVelocity: false }, signal),
    enabled: queryEnabled && !detectVelocity,
    ...cacheOptions,
  });

  // The same kymograph plus KymoButler trajectory detection. Only ever enabled
  // by an explicit user action, and a failure here costs the user nothing they
  // already had — the image above is a separate query.
  const velocityQuery = useQuery({
    queryKey: [...imageKey, 'velocity', debouncedWidth, debouncedMinIntensity],
    queryFn: ({ signal }) =>
      fetchKymograph(
        {
          ...request,
          detectVelocity: true,
          intensityWidth: debouncedWidth,
          // Omitted at 0 so the request body stays exactly what it was before
          // this control existed — the backend then omits the ML field too.
          ...(debouncedMinIntensity > 0
            ? { minIntensityMinusBg: debouncedMinIntensity }
            : {}),
        },
        signal
      ),
    enabled: queryEnabled && detectVelocity,
    ...cacheOptions,
  });

  // A disabled query still serves whatever it has cached, so this falls back to
  // the plain image while velocity analysis runs (identical PNG) and after one
  // that failed.
  const velocity = detectVelocity ? velocityQuery.data : undefined;
  const result = velocity ?? imageQuery.data;
  const error = detectVelocity ? velocityQuery.error : imageQuery.error;
  // Enabled, nothing to show and nothing to report ⇒ a request is on its way.
  // Covers a *paused* query too (offline), which `isFetching` would call idle.
  const isLoading = queryEnabled && !result && !error;

  // --- Kymograph zoom / pan (native aspect ratio, CSS-transform viewer) ------
  // The kymograph is shown at its native lengthPx×frameCount size and moved by a
  // single `translate(tx,ty) scale(s)` transform inside an overflow-hidden
  // viewport. This makes centring trivial (just compute tx/ty), zoom-to-cursor
  // exact, and pan a plain translate — none of which the old scroll model did
  // well (a sub-viewport image pinned to the top-left, no centring).
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);
  const lastGeomRef = useRef<string | null>(null);
  const [view, setView] = useState<{
    scale: number;
    tx: number;
    ty: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const effScale = view?.scale ?? 1;
  const tx = view?.tx ?? 0;
  const ty = view?.ty ?? 0;

  // A kymograph needs both a spatial and a temporal extent to be displayed; a
  // degenerate result (lengthPx/frameCount ≤ 0) would otherwise divide-by-zero
  // in fitAndCenter and collapse the viewer to 0×0 with no feedback.
  const validKymo = !!result && result.lengthPx > 0 && result.frameCount > 0;

  // Fit the whole kymograph into the viewport AND centre it (the user's ask: an
  // explicitly centred image, not one pinned to the top-left corner).
  const fitAndCenter = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !result || result.lengthPx <= 0 || result.frameCount <= 0) {
      return;
    }
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const raw = Math.min(vw / result.lengthPx, vh / result.frameCount);
    const s = clampScale(Number.isFinite(raw) && raw > 0 ? raw : 1);
    setView({
      scale: s,
      tx: (vw - result.lengthPx * s) / 2,
      ty: (vh - result.frameCount * s) / 2,
    });
  }, [result]);

  // Fit+centre only when the kymograph GEOMETRY changes (new polyline /
  // different length) — this keeps the user's zoom+pan across same-geometry
  // refetches (channel switch, velocity toggle). useLayoutEffect runs before
  // paint, so there is no one-frame flash at the initial native scale.
  useLayoutEffect(() => {
    if (!validKymo || !result) return;
    const geom = `${result.lengthPx}x${result.frameCount}`;
    if (geom === lastGeomRef.current) return;
    lastGeomRef.current = geom;
    fitAndCenter();
  }, [validKymo, result, fitAndCenter]);

  // Zoom by `factor` keeping the viewport point (cx,cy) fixed — so the pixel
  // under the cursor stays put. Standard zoom-to-cursor: solve tx' from
  // cx = tx' + ((cx - tx)/s)·next.
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView(prev => {
      const cur = prev ?? { scale: 1, tx: 0, ty: 0 };
      const next = clampScale(cur.scale * factor);
      const ratio = next / cur.scale;
      return {
        scale: next,
        tx: cx - (cx - cur.tx) * ratio,
        ty: cy - (cy - cur.ty) * ratio,
      };
    });
  }, []);

  // Button zoom: keep the viewport CENTRE fixed.
  const zoomByCentered = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      zoomAt(factor, vp.clientWidth / 2, vp.clientHeight / 2);
    },
    [zoomAt]
  );

  // Plain mouse-wheel zoom toward the cursor — native non-passive listener so
  // preventDefault stops the page from scrolling. Re-binds when the viewport
  // (re)mounts, i.e. when validKymo flips true.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomAt(
        e.deltaY < 0 ? 1.1 : 1 / 1.1,
        e.clientX - rect.left,
        e.clientY - rect.top
      );
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomAt, validKymo]);

  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
    setDragging(true);
  };
  const onDragMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setView(prev =>
      prev
        ? {
            ...prev,
            tx: d.tx + (e.clientX - d.x),
            ty: d.ty + (e.clientY - d.y),
          }
        : prev
    );
  };
  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  // End a pan even if the button is released outside the viewport / window.
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('mouseup', onDragEnd);
    return () => window.removeEventListener('mouseup', onDragEnd);
  }, [dragging, onDragEnd]);

  useEffect(() => {
    if (defaultChannel && sourceChannel == null) {
      setSourceChannel(defaultChannel);
    }
  }, [defaultChannel, sourceChannel]);

  // Coalesce width keystrokes (~400 ms) before they trigger the kymograph
  // refetch below — only the intensity columns depend on width.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedWidth(intensityWidth), 400);
    return () => clearTimeout(id);
  }, [intensityWidth]);

  // Same 400 ms coalescing for the intensity floor. It costs a full ML
  // round-trip per change (the filter runs there, so the overlay stays in step
  // with the table), so typing "150" must not fire three of them.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedMinIntensity(minIntensity), 400);
    return () => clearTimeout(id);
  }, [minIntensity]);

  // Same coalescing for the line width, which is more expensive still: it
  // re-samples every frame (the sampled-row cache keys on it, so a new width is
  // always a full re-read) rather than only re-running the metric.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedLineWidth(lineWidth), 400);
    return () => clearTimeout(id);
  }, [lineWidth]);

  // Empty unless the box is ticked AND its request has landed — the overlay and
  // the table must never draw trajectories belonging to a superseded request.
  const tracks = velocity?.tracks ?? [];
  const calibrated =
    result?.pixelSizeUm != null && result.frameIntervalMs != null;

  const handleDownload = (kind: 'png' | 'csv') => {
    const data = kind === 'png' ? result?.pngBase64 : result?.csvBase64;
    if (!data) return;
    const mime = kind === 'png' ? 'image/png' : 'text/csv';
    triggerDownload(
      base64ToBlob(data, mime),
      `kymograph-${polylineId}.${kind}`
    );
  };

  const handleDownloadTracks = () => {
    if (tracks.length === 0) return;
    const csv = tracksToCsv(tracks);
    triggerDownload(
      new Blob([csv], { type: 'text/csv' }),
      `kymograph-velocity-${polylineId}.csv`
    );
  };

  const fmtVelocity = (track: KymographTrack): string => {
    if (track.netVelocityUmPerSec != null) {
      return `${track.netVelocityUmPerSec >= 0 ? '+' : ''}${track.netVelocityUmPerSec.toFixed(3)} µm/s`;
    }
    return `${track.netVelocityPxPerFrame.toFixed(3)} px/fr`;
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="min-w-0">
          <DialogTitle className="break-all">
            {t('editor.kymograph.title', { defaultValue: 'Kymograph' })}:{' '}
            {polylineId}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 flex-wrap">
          {channels && channels.length > 1 && (
            <>
              <span className="text-sm">
                {t('editor.kymograph.sourceChannel', {
                  defaultValue: 'Source channel',
                })}
              </span>
              <Select
                value={sourceChannel ?? undefined}
                onValueChange={v => setSourceChannel(v)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {channels.map(c => (
                    <SelectItem key={c.name} value={c.name}>
                      <span
                        className="block max-w-[280px] truncate"
                        title={c.displayName ?? c.name}
                      >
                        {c.displayName ?? c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="kymo-line-width" className="text-sm">
              {t('editor.kymograph.lineWidthLabel', {
                defaultValue: 'Line width',
              })}
            </Label>
            <Input
              id="kymo-line-width"
              type="number"
              min={1}
              max={MAX_LINE_WIDTH}
              value={lineWidth}
              onChange={e => setLineWidth(clampLineWidth(e.target.value))}
              className="h-8 w-16"
              title={String(
                t('editor.kymograph.lineWidthHint', {
                  defaultValue:
                    'Width (px) of the line sampled along the microtubule, measured across it. 1 samples a single pixel.',
                })
              )}
            />
          </div>
          {lineWidth > 1 && (
            <Select
              value={lineReduce}
              onValueChange={v => setLineReduce(v as 'mean' | 'max')}
            >
              <SelectTrigger
                className="h-8 w-28"
                aria-label={String(
                  t('editor.kymograph.lineReduceLabel', {
                    defaultValue: 'Across width',
                  })
                )}
                title={String(
                  t('editor.kymograph.lineReduceHint', {
                    defaultValue:
                      'How the pixels across the line width become one value. Mean matches ImageJ; max is brighter but biased by single hot pixels.',
                  })
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mean">
                  {t('editor.kymograph.lineReduceMean', {
                    defaultValue: 'Mean',
                  })}
                </SelectItem>
                <SelectItem value="max">
                  {t('editor.kymograph.lineReduceMax', { defaultValue: 'Max' })}
                </SelectItem>
              </SelectContent>
            </Select>
          )}
          <div
            className="flex items-center gap-2"
            title={String(
              t('editor.kymograph.velocityHint', {
                defaultValue:
                  'Finds moving particles and their velocities. It re-reads every frame, so it roughly doubles the wait.',
              })
            )}
          >
            <Checkbox
              id="kymo-velocity"
              checked={detectVelocity}
              onCheckedChange={v => setDetectVelocity(v === true)}
            />
            <Label htmlFor="kymo-velocity" className="text-sm cursor-pointer">
              {t('editor.kymograph.velocityAnalysis', {
                defaultValue: 'Velocity analysis',
              })}
            </Label>
          </div>
          {detectVelocity && (
            <div className="flex items-center gap-2">
              <Label htmlFor="kymo-width" className="text-sm">
                {t('editor.kymograph.widthLabel', {
                  defaultValue: 'Intensity width',
                })}
              </Label>
              <Input
                id="kymo-width"
                type="number"
                min={1}
                max={50}
                value={intensityWidth}
                onChange={e => setIntensityWidth(clampWidth(e.target.value))}
                className="h-8 w-16"
                title={t('editor.kymograph.widthHint', {
                  defaultValue:
                    'Width (px) of the band sampled around each trajectory for signal vs. background intensity.',
                })}
              />
              <Label htmlFor="kymo-min-intensity" className="text-sm">
                {t('editor.kymograph.minIntensityLabel', {
                  defaultValue: 'Min. intensity',
                })}
              </Label>
              <Input
                id="kymo-min-intensity"
                type="number"
                min={0}
                step={1}
                value={minIntensity === 0 ? '' : minIntensity}
                placeholder="0"
                onChange={e =>
                  setMinIntensity(clampMinIntensity(e.target.value))
                }
                className="h-8 w-20"
                title={String(
                  t('editor.kymograph.minIntensityHint', {
                    defaultValue:
                      'Hide trajectories dimmer than this many raw intensity counts above their own local background. Absolute — independent of how the kymograph is scaled for display — but not comparable between channels. Empty or 0 shows all.',
                  })
                )}
              />
            </div>
          )}
          {result && (
            <span className="text-xs text-muted-foreground">
              {result.tracked
                ? t('editor.kymograph.tracked', {
                    defaultValue: '🔗 Tracked across frames',
                  })
                : t('editor.kymograph.untracked', {
                    defaultValue: '⚠ Static line (no tracking)',
                  })}
            </span>
          )}
        </div>

        <div className="min-h-[300px] flex items-center justify-center bg-black/5 rounded p-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('editor.kymograph.computing', {
                defaultValue: 'Computing kymograph…',
              })}
            </div>
          )}
          {!isLoading && !result && error && (
            <div className="min-w-0 break-words text-destructive text-sm">
              {error.message}
            </div>
          )}
          {!isLoading && result && !validKymo && (
            <div className="text-sm text-muted-foreground">
              {t('editor.kymograph.empty', {
                defaultValue: 'Kymograph could not be computed.',
              })}
            </div>
          )}
          {!isLoading && validKymo && result && (
            // Native-aspect-ratio viewer: the kymograph is NOT stretched — it's
            // shown at lengthPx×frameCount (× zoom) inside a scrollable box.
            // Rows = frames (time ↓), cols = position along the microtubule.
            <div className="w-full">
              <div className="flex">
                {/* Y-axis name (vertical text) + a real downward arrow.
                    The arrow is a separate icon, NOT a "↓" glyph inside the
                    writing-mode-rotated text — the rotation would turn the glyph
                    sideways. Time increases downward (rows = frames), so the
                    arrow points down. */}
                <div className="flex flex-col items-center justify-center gap-1 pr-1 text-xs text-muted-foreground">
                  <span
                    className="whitespace-nowrap"
                    style={{
                      writingMode: 'vertical-rl',
                      transform: 'rotate(180deg)',
                    }}
                  >
                    {t('editor.kymograph.axisTime', {
                      defaultValue: 'Time (frames)',
                    })}
                  </span>
                  <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </div>
                {/* Zoom / pan viewport (CSS transform, overflow hidden). */}
                <div className="relative min-w-0 flex-1">
                  <div className="absolute right-2 top-2 z-10 flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7"
                      onClick={() => zoomByCentered(1.3)}
                      title={t('editor.kymograph.zoomIn', {
                        defaultValue: 'Zoom in',
                      })}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7"
                      onClick={() => zoomByCentered(1 / 1.3)}
                      title={t('editor.kymograph.zoomOut', {
                        defaultValue: 'Zoom out',
                      })}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7"
                      onClick={fitAndCenter}
                      title={t('editor.kymograph.fit', {
                        defaultValue: 'Fit to view',
                      })}
                    >
                      <Maximize className="h-4 w-4" />
                    </Button>
                  </div>
                  <div
                    ref={viewportRef}
                    className="relative h-[60vh] min-h-[300px] w-full select-none overflow-hidden rounded border bg-black/20"
                    style={{ cursor: dragging ? 'grabbing' : 'grab' }}
                    onMouseDown={onDragStart}
                    onMouseMove={onDragMove}
                    onMouseUp={onDragEnd}
                    onMouseLeave={onDragEnd}
                  >
                    {/* Inner box at NATIVE size; pan+zoom via one transform. */}
                    <div
                      className="absolute left-0 top-0 origin-top-left"
                      style={{
                        width: result.lengthPx,
                        height: result.frameCount,
                        transform: `translate(${tx}px, ${ty}px) scale(${effScale})`,
                      }}
                    >
                      <img
                        src={`data:image/png;base64,${result.pngBase64}`}
                        alt={`Kymograph for ${polylineId}`}
                        className="block h-full w-full"
                        style={{ imageRendering: 'pixelated' }}
                        draggable={false}
                      />
                      {tracks.length > 0 && (
                        // viewBox = native pixel grid mapped 1:1 onto the native
                        // box, then CSS-scaled by the parent transform ⇒ tracks
                        // stay aligned at any zoom. Stroke width is divided by the
                        // scale so the polyline keeps a constant on-screen width.
                        <svg
                          className="pointer-events-none absolute inset-0 h-full w-full"
                          viewBox={`0 0 ${result.lengthPx} ${result.frameCount}`}
                          preserveAspectRatio="none"
                        >
                          {tracks.map((tr, i) => {
                            const col = trackColor(tr.netVelocityPxPerFrame);
                            const focused =
                              activeTrack === null || activeTrack === i;
                            return (
                              <g key={i} strokeOpacity={focused ? 1 : 0.25}>
                                <polyline
                                  points={tr.points
                                    .map(([frame, x]) => `${x},${frame}`)
                                    .join(' ')}
                                  fill="none"
                                  stroke={col}
                                  strokeWidth={
                                    (activeTrack === i ? 5 : 3) / effScale
                                  }
                                  className="pointer-events-auto cursor-pointer"
                                  onMouseEnter={() => setActiveTrack(i)}
                                  onMouseLeave={() => setActiveTrack(null)}
                                >
                                  <title>{`#${i + 1}: ${fmtVelocity(tr)}`}</title>
                                </polyline>
                              </g>
                            );
                          })}
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {/* X-axis name + interaction hint. */}
              <div className="flex items-center justify-between pl-5 pt-1 text-xs text-muted-foreground">
                <span>
                  {t('editor.kymograph.axisAlong', {
                    defaultValue: 'Along microtubule (px) →',
                  })}
                </span>
                <span className="text-[10px]">
                  {t('editor.kymograph.zoomHint', {
                    defaultValue: 'drag to pan · scroll to zoom',
                  })}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Velocity analysis is opt-in, so when it is off this slot carries the
            call-to-action that would otherwise be a table the user cannot find.
            It sits exactly where the table appears, under the kymograph. */}
        {validKymo && !detectVelocity && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2">
            <span className="min-w-0 text-xs text-muted-foreground">
              {t('editor.kymograph.velocityIdle', {
                defaultValue:
                  'Velocity analysis is off — the kymograph loads faster without it.',
              })}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDetectVelocity(true)}
            >
              {t('editor.kymograph.analyseVelocities', {
                defaultValue: 'Analyse velocities',
              })}
            </Button>
          </div>
        )}

        {/* Velocity table — or, while the second pass runs over an image that is
            already on screen, its spinner. The request failing here is reported
            in this slot alone: the kymograph above came from the other query. */}
        {validKymo && detectVelocity && velocityQuery.error && (
          <div className="min-w-0 break-words rounded border p-3 text-sm text-destructive">
            {velocityQuery.error.message}
          </div>
        )}
        {validKymo && detectVelocity && !velocityQuery.error && !velocity && (
          <div className="flex items-center gap-2 rounded border p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('editor.kymograph.velocityComputing', {
              defaultValue: 'Analysing velocities…',
            })}
          </div>
        )}
        {validKymo && detectVelocity && velocity && (
          <div className="max-h-48 overflow-auto rounded border">
            {velocity.velocityError ? (
              <div className="p-3 text-sm text-destructive">
                {t('editor.kymograph.velocityFailed', {
                  defaultValue: 'Velocity detection failed.',
                })}
              </div>
            ) : tracks.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                {t('editor.kymograph.noBlobs', {
                  defaultValue: 'No moving particles detected',
                })}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1">#</th>
                    <th className="text-left px-2 py-1">
                      {t('editor.kymograph.colVelocity', {
                        defaultValue: 'Net velocity',
                      })}
                    </th>
                    <th className="text-right px-2 py-1">
                      {t('editor.kymograph.colRunLength', {
                        defaultValue: 'Run length (µm)',
                      })}
                    </th>
                    <th className="text-right px-2 py-1">
                      {t('editor.kymograph.colRunTime', {
                        defaultValue: 'Run time (s)',
                      })}
                    </th>
                    <th className="text-right px-2 py-1">
                      {t('editor.kymograph.colIntensity', {
                        defaultValue: 'Intensity (signal−bg)',
                      })}
                    </th>
                    <th className="text-center px-2 py-1">
                      {t('editor.kymograph.colBright', {
                        defaultValue: 'Bright',
                      })}
                    </th>
                    <th className="text-center px-2 py-1">
                      {t('editor.kymograph.colEdge', { defaultValue: 'Edge' })}
                    </th>
                    <th className="text-right px-2 py-1">
                      {t('editor.kymograph.colSnr', { defaultValue: 'SNR' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((tr, i) => (
                    <tr
                      key={i}
                      className={`border-t cursor-pointer ${activeTrack === i ? 'bg-accent' : ''}`}
                      onMouseEnter={() => setActiveTrack(i)}
                      onMouseLeave={() => setActiveTrack(null)}
                    >
                      <td className="px-2 py-1">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle"
                          style={{
                            backgroundColor: trackColor(
                              tr.netVelocityPxPerFrame
                            ),
                          }}
                        />
                        {i + 1}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {fmtVelocity(tr)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {fmtUm(tr.totalRunLengthUm)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {fmtSec(tr.totalRunTimeS)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {fmtIntensity(tr.intensityMinusBackground)}
                      </td>
                      <td
                        className="px-2 py-1 text-center"
                        title={
                          tr.bright
                            ? t('editor.kymograph.brightHint', {
                                defaultValue:
                                  'Intensity outlier — likely a multi-motor aggregate, not a single motor.',
                              })
                            : undefined
                        }
                      >
                        {tr.bright ? (
                          <span className="text-amber-500" aria-hidden>
                            ⚠
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className="px-2 py-1 text-center"
                        title={t(`editor.kymograph.edge.${tr.edge}`, {
                          defaultValue: tr.edge,
                        })}
                      >
                        {edgeGlyph(tr.edge)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {tr.snr.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tracks.length > 0 && !calibrated && (
              <div className="px-2 py-1 text-[10px] text-amber-600 border-t">
                {t('editor.kymograph.uncalibrated', {
                  defaultValue:
                    'No pixel-size / frame-interval calibration — velocities shown in px/frame.',
                })}
              </div>
            )}
            {!velocity.velocityError &&
              (velocity.filteredTrackCount ?? 0) > 0 && (
                <div className="px-2 py-1 text-[10px] text-muted-foreground border-t">
                  {t('editor.kymograph.filteredHidden', {
                    count: velocity.filteredTrackCount ?? 0,
                    defaultValue:
                      '{{count}} non-processive trajectory(ies) below 0.01 µm/s hidden.',
                  })}
                </div>
              )}
            {/* Named separately from the velocity cut-off: a user who just
                typed a threshold needs to see that THEIR number is what hid
                the trajectories, and how many. */}
            {!velocity.velocityError &&
              (velocity.filteredDimTrackCount ?? 0) > 0 && (
                <div className="px-2 py-1 text-[10px] text-muted-foreground border-t">
                  {t('editor.kymograph.dimHidden', {
                    count: velocity.filteredDimTrackCount ?? 0,
                    threshold: debouncedMinIntensity,
                    defaultValue:
                      '{{count}} trajectory(ies) below {{threshold}} counts above background hidden.',
                  })}
                </div>
              )}
          </div>
        )}

        <DialogFooter>
          {tracks.length > 0 && (
            <Button variant="outline" onClick={handleDownloadTracks}>
              <Download className="h-4 w-4 mr-1" />
              {t('editor.kymograph.downloadTracks', {
                defaultValue: 'Velocity CSV',
              })}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => handleDownload('png')}
            disabled={!result?.pngBase64}
          >
            <Download className="h-4 w-4 mr-1" />
            {t('editor.kymograph.downloadPng', { defaultValue: 'PNG' })}
          </Button>
          {/* Gated on the payload, not just on `result`: a response without the
              intensity matrix would otherwise download an empty file. */}
          <Button
            variant="outline"
            onClick={() => handleDownload('csv')}
            disabled={!result?.csvBase64}
          >
            <Download className="h-4 w-4 mr-1" />
            {t('editor.kymograph.downloadCsv', { defaultValue: 'CSV' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One row per trajectory. Mirrors the metric columns of the export bundle's
 *  ``velocity_metrics.xlsx`` (minus the export-only identifying + calibration
 *  columns: video / microtubule / pixel size / frame interval, and the channel
 *  which the workbook encodes as the worksheet name) so the modal CSV and the
 *  export workbook agree on the shared per-trajectory columns. */
function tracksToCsv(tracks: KymographTrack[]): string {
  const header = [
    'track',
    'net_velocity_um_s',
    'net_velocity_px_frame',
    'snr',
    'total_run_length_um',
    'total_run_time_s',
    'intensity_signal',
    'intensity_background',
    'intensity_minus_background',
    'bright',
    'edge_touch',
  ];
  const lines = [header.join(',')];
  tracks.forEach((tr, ti) => {
    lines.push(
      [
        ti + 1,
        tr.netVelocityUmPerSec ?? '',
        tr.netVelocityPxPerFrame,
        tr.snr,
        tr.totalRunLengthUm ?? '',
        tr.totalRunTimeS ?? '',
        tr.intensitySignal ?? '',
        tr.intensityBackground ?? '',
        tr.intensityMinusBackground ?? '',
        tr.bright,
        tr.edge,
      ].join(',')
    );
  });
  return lines.join('\n');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
