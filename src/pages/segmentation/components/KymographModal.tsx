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
    apiClient
      .post('/segmentation/kymograph', {
        videoContainerId,
        polylineId,
        frameIndex,
        sourceChannel,
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
  }, [open, sourceChannel, videoContainerId, polylineId, frameIndex]);

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
                      {c.name}
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

        <div className="min-h-[300px] flex items-center justify-center bg-black/5 rounded">
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
            <img
              src={`data:image/png;base64,${result.pngBase64}`}
              alt={`Kymograph for ${polylineId}`}
              // The BE returns the kymograph as a (frame_count × 200 px)
              // heatmap. For short videos (e.g. 3 frames → 200×3 native
              // pixels) the original `max-w-full max-h-[500px]` rendered
              // it at natural size — a sub-pixel-thin strip. Force a
              // full-width fill + pixelated upscaling + min-height so the
              // bands stay visible regardless of frame count, and
              // `object-fit: fill` makes the heatmap blocks stretch to
              // the assigned box (we don't need pixel-aspect fidelity —
              // the *colours* carry the kymograph signal, not the pixel
              // grid).
              className="w-full max-h-[500px] block"
              style={{
                imageRendering: 'pixelated',
                minHeight: '200px',
                objectFit: 'fill',
              }}
            />
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
