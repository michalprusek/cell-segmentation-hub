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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/exports';

/** Default colour for a brand-new class (Tailwind rose-600) — same default
 *  as the microtubule type-label dialog this was forked from. */
const DEFAULT_COLOR = '#e11d48';

interface ClassLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill for rename mode; empty for create. */
  initialName?: string;
  initialColor?: string;
  /** 'create' shows the create copy, 'rename' the edit copy. */
  mode?: 'create' | 'rename';
  onConfirm: (name: string, color: string) => void;
}

/**
 * Small dialog to create or rename a `/segmenter` dataset class: a text name
 * plus a colour swatch. Generic fork of
 * `@/pages/segmentation/components/context-menu/MtTypeLabelDialog.tsx` — same
 * shape, not tied to microtubule vocabulary. Uses the native
 * `<input type="color">` picker so no extra dependency is needed. Name is
 * trimmed and required (Confirm disabled while empty).
 */
const ClassLabelDialog: React.FC<ClassLabelDialogProps> = ({
  open,
  onOpenChange,
  initialName = '',
  initialColor = DEFAULT_COLOR,
  mode = 'create',
  onConfirm,
}) => {
  const { t } = useLanguage();
  const [name, setName] = React.useState(initialName);
  const [color, setColor] = React.useState(initialColor);

  // Reset the fields whenever the dialog (re)opens so a stale value from a
  // previous invocation never leaks into a fresh create.
  React.useEffect(() => {
    if (open) {
      setName(initialName);
      setColor(initialColor);
    }
  }, [open, initialName, initialColor]);

  const trimmed = name.trim();
  const canConfirm = trimmed.length > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(trimmed, color);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === 'rename'
              ? t('segmenter.classes.dialogTitleRename')
              : t('segmenter.classes.dialogTitleCreate')}
          </DialogTitle>
          <DialogDescription>
            {t('segmenter.classes.dialogDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="segmenter-class-name">
              {t('segmenter.classes.nameLabel')}
            </Label>
            <Input
              id="segmenter-class-name"
              value={name}
              autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleConfirm();
              }}
              placeholder={t('segmenter.classes.namePlaceholder') as string}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="segmenter-class-color">
              {t('segmenter.classes.colorLabel')}
            </Label>
            <div className="flex items-center gap-3">
              <input
                id="segmenter-class-color"
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-gray-300 dark:border-gray-600 bg-transparent p-0.5"
              />
              <span className="font-mono text-sm text-gray-500 dark:text-gray-400">
                {color}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('segmenter.classes.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {mode === 'rename'
              ? t('segmenter.classes.save')
              : t('segmenter.classes.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ClassLabelDialog;
