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

import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

interface KymographRun {
  velocityPxPerFrame: number;
  sePxPerFrame: number;
  velocityUmPerSec: number | null;
  seUmPerSec: number | null;
  t0: number;
  t1: number;
}

interface KymographTrack {
  points: number[][]; // [[frame, x], ...]
  netVelocityPxPerFrame: number;
  netVelocityUmPerSec: number | null;
  snr: number;
  runs: KymographRun[];
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
  const [result, setResult] = useState<KymographResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTrack, setActiveTrack] = useState<number | null>(null);

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
      <DialogContent className="max-w-3xl">
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
          {!isLoading && !error && result && (
            // Axes: rows = frames (time, ↓ down = later); cols = position
            // along the polyline (head → tail in the seed frame).
            <div
              className="grid w-full gap-1"
              style={{
                gridTemplateColumns: 'auto auto 1fr',
                gridTemplateRows: '1fr auto auto',
              }}
            >
              {/* Y-axis name (column 0, row 0) — rotated. */}
              <div className="flex items-center justify-center text-xs text-muted-foreground pr-1">
                <span
                  className="whitespace-nowrap"
                  style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                  }}
                >
                  {t('editor.kymograph.axisTime', {
                    defaultValue: 'Time (frames) ↓',
                  })}
                </span>
              </div>
              {/* Y-axis tick labels (column 1, row 0). */}
              <div className="flex flex-col justify-between text-[10px] text-muted-foreground tabular-nums pr-1 py-px">
                {[0, 0.25, 0.5, 0.75, 1].map(f => (
                  <span key={f}>
                    {Math.round(f * Math.max(result.frameCount - 1, 0))}
                  </span>
                ))}
              </div>
              {/* Kymograph image + velocity overlay (column 2, row 0). */}
              <div className="relative">
                <img
                  src={`data:image/png;base64,${result.pngBase64}`}
                  alt={`Kymograph for ${polylineId}`}
                  className="w-full max-h-[500px] block"
                  style={{
                    imageRendering: 'pixelated',
                    minHeight: '200px',
                    objectFit: 'fill',
                  }}
                />
                {detectVelocity && tracks.length > 0 && (
                  // preserveAspectRatio="none" + objectFit:fill image ⇒ the
                  // viewBox maps linearly onto the displayed kymograph, so a
                  // track point (x, frame) lands exactly on its pixel.
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox={`0 0 ${result.lengthPx} ${result.frameCount}`}
                    preserveAspectRatio="none"
                  >
                    {tracks.map((tr, i) => (
                      <polyline
                        key={i}
                        points={tr.points
                          .map(([frame, x]) => `${x},${frame}`)
                          .join(' ')}
                        fill="none"
                        stroke={trackColor(tr.netVelocityPxPerFrame)}
                        strokeWidth={activeTrack === i ? 3 : 1.5}
                        strokeOpacity={
                          activeTrack === null || activeTrack === i ? 1 : 0.25
                        }
                        vectorEffect="non-scaling-stroke"
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setActiveTrack(i)}
                        onMouseLeave={() => setActiveTrack(null)}
                      >
                        <title>{`#${i + 1}: ${fmtVelocity(tr)}`}</title>
                      </polyline>
                    ))}
                  </svg>
                )}
              </div>
              {/* X-axis tick labels (column 2, row 1). */}
              <div />
              <div />
              <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums px-px">
                {[0, 0.25, 0.5, 0.75, 1].map(f => (
                  <span key={f}>
                    {Math.round(f * Math.max(result.lengthPx - 1, 0))}
                  </span>
                ))}
              </div>
              {/* X-axis name (column 2, row 2). */}
              <div />
              <div />
              <div className="text-xs text-muted-foreground text-center">
                {t('editor.kymograph.axisAlong', {
                  defaultValue: 'Along microtubule (px) →',
                })}
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
                      {t('editor.kymograph.colRuns', { defaultValue: 'Runs' })}
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
                        {tr.runs.length}
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

function tracksToCsv(tracks: KymographTrack[]): string {
  const header = [
    'track',
    'net_velocity_um_s',
    'net_velocity_px_frame',
    'snr',
    'run_index',
    'run_velocity_um_s',
    'run_se_um_s',
    'run_velocity_px_frame',
    't0',
    't1',
  ];
  const lines = [header.join(',')];
  tracks.forEach((tr, ti) => {
    if (tr.runs.length === 0) {
      lines.push(
        [
          ti + 1,
          tr.netVelocityUmPerSec ?? '',
          tr.netVelocityPxPerFrame,
          tr.snr,
          '',
          '',
          '',
          '',
          '',
          '',
        ].join(',')
      );
    }
    tr.runs.forEach((r, ri) => {
      lines.push(
        [
          ti + 1,
          tr.netVelocityUmPerSec ?? '',
          tr.netVelocityPxPerFrame,
          tr.snr,
          ri + 1,
          r.velocityUmPerSec ?? '',
          r.seUmPerSec ?? '',
          r.velocityPxPerFrame,
          r.t0,
          r.t1,
        ].join(',')
      );
    });
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
