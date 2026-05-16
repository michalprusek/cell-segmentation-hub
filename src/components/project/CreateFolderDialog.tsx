import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useCreateFolder } from '@/hooks/useFolders';
import { useLanguage } from '@/contexts/useLanguage';

export interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** parentId === null => create at root, else nest under the given folder. */
  parentId: string | null;
}

/**
 * Modal for creating a folder under the supplied parent. The dialog manages
 * its own input state and resets on open so re-opening always starts blank.
 * The submit handler awaits the mutation result so the toast and dismissal
 * happen in the right order; rollback on failure is handled by the hook's
 * onError (the optimistic insert is removed).
 */
const CreateFolderDialog: React.FC<CreateFolderDialogProps> = ({
  open,
  onOpenChange,
  parentId,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mutation = useCreateFolder();

  useEffect(() => {
    if (!open) return;
    setName('');
    // Focus the input on the next tick so the dialog's mount animation
    // finishes before the field receives focus.
    const tid = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(tid);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await mutation.mutateAsync({ name: trimmed, parentId });
      toast.success(t('folders.created'));
      onOpenChange(false);
    } catch {
      // hook's onError already surfaced toast + rolled back optimistic
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('folders.createFolder')}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="folder-name">{t('folders.folderName')}</Label>
            <Input
              id="folder-name"
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              placeholder={String(t('folders.folderNamePlaceholder'))}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {t('folders.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateFolderDialog;
