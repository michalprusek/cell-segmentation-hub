import React from 'react';
import { Button } from '@/components/ui/button';
import { MoreVertical, Pencil, Trash, FolderInput } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/contexts/useLanguage';

export interface FolderActionsProps {
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/**
 * Per-folder context menu shown in the top-right corner of FolderCard /
 * FolderListItem. Mirrors ProjectActions in look-and-feel but exposes
 * Rename / Move-to / Delete. "Move to…" is always available: even with
 * a single folder, the user may still want to move it to root or pick
 * a destination from the tree.
 *
 * All click handlers stop propagation so opening the menu doesn't also
 * trigger the wrapping FolderCard's "open folder" navigation.
 */
const FolderActions: React.FC<FolderActionsProps> = ({
  onRename,
  onMove,
  onDelete,
}) => {
  const { t } = useLanguage();

  return (
    <div onClick={e => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full shadow-sm bg-white/80 hover:bg-white text-gray-700 dark:bg-gray-800/80 dark:hover:bg-gray-700 dark:text-gray-100 backdrop-blur-sm"
            onClick={e => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48"
          onClick={e => e.stopPropagation()}
        >
          <DropdownMenuItem
            onClick={e => {
              e.stopPropagation();
              onRename();
            }}
          >
            <Pencil className="h-4 w-4 mr-2" />
            {t('folders.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={e => {
              e.stopPropagation();
              onMove();
            }}
          >
            <FolderInput className="h-4 w-4 mr-2" />
            {t('folders.moveTo')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-red-600"
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash className="h-4 w-4 mr-2" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default FolderActions;
