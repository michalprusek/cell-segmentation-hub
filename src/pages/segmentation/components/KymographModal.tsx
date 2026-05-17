/**
 * Modal that renders a kymograph for a microtubule polyline.
 *
 * The frontend just orchestrates UI state — the heavy lifting is in the
 * backend, which samples raw image intensity along the selected polyline
 * across every frame (using the tracked geometry if available, otherwise
 * the polyline from the current frame as a static reference line) and
 * returns a viridis-colour-mapped PNG plus the underlying CSV.
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

interface KymographResponse {
  pngBase64: string;
  csvBase64: string;
  frameCount: number;
  lengthPx: number;
  tracked: boolean;
  sourceChannel: string;
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
  const [result, setResult] = useState<KymographResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  ]);

  const handleDownload = (kind: 'png' | 'csv') => {
    if (!result) return;
    const data = kind === 'png' ? result.pngBase64 : result.csvBase64;
    const mime = kind === 'png' ? 'image/png' : 'text/csv';
    const blob = base64ToBlob(data, mime);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kymograph-${polylineId}.${kind}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

        <div className="flex items-center gap-3">
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
            // along the polyline (head → tail in the seed frame). Tick
            // labels at 0 / 25 / 50 / 75 / 100% provide a scale; units
            // are pixels for the spatial axis, frame index for time.
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
              {/* Kymograph image (column 2, row 0). */}
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

        <DialogFooter>
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

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
