import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useDeleteFolder, useFolderPreview } from '@/hooks/useFolders';
import { useLanguage } from '@/contexts/useLanguage';

export interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  folderName: string;
  /** Called with the navigation target after the delete completes. If we
   *  deleted the folder the user was currently viewing, we navigate to the
   *  parent. */
  onDeleted?: () => void;
}

/**
 * Two-step destructive dialog. While open, fetches a preview of what's
 * inside the folder so the body text can show real counts:
 *   "Smazat složku X? Smaže se N projektů, M podsložek a K sdílených připojení."
 * This honours the user's "ask and delete everything (like Explorer)" choice
 * by making the consequences explicit before the click.
 */
const DeleteFolderDialog: React.FC<DeleteFolderDialogProps> = ({
  open,
  onOpenChange,
  folderId,
  folderName,
  onDeleted,
}) => {
  const { t } = useLanguage();
  const { data: preview, isLoading: previewLoading } = useFolderPreview(
    open ? folderId : null
  );
  const mutation = useDeleteFolder();

  const handleConfirm = async () => {
    if (!folderId) return;
    try {
      await mutation.mutateAsync(folderId);
      toast.success(t('folders.deleted'));
      onOpenChange(false);
      onDeleted?.();
    } catch {
      // hook surfaces error toast
    }
  };

  const owned = preview?.ownedProjectCount ?? 0;
  const shared = preview?.sharedProjectCount ?? 0;
  const subfolders = preview?.subfolderCount ?? 0;
  const description = t('folders.deleteFolderConfirm', {
    name: folderName,
    projects: owned,
    subfolders,
    shared,
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('folders.deleteFolder')}</AlertDialogTitle>
          <AlertDialogDescription>
            {previewLoading ? t('common.loading') : description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={mutation.isPending || previewLoading}
            onClick={handleConfirm}
          >
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteFolderDialog;
