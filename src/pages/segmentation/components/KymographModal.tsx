/**
 * Modal that renders a kymograph for a microtubule polyline.
 *
 * The frontend orchestrates UI state; the backend samples raw image intensity
 * along the selected polyline across every frame and returns a colour-mapped
 * PNG plus the underlying CSV. When "Velocity analysis" is enabled the backend
 * also runs blob-motion detection and returns one track per moving particle
 * (with µm/s velocities derived from the container calibration). Those tracks
 * are drawn as an interactive SVG overlay on top of the kymograph and listed in
 * a velocity table.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  /** "left" | "right" | "both" | "none" — trajectory reaches a kymograph end. */
  edge: string;
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
}

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

/** Intensity-band width must match the ML/route bounds (1…50 columns). Falls
 *  back to the default 3 for empty / non-numeric input. */
const DEFAULT_INTENSITY_WIDTH = 3;
const clampWidth = (raw: string | number): number => {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_INTENSITY_WIDTH;
  return Math.min(Math.max(n, 1), 50);
};

/** Direction-neutral glyph for the edge-touch flag. */
const edgeGlyph = (edge: string): string =>
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
  const [detectVelocity, setDetectVelocity] = useState(true);
  const [intensityWidth, setIntensityWidth] = useState(DEFAULT_INTENSITY_WIDTH);
  const [result, setResult] = useState<KymographResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTrack, setActiveTrack] = useState<number | null>(null);

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

  useEffect(() => {
    if (!open || !sourceChannel) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    // Match the kymograph render colour to the per-channel tint the user
    // already chose in the editor's multi-channel overlay. Default white
    // (#FFFFFF) is "grayscale" — sent as #FFFFFF, the ML linear gradient
    // collapses to a black→white intensity ramp, which is the natural
    // single-channel grayscale kymograph.
    const channelColor = channelColors[sourceChannel] ?? '#FFFFFF';
    apiClient
      .post('/segmentation/kymograph', {
        videoContainerId,
        polylineId,
        frameIndex,
        sourceChannel,
        channelColor,
        detectVelocity,
        ...(detectVelocity ? { intensityWidth } : {}),
      })
      .then(res => {
        if (cancelled) return;
        const payload = res.data?.data ?? res.data;
        setResult(payload as KymographResponse);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    sourceChannel,
    videoContainerId,
    polylineId,
    frameIndex,
    channelColors,
    detectVelocity,
    intensityWidth,
  ]);

  const handleDownload = (kind: 'png' | 'csv') => {
    if (!result) return;
    const data = kind === 'png' ? result.pngBase64 : result.csvBase64;
    const mime = kind === 'png' ? 'image/png' : 'text/csv';
    triggerDownload(
      base64ToBlob(data, mime),
      `kymograph-${polylineId}.${kind}`
    );
  };

  const handleDownloadTracks = () => {
    if (!result?.tracks) return;
    const csv = tracksToCsv(result.tracks);
    triggerDownload(
      new Blob([csv], { type: 'text/csv' }),
      `kymograph-velocity-${polylineId}.csv`
    );
  };

  const tracks = result?.tracks ?? [];
  const calibrated =
    result?.pixelSizeUm != null && result.frameIntervalMs != null;

  const fmtVelocity = (track: KymographTrack): string => {
    if (track.netVelocityUmPerSec != null) {
      return `${track.netVelocityUmPerSec >= 0 ? '+' : ''}${track.netVelocityUmPerSec.toFixed(3)} µm/s`;
    }
    return `${track.netVelocityPxPerFrame.toFixed(3)} px/fr`;
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
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
                      {c.displayName ?? c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <div className="flex items-center gap-2">
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
          {error && <div className="text-destructive text-sm">{error}</div>}
          {!isLoading && !error && result && !validKymo && (
            <div className="text-sm text-muted-foreground">
              {t('editor.kymograph.empty', {
                defaultValue: 'Kymograph could not be computed.',
              })}
            </div>
          )}
          {!isLoading && !error && validKymo && result && (
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
                      {detectVelocity && tracks.length > 0 && (
                        // viewBox = native pixel grid mapped 1:1 onto the native
                        // box, then CSS-scaled by the parent transform ⇒ tracks
                        // stay aligned at any zoom. Stroke/dot sizes are divided
                        // by the scale so they keep a constant on-screen size.
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
                              <g
                                key={i}
                                strokeOpacity={focused ? 1 : 0.25}
                                fillOpacity={focused ? 1 : 0.25}
                              >
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

        {/* Velocity table */}
        {detectVelocity && result && !isLoading && (
          <div className="max-h-48 overflow-auto rounded border">
            {tracks.length === 0 ? (
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
          </div>
        )}

        <DialogFooter>
          {detectVelocity && tracks.length > 0 && (
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
            disabled={!result}
          >
            <Download className="h-4 w-4 mr-1" />
            {t('editor.kymograph.downloadPng', { defaultValue: 'PNG' })}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleDownload('csv')}
            disabled={!result}
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
 *  ``velocity_metrics.csv`` (minus the export-only video / channel / calibration
 *  context the modal doesn't carry) so the two CSVs agree. */
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
