import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
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

export interface FolderListItemProps {
  id: string;
  name: string;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDropItem?: (item: DragItem, targetFolderId: string) => void;
}

const FolderListItem = React.memo(
  ({
    id,
    name,
    onOpen,
    onRename,
    onMove,
    onDelete,
    onDropItem,
  }: FolderListItemProps) => {
    const { t } = useLanguage();
    const drag = dragSourceProps({ type: 'folder', id });
    const [isOver, setIsOver] = useState(false);

    return (
      <div
        {...drag}
        onDragOver={e => {
          if (shouldAcceptOnFolder(id, e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!isOver) setIsOver(true);
          }
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={e => {
          e.preventDefault();
          setIsOver(false);
          const item = readDragItem(e.dataTransfer);
          if (item && !(item.type === 'folder' && item.id === id)) {
            onDropItem?.(item, id);
          }
        }}
        onClick={onOpen}
        className="cursor-pointer"
      >
        <Card
          className={cn(
            'p-3 flex items-center gap-4 transition-all duration-200 hover:shadow-sm relative',
            isOver &&
              'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-900'
          )}
        >
          <div className="h-16 w-16 flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/20 rounded">
            <Folder
              className="h-10 w-10 text-blue-500/80 dark:text-blue-400/80"
              strokeWidth={1.2}
            />
          </div>
          <div className="flex-grow min-w-0">
            <h3 className="font-medium truncate" title={name}>
              {name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('folders.folder')}
            </p>
          </div>
          <FolderActions
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
          />
        </Card>
      </div>
    );
  }
);

FolderListItem.displayName = 'FolderListItem';

export default FolderListItem;
