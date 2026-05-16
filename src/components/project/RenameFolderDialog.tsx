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
import { useRenameFolder } from '@/hooks/useFolders';
import { useLanguage } from '@/contexts/useLanguage';

export interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  currentName: string;
}

const RenameFolderDialog: React.FC<RenameFolderDialogProps> = ({
  open,
  onOpenChange,
  folderId,
  currentName,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mutation = useRenameFolder();

  useEffect(() => {
    if (!open) return;
    setName(currentName);
    const tid = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => clearTimeout(tid);
  }, [open, currentName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    try {
      await mutation.mutateAsync({ id: folderId, name: trimmed });
      toast.success(t('folders.renamed'));
      onOpenChange(false);
    } catch {
      // hook's onError handles toast + rollback
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('folders.renameFolder')}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="folder-rename">{t('folders.folderName')}</Label>
            <Input
              id="folder-rename"
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
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
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RenameFolderDialog;
