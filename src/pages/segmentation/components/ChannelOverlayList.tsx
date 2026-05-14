/**
 * Multi-channel overlay picker. Replaces the single-channel `<Select>`
 * with a checkbox-per-channel list so the user can layer several
 * channels on the canvas at once (additive composite — fluorescence
 * microscope behaviour).
 *
 * Each row also exposes:
 *   - a colour swatch that opens `ChannelColorDialog`
 *   - an inline rename input (double-click the name)
 *   - an opacity slider that scales the channel's contribution to the
 *     overlay (0% = hidden contribution, 100% = full intensity)
 *
 * The "● src" annotation is preserved so biologists still see which
 * channel is the segmentation source.
 */

import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { useImageDisplay } from '../contexts/ImageDisplayContext';
import { ChannelColorDialog } from './ChannelColorDialog';
import apiClient from '@/lib/api';
import { logger } from '@/lib/logger';
import { useQueryClient } from '@tanstack/react-query';
import type { VideoChannel } from '@/types';

interface ChannelOverlayListProps {
  channels: VideoChannel[] | null | undefined;
  /** Video container Image id. Required for channel rename persistence;
   *  when absent the rename UI hides. */
  containerId?: string | null;
}

const DEFAULT_CHANNEL_COLOR = '#FFFFFF';
const MAX_DISPLAY_NAME_LEN = 128;

export function ChannelOverlayList({
  channels,
  containerId,
}: ChannelOverlayListProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const {
    visibleChannels,
    channelColors,
    channelOpacities,
    toggleChannelVisibility,
    setVisibleChannels,
    setChannelColor,
    setChannelOpacity,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  const [editingColor, setEditingColor] = useState<string | null>(null);
  const [renamingChannel, setRenamingChannel] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  if (!channels || channels.length === 0) return null;

  // Commit a rename: builds the full channels array with the edited
  // displayName, calls the BE, and invalidates the cached image so the
  // gallery / video metadata refreshes. Rolls back the local state if
  // the BE rejects (e.g. validation error).
  const commitRename = async (channelName: string, newDisplay: string) => {
    if (!containerId) return;
    const trimmed = newDisplay.trim();
    const current = channels.find(c => c.name === channelName);
    const previous = current?.displayName ?? channelName;
    if (!trimmed || trimmed === previous) {
      setRenamingChannel(null);
      return;
    }
    if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
      toast.error(
        t('editor.channels.renameTooLong', {
          defaultValue: 'Name too long (max 128 chars)',
        })
      );
      return;
    }
    setRenameSubmitting(true);
    try {
      const updated = channels.map(c => ({
        name: c.name,
        displayName: c.name === channelName ? trimmed : c.displayName,
        type: c.type,
        wavelengthNm: c.wavelengthNm,
        displayColor: c.displayColor,
        isSegmentationSource: c.isSegmentationSource,
      }));
      await apiClient.updateImageChannels(containerId, updated);
      // Invalidate the video container query so the new displayName
      // flows back into this component's `channels` prop on next render.
      await queryClient.invalidateQueries({
        queryKey: ['video-frames', containerId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['image', containerId],
      });
      setRenamingChannel(null);
    } catch (err) {
      logger.error('Failed to rename channel', err);
      toast.error(
        t('editor.channels.renameFailed', {
          defaultValue: 'Rename failed',
        })
      );
    } finally {
      setRenameSubmitting(false);
    }
  };

  return (
    <>
      <div className="space-y-3">
        {channels.map(ch => {
          const visible = visibleChannels.includes(ch.name);
          const color = channelColors[ch.name] ?? DEFAULT_CHANNEL_COLOR;
          const opacity = channelOpacities[ch.name] ?? 100;
          const isRenaming = renamingChannel === ch.name;
          return (
            <div key={ch.name} className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={visible}
                  onCheckedChange={() => toggleChannelVisibility(ch.name)}
                  aria-label={t('editor.channels.toggleVisibility', {
                    defaultValue: 'Toggle channel',
                  })}
                />
                <button
                  type="button"
                  onClick={() => setEditingColor(ch.name)}
                  aria-label={t('editor.channels.editColor', {
                    defaultValue: 'Edit colour',
                  })}
                  title={t('editor.channels.editColor', {
                    defaultValue: 'Edit colour',
                  })}
                  className="relative inline-flex h-5 w-5 items-center justify-center rounded-sm border border-gray-300 dark:border-gray-600 hover:ring-2 hover:ring-blue-400 transition flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  <Palette
                    className="h-3 w-3 mix-blend-difference text-white"
                    aria-hidden
                  />
                </button>
                {isRenaming ? (
                  <input
                    type="text"
                    value={renameValue}
                    autoFocus
                    maxLength={MAX_DISPLAY_NAME_LEN}
                    disabled={renameSubmitting}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(ch.name, renameValue)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename(ch.name, renameValue);
                      else if (e.key === 'Escape') setRenamingChannel(null);
                    }}
                    className="flex-1 min-w-0 bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 py-0.5 text-sm text-gray-700 dark:text-gray-200"
                  />
                ) : (
                  <button
                    type="button"
                    onDoubleClick={() => {
                      if (!containerId) return;
                      setRenameValue(ch.displayName ?? ch.name);
                      setRenamingChannel(ch.name);
                    }}
                    title={
                      containerId
                        ? t('editor.channels.renameHint', {
                            defaultValue: 'Double-click to rename',
                          })
                        : undefined
                    }
                    className="flex-1 min-w-0 text-left truncate text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                  >
                    {ch.displayName ?? ch.name}
                  </button>
                )}
                {ch.isSegmentationSource && (
                  <span
                    className="text-[10px] text-muted-foreground flex-shrink-0"
                    title={t('editor.channelSwitcher.detectionSource', {
                      defaultValue: 'Segmentation source',
                    })}
                  >
                    ● src
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 pl-7">
                <Slider
                  className="flex-1"
                  min={0}
                  max={100}
                  step={1}
                  value={[opacity]}
                  onValueChange={v => setChannelOpacity(ch.name, v[0])}
                  disabled={!visible}
                  aria-label={t('editor.channels.opacity', {
                    defaultValue: 'Channel opacity',
                  })}
                />
                <span className="w-9 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400 flex-shrink-0">
                  {opacity}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {editingColor && (
        <ChannelColorDialog
          open={editingColor !== null}
          channelName={
            channels.find(c => c.name === editingColor)?.displayName ??
            editingColor
          }
          initialColor={channelColors[editingColor] ?? DEFAULT_CHANNEL_COLOR}
          onConfirm={color => {
            setChannelColor(editingColor, color);
            setEditingColor(null);
          }}
          onClose={() => setEditingColor(null)}
        />
      )}
    </>
  );
}
