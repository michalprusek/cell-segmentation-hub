import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/useLanguage';

export interface SegmentChannelDialogProps {
  open: boolean;
  channels: string[];
  defaultChannel: string;
  onConfirm: (channel: string) => void;
  onCancel: () => void;
}

/**
 * Channel picker for Segment All on multi-channel video projects.
 *
 * Rendered when a project contains at least one extracted-frame Image whose
 * originalPath includes a /frames/NNNN/<channel>.<ext> segment and the
 * project as a whole exposes more than one distinct channel. The user picks
 * exactly one channel; the parent dispatches the batch with that channel
 * forwarded to the queue (see resolveChannelPath on the backend, which
 * rewrites the path per queue item).
 */
export function SegmentChannelDialog({
  open,
  channels,
  defaultChannel,
  onConfirm,
  onCancel,
}: SegmentChannelDialogProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = React.useState(defaultChannel);

  // Sync the controlled value to the prop when the dialog re-opens for a
  // different project — without this the picker would remember the previous
  // project's choice across opens.
  React.useEffect(() => {
    if (open) {
      setSelected(defaultChannel);
    }
  }, [open, defaultChannel]);

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) {
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('segmentation.channelPicker.title') ?? 'Select channel'}
          </DialogTitle>
          <DialogDescription>
            {t('segmentation.channelPicker.description') ??
              'This project contains multiple channels. Choose which channel to segment.'}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={selected}
          onValueChange={setSelected}
          className="space-y-2 py-2"
        >
          {channels.map(ch => (
            <div key={ch} className="flex items-center space-x-2">
              <RadioGroupItem value={ch} id={`channel-${ch}`} />
              <Label htmlFor={`channel-${ch}`} className="cursor-pointer">
                {ch}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel') ?? 'Cancel'}
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={!selected}>
            {t('segmentation.channelPicker.confirm') ?? 'Segment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Extract distinct channel tokens from a set of frame Image originalPaths.
 *
 * Frame paths look like:
 *   projects/<pid>/images/<videoId>/frames/<NNNN>/<channel>.<ext>
 *
 * We only care about rows that match that frame-path shape; standalone-image
 * rows (no /frames/ segment) contribute nothing. Returns an empty array when
 * the project has no extracted frames or only one channel.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function extractChannelsFromPaths(
  paths: (string | null | undefined)[]
): string[] {
  const pattern = /\/frames\/\d+\/([^/]+?)\.[A-Za-z0-9]+$/;
  const set = new Set<string>();
  for (const p of paths) {
    if (!p) {
      continue;
    }
    const m = p.match(pattern);
    if (m && m[1]) {
      set.add(m[1]);
    }
  }
  return Array.from(set).sort();
}
