import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Folder, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useFolders,
  useMoveFolder,
  useMoveProjects,
  type FolderNode,
} from '@/hooks/useFolders';
import { useLanguage } from '@/contexts/useLanguage';

export type MoveSubject =
  | { kind: 'project'; ids: string[] }
  | { kind: 'folder'; id: string };

export interface MoveToFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: MoveSubject | null;
}

/**
 * Click-based "Move to…" picker. Shows the user's full folder tree as a
 * nested list and lets them choose a destination (including the Root entry
 * for "move out of any folder"). Used both from project context menus
 * ("subject.kind === 'project'") and folder context menus ("kind === 'folder'").
 *
 * When subject is a folder, we hide that folder and its descendants from the
 * picker — moving into oneself or a child is invalid and the backend would
 * reject it anyway, so saving the user the round-trip is courtesy.
 */
const MoveToFolderDialog: React.FC<MoveToFolderDialogProps> = ({
  open,
  onOpenChange,
  subject,
}) => {
  const { t } = useLanguage();
  const { tree } = useFolders();
  const [selected, setSelected] = useState<string | null>(null);
  const moveProjects = useMoveProjects();
  const moveFolder = useMoveFolder();

  // Set of folder ids that should be disabled when subject is a folder
  // (the folder itself and all its descendants — moving into oneself or a
  // child is invalid). Walks the tree once, finds the subject, then DFSes
  // its subtree to collect ids.
  const disabled = useMemo(() => {
    const out = new Set<string>();
    if (!subject || subject.kind !== 'folder') return out;
    const collectSubtree = (node: FolderNode) => {
      out.add(node.id);
      for (const c of node.children) collectSubtree(c);
    };
    const findSubject = (nodes: FolderNode[]): FolderNode | null => {
      for (const n of nodes) {
        if (n.id === subject.id) return n;
        const inChild = findSubject(n.children);
        if (inChild) return inChild;
      }
      return null;
    };
    const node = findSubject(tree);
    if (node) collectSubtree(node);
    return out;
  }, [tree, subject]);

  const handleConfirm = async () => {
    if (!subject) return;
    try {
      if (subject.kind === 'project') {
        const result = await moveProjects.mutateAsync({
          folderId: selected,
          projectIds: subject.ids,
        });
        // Backend may silently drop projects the user can't access. Surface
        // the partial outcome instead of pretending the whole move succeeded.
        if (result.skippedProjectIds.length > 0) {
          const moved = result.movedProjectIds.length;
          const skipped = result.skippedProjectIds.length;
          if (moved === 0) {
            toast.warning(
              String(t('folders.moveAllSkipped', { count: skipped }))
            );
          } else {
            toast.warning(String(t('folders.movePartial', { moved, skipped })));
          }
        } else {
          toast.success(String(t('folders.moved')));
        }
      } else {
        await moveFolder.mutateAsync({
          id: subject.id,
          parentId: selected,
        });
        toast.success(String(t('folders.moved')));
      }
      onOpenChange(false);
    } catch {
      // hook handles error toast
    }
  };

  const pending = moveProjects.isPending || moveFolder.isPending;

  const renderNode = (node: FolderNode, depth: number): React.ReactNode => {
    const isDisabled = disabled.has(node.id);
    return (
      <li key={node.id}>
        <button
          type="button"
          disabled={isDisabled}
          className={cn(
            'flex items-center gap-2 w-full px-2 py-1.5 rounded text-left',
            'hover:bg-gray-100 dark:hover:bg-gray-800',
            isDisabled && 'opacity-40 cursor-not-allowed',
            selected === node.id &&
              'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200'
          )}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => !isDisabled && setSelected(node.id)}
        >
          <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {node.children.length > 0 && (
          <ul>{node.children.map(c => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('folders.moveTo')}</DialogTitle>
        </DialogHeader>
        <ul className="max-h-72 overflow-y-auto border rounded-md py-1 dark:border-gray-700">
          <li>
            <button
              type="button"
              className={cn(
                'flex items-center gap-2 w-full px-2 py-1.5 rounded text-left',
                'hover:bg-gray-100 dark:hover:bg-gray-800',
                selected === null &&
                  'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200'
              )}
              onClick={() => setSelected(null)}
            >
              <Home className="h-4 w-4 flex-shrink-0 text-gray-500" />
              <span>{t('folders.moveToRoot')}</span>
            </button>
          </li>
          {tree.map(n => renderNode(n, 0))}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={pending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MoveToFolderDialog;
