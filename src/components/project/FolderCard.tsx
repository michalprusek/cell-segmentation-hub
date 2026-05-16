import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  dragSourceProps,
  readDragItem,
  shouldAcceptOnFolder,
  type DragItem,
} from '@/utils/dashboardDrag';
import FolderActions from './FolderActions';
import { useLanguage } from '@/contexts/useLanguage';

export interface FolderCardProps {
  id: string;
  name: string;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDropItem?: (item: DragItem, targetFolderId: string) => void;
}

/**
 * File-explorer style folder tile. Same aspect ratio as ProjectCard so the
 * dashboard grid stays uniform when folders and projects are interleaved.
 *
 * HTML5 native DnD: the card is both a drag source (drag folder elsewhere)
 * and a drop target (projects/other-folders land here). The drag-kind is
 * communicated via custom MIME types in dataTransfer (see dashboardDrag.ts)
 * so the dragover handler can preventDefault without needing access to the
 * full payload (which the browser hides until drop for security reasons).
 *
 * Activation: single click opens the folder. FolderActions dropdown stops
 * propagation on its own clicks so opening the menu doesn't also navigate
 * into the folder.
 */
const FolderCard = React.memo(
  ({
    id,
    name,
    onOpen,
    onRename,
    onMove,
    onDelete,
    onDropItem,
  }: FolderCardProps) => {
    const { t } = useLanguage();
    const drag = dragSourceProps({ type: 'folder', id });
    const [isOver, setIsOver] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
      if (shouldAcceptOnFolder(id, e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!isOver) setIsOver(true);
      }
    };
    const handleDragLeave = () => setIsOver(false);
    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsOver(false);
      const item = readDragItem(e.dataTransfer);
      // Reject folder-into-itself at the FE so the user doesn't see a
      // pointless round-trip toast for the no-op move.
      if (item && !(item.type === 'folder' && item.id === id)) {
        onDropItem?.(item, id);
      }
    };

    return (
      <div
        {...drag}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={onOpen}
        className="cursor-pointer"
        data-folder-id={id}
        role="button"
        aria-label={name}
      >
        <Card
          className={cn(
            'overflow-hidden transition-all duration-200 hover:shadow-md relative',
            isOver &&
              'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900'
          )}
        >
          <div className="aspect-video flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/20">
            <Folder
              className="h-20 w-20 text-blue-500/80 dark:text-blue-400/80"
              strokeWidth={1.2}
            />
            <div className="absolute top-4 right-4 z-10">
              <FolderActions
                onRename={onRename}
                onMove={onMove}
                onDelete={onDelete}
              />
            </div>
          </div>
          <CardContent className="p-5">
            <h3 className="font-medium text-lg truncate" title={name}>
              {name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('folders.folder')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
);

FolderCard.displayName = 'FolderCard';

export default FolderCard;
