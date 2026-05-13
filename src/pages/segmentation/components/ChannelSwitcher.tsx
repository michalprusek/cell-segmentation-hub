/**
 * Top-toolbar dropdown that lets the user switch which channel is shown
 * on the canvas. Reads channel metadata from the video container and
 * pipes the selection into ImageDisplayContext (which the canvas image
 * reads to choose the right per-channel PNG URL).
 *
 * The "● Detection source" annotation surfaces which channel is being
 * fed to the segmentation model — biologists asked for an obvious
 * reminder that segmentation runs on IRM, not on the fluorescent channel
 * currently shown.
 */

import { useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/useLanguage';
import { useImageDisplay } from '../contexts/ImageDisplayContext';
import type { VideoChannel } from '@/types';

interface ChannelSwitcherProps {
  channels: VideoChannel[] | null | undefined;
}

export function ChannelSwitcher({ channels }: ChannelSwitcherProps) {
  const { t } = useLanguage();
  const { channel, setChannel } = useImageDisplay();

  // Initialise to the segmentation source (or first channel) once the
  // container metadata arrives.
  useEffect(() => {
    if (!channels || channels.length === 0) return;
    if (channel != null && channels.some(c => c.name === channel)) return;
    const initial =
      channels.find(c => c.isSegmentationSource)?.name ?? channels[0].name;
    setChannel(initial);
  }, [channels, channel, setChannel]);

  if (!channels || channels.length === 0) return null;
  // Single-channel videos: surface a static label, no dropdown. Use the
  // human-friendly displayName when available (TIFF/ND2 metadata or
  // "Channel N" fallback), but fall back to the path-safe `name` for
  // legacy uploads that predate the metadata-aware extractors.
  if (channels.length === 1) {
    return (
      <span className="text-xs text-muted-foreground px-2">
        {t('editor.channelSwitcher.title', { defaultValue: 'Channel' })}:{' '}
        {channels[0].displayName ?? channels[0].name}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {t('editor.channelSwitcher.title', { defaultValue: 'Channel' })}
      </span>
      <Select
        value={channel ?? channels[0].name}
        onValueChange={v => setChannel(v)}
      >
        <SelectTrigger className="h-8 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {channels.map(ch => (
            <SelectItem key={ch.name} value={ch.name}>
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: ch.displayColor ?? '#888' }}
                />
                <span>{ch.displayName ?? ch.name}</span>
                {ch.isSegmentationSource && (
                  <span
                    className="text-[10px] text-muted-foreground"
                    title={t('editor.channelSwitcher.detectionSource', {
                      defaultValue: 'Segmentation source',
                    })}
                  >
                    ● src
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
