import React from 'react';
import { Loader2 } from 'lucide-react';
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

export interface UnsavedChangesDialogProps {
  open: boolean;
  /** Called with `false` when the user dismisses (Cancel / Esc / overlay). */
  onOpenChange: (open: boolean) => void;
  /** Persist the edits, then leave. Must not close the dialog itself — the
   *  caller closes it only once the save actually succeeded. Omitted when
   *  there is no save handler at all, and the button is then hidden rather
   *  than offering an action that cannot work. */
  onSaveAndLeave?: () => void;
  /** Leave immediately, dropping the edits. */
  onDiscardAndLeave: () => void;
  /** A save started from this dialog is in flight. */
  isSaving?: boolean;
  /** The last save started from this dialog failed. The dialog stays open and
   *  says so, because the alternative — closing on a failed save — is how the
   *  edits used to disappear silently. */
  saveFailed?: boolean;
}

/**
 * Three-way confirmation shown when the user leaves the segmentation editor
 * with unsaved edits: save and leave, leave anyway, or stay.
 *
 * Before this dialog existed the breadcrumb buttons navigated FIRST and then
 * raced a "background" save against a 3 s timeout. The editor unmounts on
 * navigation and its unmount effect calls `abortAll()`, which aborts the
 * `manual-save` signal — so that save was routinely cancelled mid-flight and
 * the loss was only ever `logger.warn`'d.
 *
 * Uses a plain `Dialog` rather than `AlertDialog` because the choice has two
 * affirmative outcomes and `AlertDialogAction`/`AlertDialogCancel` model a
 * binary one — the same reason `DeleteTrackScopeDialog` and
 * `SegmentChannelDialog` do.
 */
const UnsavedChangesDialog = ({
  open,
  onOpenChange,
  onSaveAndLeave,
  onDiscardAndLeave,
  isSaving = false,
  saveFailed = false,
}: UnsavedChangesDialogProps) => {
  const { t } = useLanguage();

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // A save in flight owns the dialog: dismissing it here would navigate
        // nowhere and leave the user with no report of whether it worked.
        if (isSaving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('segmentation.toolbar.leaveConfirmTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('segmentation.toolbar.leaveConfirmDescription')}
          </DialogDescription>
        </DialogHeader>
        {saveFailed && (
          <p
            role="alert"
            data-testid="unsaved-changes-save-failed"
            className="text-sm font-medium text-red-600 dark:text-red-400"
          >
            {t('segmentation.toolbar.saveBeforeLeaveFailed')}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="outline"
            disabled={isSaving}
            data-testid="unsaved-changes-discard"
            onClick={onDiscardAndLeave}
          >
            {t('segmentation.toolbar.leaveWithoutSaving')}
          </Button>
          {onSaveAndLeave && (
            <Button
              disabled={isSaving}
              aria-busy={isSaving}
              data-testid="unsaved-changes-save"
              onClick={onSaveAndLeave}
              className="flex items-center gap-2"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSaving
                ? t('segmentation.toolbar.saving')
                : t('segmentation.toolbar.saveAndLeave')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UnsavedChangesDialog;
