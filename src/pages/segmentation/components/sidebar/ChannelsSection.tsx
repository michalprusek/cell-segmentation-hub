/**
 * Sidebar card wrapping the channel switcher. Matches the PolygonListPanel
 * header style ("p-4 border-b" + small font header) so the sidebar reads
 * as a single column of stacked sections.
 */

import { useLanguage } from '@/contexts/useLanguage';
import { ChannelOverlayList } from '../ChannelOverlayList';
import type { VideoChannel } from '@/types';

interface ChannelsSectionProps {
  channels: VideoChannel[] | null | undefined;
}

export default function ChannelsSection({ channels }: ChannelsSectionProps) {
  const { t } = useLanguage();

  // Don't render the section at all when the video has no channel
  // metadata — there's nothing meaningful to show.
  if (!channels || channels.length === 0) return null;

  return (
    <div className="w-full bg-white dark:bg-gray-800 border-l border-b border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('editor.channelSwitcher.title')}
        </h3>
      </div>
      <div className="p-4">
        <ChannelOverlayList channels={channels} />
      </div>
    </div>
  );
}
