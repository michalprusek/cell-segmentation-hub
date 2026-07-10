import * as React from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { FileUp, Paperclip, X } from 'lucide-react';

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
import { formatFileSize } from '@/lib/uploadUtils';

/** File extensions treated as a single still image (stamped onto every
 *  selected frame). Everything else is a video/stack whose frame count must
 *  match the selection within one video. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp'];
/** react-dropzone accept map — same extension set the old file input allowed. */
const DROPZONE_ACCEPT: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/bmp': ['.bmp'],
  'image/tiff': ['.tif', '.tiff'],
  'video/mp4': ['.mp4'],
  'video/x-msvideo': ['.avi'],
  'video/quicktime': ['.mov'],
  'video/x-matroska': ['.mkv'],
  'video/webm': ['.webm'],
  // ND2 has no registered MIME — matched by extension.
  'application/octet-stream': ['.nd2'],
};
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
  // Code of the last rejected drop (e.g. 'file-invalid-type',
  // 'too-many-files'), or null. Kept in local state — not read from the
  // dropzone hook's own `fileRejections` — because this dialog is always
  // mounted (only `open` toggles), so the hook's internal rejection state
  // would otherwise survive a close/re-open and show a stale error.
  const [rejectionCode, setRejectionCode] = React.useState<string | null>(null);

  // Reset the form each time the dialog re-opens for a fresh selection.
  React.useEffect(() => {
    if (open) {
      setFile(null);
      setChannelName('');
      setAlign(false);
      setRejectionCode(null);
    }
  }, [open]);

  const onDrop = React.useCallback((acceptedFiles: File[]) => {
    const next = acceptedFiles[0];
    if (next) {
      setFile(next);
      setRejectionCode(null);
    }
  }, []);

  const onDropRejected = React.useCallback((rejections: FileRejection[]) => {
    setRejectionCode(rejections[0]?.errors[0]?.code ?? 'file-invalid-type');
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: DROPZONE_ACCEPT,
    maxFiles: 1,
    multiple: false,
    disabled: isSubmitting,
  });

  // Distinguish the two reachable rejection reasons so the user isn't told
  // "wrong type" when they actually dropped several valid files at once.
  const rejectionMessage =
    rejectionCode === 'too-many-files'
      ? (t('project.addChannelDialog.dropTooManyFiles') ??
        'Only one file can be added at a time.')
      : rejectionCode
        ? (t('project.addChannelDialog.dropInvalidType') ??
          'Unsupported file type.')
        : null;

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
            {file ? (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/50 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => setFile(null)}
                  disabled={isSubmitting}
                  type="button"
                  aria-label={
                    t('project.addChannelDialog.removeFile') ?? 'Remove file'
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                {...getRootProps()}
                className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
                  isDragActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 hover:border-blue-400 dark:border-gray-700 dark:hover:border-blue-600'
                } ${isSubmitting ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input {...getInputProps({ id: 'add-channel-file' })} />
                <FileUp className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <p className="text-sm">
                  {t('project.addChannelDialog.dropPrompt') ??
                    'Drag & drop a file here, or click to select'}
                </p>
              </div>
            )}
            {!file && rejectionMessage && (
              <p className="text-xs text-destructive">{rejectionMessage}</p>
            )}
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
