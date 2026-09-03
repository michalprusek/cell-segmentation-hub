import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/useLanguage';

export interface DeleteTrackScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Frames in the video — labels the "all frames" button when known. */
  frameCount?: number;
  /** Remove the microtubule from the current frame only. */
  onDeleteFrame: () => void;
  /** Remove the microtubule from every frame of the video. */
  onDeleteTrack: () => void;
  /** How many microtubules the choice applies to. Omitted (or 1) is the
   *  single-microtubule case and reads exactly as it always did; 2+ is a
   *  bulk delete and the title says so, because "delete from all frames" over
   *  a selection the user can no longer see is worth spelling out. */
  count?: number;
}

/**
 * Three-way confirmation for deleting a *tracked* microtubule: current frame
 * only, the whole track, or cancel.
 *
 * A tracked polyline is one object spread over every frame of the video, so
 * "delete" is genuinely ambiguous and the editor must not pick for the user —
 * before this dialog existed, every delete path removed the whole track (the
 * context menu explicitly, the Delete key and the sidebar silently at save
 * time, via the backend's cross-frame delete propagation).
 *
 * Uses a plain `Dialog` rather than `AlertDialog` because the choice has two
 * affirmative outcomes and `AlertDialogAction`/`AlertDialogCancel` model a
 * binary one — the same reason `SegmentChannelDialog` does.
 */
const DeleteTrackScopeDialog = ({
  open,
  onOpenChange,
  frameCount,
  onDeleteFrame,
  onDeleteTrack,
  count = 1,
}: DeleteTrackScopeDialogProps) => {
  const { t } = useLanguage();
  // Only label the button with a count we actually have; an unknown frame count
  // would otherwise read as "All 0 frames".
  const knownFrameCount =
    typeof frameCount === 'number' &&
    Number.isFinite(frameCount) &&
    frameCount > 0
      ? frameCount
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {count > 1
              ? t('contextMenu.confirmDeleteScopeSelected', { count })
              : t('contextMenu.confirmDeleteScope')}
          </DialogTitle>
          <DialogDescription>
            {t('contextMenu.deleteScopeDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="outline"
            data-testid="delete-scope-frame"
            onClick={() => {
              onOpenChange(false);
              onDeleteFrame();
            }}
          >
            {t('contextMenu.deleteScopeThisFrame')}
          </Button>
          <Button
            variant="destructive"
            data-testid="delete-scope-track"
            onClick={() => {
              onOpenChange(false);
              onDeleteTrack();
            }}
          >
            {knownFrameCount === null
              ? t('contextMenu.deleteScopeAllFrames')
              : t('contextMenu.deleteScopeAllFramesCount', {
                  count: knownFrameCount,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteTrackScopeDialog;
