import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/useLanguage';

export interface RemoveChannelDialogProps {
  open: boolean;
  /** Every channel name declared across the project's video containers. */
  channels: string[];
  /** Channel names some container segments from. A channel in here is the one
   *  whose removal has a consequence nothing else in the UI would show. */
  segmentationSources: string[];
  /** Number of selected video frames. */
  selectedCount: number;
  isSubmitting: boolean;
  onConfirm: (channelName: string) => void;
  onCancel: () => void;
}

/**
 * Confirmation for removing a channel from the selected frames.
 *
 * The confirm button is deliberately gated on typing the channel's name. This
 * deletes pixels — the per-frame PNGs are the ONLY copy for a channel that was
 * added after upload, and for a volume-backed one the only way back is
 * re-uploading the original video. A misfire is not undoable, and the button
 * otherwise sits one click away from "Add channel" in the same menu.
 */
export function RemoveChannelDialog({
  open,
  channels,
  segmentationSources,
  selectedCount,
  isSubmitting,
  onConfirm,
  onCancel,
}: RemoveChannelDialogProps) {
  const { t } = useLanguage();
  const [channel, setChannel] = React.useState<string>('');
  const [typed, setTyped] = React.useState('');

  // Reset every time the dialog opens: a name left in the confirm box from a
  // previous run would arm the button before the user has read anything.
  React.useEffect(() => {
    if (open) {
      setChannel(channels.length === 1 ? channels[0] : '');
      setTyped('');
    }
  }, [open, channels]);

  const isSegSource = channel !== '' && segmentationSources.includes(channel);
  const confirmArmed = channel !== '' && typed.trim() === channel;

  return (
    <Dialog open={open} onOpenChange={o => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('project.removeChannel')}</DialogTitle>
          <DialogDescription>
            {t('project.removeChannelDescription', { frames: selectedCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="remove-channel-select">
              {t('project.removeChannelPick')}
            </Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger id="remove-channel-select">
                <SelectValue placeholder={t('project.removeChannelPick')} />
              </SelectTrigger>
              <SelectContent>
                {channels.map(name => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isSegSource && (
            <div
              data-testid="remove-channel-seg-warning"
              className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{t('project.removeChannelSegSourceWarning')}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="remove-channel-confirm">
              {t('project.removeChannelTypeToConfirm', {
                channel: channel || '…',
              })}
            </Label>
            <input
              id="remove-channel-confirm"
              data-testid="remove-channel-typed"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={typed}
              disabled={channel === '' || isSubmitting}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="remove-channel-confirm"
            variant="destructive"
            disabled={!confirmArmed || isSubmitting}
            onClick={() => onConfirm(channel)}
          >
            {t('project.removeChannel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
