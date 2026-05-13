/**
 * Multi-channel overlay picker. Replaces the single-channel `<Select>`
 * with a checkbox-per-channel list so the user can layer several
 * channels on the canvas at once (additive composite — fluorescence
 * microscope behaviour).
 *
 * Each row also exposes a small colour swatch that opens
 * `ChannelColorDialog`, letting the user re-tint each channel
 * independently. The "● src" annotation is preserved so biologists
 * still see which channel is the segmentation source.
 */

import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { Checkbox } from '@/components/ui/checkbox';
import { useImageDisplay } from '../contexts/ImageDisplayContext';
import { ChannelColorDialog } from './ChannelColorDialog';
import type { VideoChannel } from '@/types';

interface ChannelOverlayListProps {
  channels: VideoChannel[] | null | undefined;
}

const DEFAULT_CHANNEL_COLOR = '#FFFFFF';

export function ChannelOverlayList({ channels }: ChannelOverlayListProps) {
  const { t } = useLanguage();
  const {
    visibleChannels,
    channelColors,
    toggleChannelVisibility,
    setVisibleChannels,
    setChannelColor,
    setChannel,
  } = useImageDisplay();

  // Once container metadata is in hand, seed the visible set + default
  // colours. The seed defaults to "show every channel" — a fresh open
  // of a 3-channel TIFF then renders all three composited, which is the
  // intuitive starting point. We also keep the legacy `channel`
  // (segmentation source) in sync so frame-data URL fallbacks work for
  // any code path still reading that single value.
  useEffect(() => {
    if (!channels || channels.length === 0) return;
    if (visibleChannels.length === 0) {
      setVisibleChannels(channels.map(c => c.name));
    }
    // Seed colours from container metadata only when the slot is empty.
    for (const ch of channels) {
      if (channelColors[ch.name] == null) {
        setChannelColor(ch.name, ch.displayColor ?? DEFAULT_CHANNEL_COLOR);
      }
    }
    const seg = channels.find(c => c.isSegmentationSource)?.name;
    if (seg) setChannel(seg);
    // Intentional: run once per channel list identity; subsequent user
    // edits to visibleChannels / channelColors shouldn't re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  const [editingChannel, setEditingChannel] = useState<string | null>(null);

  if (!channels || channels.length === 0) return null;

  return (
    <>
      <div className="space-y-2">
        {channels.map(ch => {
          const visible = visibleChannels.includes(ch.name);
          const color = channelColors[ch.name] ?? DEFAULT_CHANNEL_COLOR;
          return (
            <div
              key={ch.name}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                checked={visible}
                onCheckedChange={() => toggleChannelVisibility(ch.name)}
                aria-label={t('editor.channels.toggleVisibility', {
                  defaultValue: 'Toggle channel',
                })}
              />
              <button
                type="button"
                onClick={() => setEditingChannel(ch.name)}
                aria-label={t('editor.channels.editColor', {
                  defaultValue: 'Edit colour',
                })}
                title={t('editor.channels.editColor', {
                  defaultValue: 'Edit colour',
                })}
                className="relative inline-flex h-5 w-5 items-center justify-center rounded-sm border border-gray-300 dark:border-gray-600 hover:ring-2 hover:ring-blue-400 transition"
                style={{ backgroundColor: color }}
              >
                <Palette
                  className="h-3 w-3 mix-blend-difference text-white"
                  aria-hidden
                />
              </button>
              <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                {ch.name}
              </span>
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
            </div>
          );
        })}
      </div>

      {editingChannel && (
        <ChannelColorDialog
          open={editingChannel !== null}
          channelName={editingChannel}
          initialColor={
            channelColors[editingChannel] ?? DEFAULT_CHANNEL_COLOR
          }
          onConfirm={color => {
            setChannelColor(editingChannel, color);
            setEditingChannel(null);
          }}
          onClose={() => setEditingChannel(null)}
        />
      )}
    </>
  );
}
