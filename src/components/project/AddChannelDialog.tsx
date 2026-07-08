import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/useLanguage';

/** File extensions treated as a single still image (stamped onto every
 *  selected frame). Everything else is a video/stack whose frame count must
 *  match the selection within one video. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp'];
const ACCEPT = '.png,.jpg,.jpeg,.bmp,.tif,.tiff,.mp4,.avi,.mov,.mkv,.webm,.nd2';
const MAX_NAME_LEN = 128;

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export interface AddChannelDialogProps {
  open: boolean;
  /** Number of selected video frames. */
  selectedCount: number;
  /** Number of distinct parent videos in the selection. */
  videoCount: number;
  isSubmitting: boolean;
  /** Upload progress percent (0–100) while submitting, else null. */
  progress: number | null;
  onConfirm: (params: {
    file: File;
    channelName: string;
    align: boolean;
  }) => void;
  onCancel: () => void;
}

/**
 * "Add channel" dialog for microtubule projects. Opened from the selection
 * toolbar next to Delete annotations. Lets the user pick a source (video/stack
 * or single image), name the channel, and optionally align it to the
 * segmentation-source channel. The heavy lifting (extraction, alignment,
 * writing PNGs, appending channel metadata) happens server-side; this dialog
 * only collects inputs and reports progress.
 */
export function AddChannelDialog({
  open,
  selectedCount,
  videoCount,
  isSubmitting,
  progress,
  onConfirm,
  onCancel,
}: AddChannelDialogProps) {
  const { t } = useLanguage();
  const [file, setFile] = React.useState<File | null>(null);
  const [channelName, setChannelName] = React.useState('');
  const [align, setAlign] = React.useState(false);

  // Reset the form each time the dialog re-opens for a fresh selection.
  React.useEffect(() => {
    if (open) {
      setFile(null);
      setChannelName('');
      setAlign(false);
    }
  }, [open]);

  const fileIsImage = file ? isImageFile(file.name) : false;
  // A multi-frame (video/stack) source can only target a single video.
  const multiVideoBlocked = !!file && !fileIsImage && videoCount > 1;
  const trimmedName = channelName.trim();
  const nameValid =
    trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LEN;
  const canSubmit = !!file && nameValid && !multiVideoBlocked && !isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen && !isSubmitting) {
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('project.addChannelDialog.title') ?? 'Add channel'}
          </DialogTitle>
          <DialogDescription>
            {t('project.addChannelDialog.description') ??
              'Add an extra channel to the selected frames by uploading a video/stack with the same number of frames, or a single image stamped onto every selected frame.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {t('project.addChannelDialog.selectionSummary', {
              frames: selectedCount,
              videos: videoCount,
            })}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="add-channel-file">
              {t('project.addChannelDialog.sourceLabel') ??
                'Source file (video / stack / image)'}
            </Label>
            <Input
              id="add-channel-file"
              type="file"
              accept={ACCEPT}
              disabled={isSubmitting}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {fileIsImage
                  ? t('project.addChannelDialog.imageHint')
                  : t('project.addChannelDialog.videoHint', {
                      frames: selectedCount,
                    })}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-channel-name">
              {t('project.addChannelDialog.nameLabel') ?? 'Channel name'}
            </Label>
            <Input
              id="add-channel-name"
              value={channelName}
              maxLength={MAX_NAME_LEN}
              disabled={isSubmitting}
              placeholder={
                (t('project.addChannelDialog.namePlaceholder') as string) ??
                'e.g. GFP'
              }
              onChange={e => setChannelName(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="add-channel-align" className="cursor-pointer">
              {t('project.addChannelDialog.alignLabel') ??
                'Align to segmentation channel'}
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {t('project.addChannelDialog.alignHint') ??
                  'Phase-correlation registration that corrects small stage drift.'}
              </span>
            </Label>
            <Switch
              id="add-channel-align"
              checked={align}
              disabled={isSubmitting}
              onCheckedChange={setAlign}
            />
          </div>

          {multiVideoBlocked && (
            <p className="text-sm text-destructive">
              {t('project.addChannelDialog.multiVideoError') ??
                'A video/stack can only be added to frames of a single video. Select frames from one video, or upload a single image.'}
            </p>
          )}
          {isSubmitting && progress != null && (
            <p className="text-sm text-muted-foreground">
              {t('project.addChannelDialog.uploading', { percent: progress })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {t('common.cancel') ?? 'Cancel'}
          </Button>
          <Button
            onClick={() =>
              file && onConfirm({ file, channelName: trimmedName, align })
            }
            disabled={!canSubmit}
          >
            {isSubmitting
              ? (t('project.addChannelDialog.adding') ?? 'Adding…')
              : (t('project.addChannelDialog.confirm') ?? 'Add channel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
