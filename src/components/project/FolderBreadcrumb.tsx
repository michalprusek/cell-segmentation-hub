import React, { useState } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  readDragItem,
  shouldAcceptOnBreadcrumb,
  type DragItem,
} from '@/utils/dashboardDrag';
import { useLanguage } from '@/contexts/useLanguage';
import type { ProjectFolder } from '@/types';

export interface FolderBreadcrumbProps {
  /** Empty array == at root; otherwise root → currentFolder, inclusive. */
  path: ProjectFolder[];
  onNavigate: (folderId: string | null) => void;
  /** Drop a project/folder onto a breadcrumb segment to move it there.
   *  `null` targetFolderId means "back to root". */
  onDropToTarget?: (item: DragItem, targetFolderId: string | null) => void;
}

const BreadcrumbDropSpan: React.FC<{
  targetFolderId: string | null;
  ariaLabel: string;
  onClick?: () => void;
  isCurrent: boolean;
  onDropToTarget?: (item: DragItem, targetFolderId: string | null) => void;
  children: React.ReactNode;
}> = ({
  targetFolderId,
  ariaLabel,
  onClick,
  isCurrent,
  onDropToTarget,
  children,
}) => {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (shouldAcceptOnBreadcrumb(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!isOver) setIsOver(true);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const item = readDragItem(e.dataTransfer);
    if (!item) return;
    // Skip move when the dragged folder is already exactly at this level —
    // the drop would be a no-op and the toast would be misleading.
    if (item.type === 'folder' && item.id === targetFolderId) return;
    onDropToTarget?.(item, targetFolderId);
  };

  const className = cn(
    'rounded px-1 transition-colors',
    isOver && 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200'
  );
  const dropHandlers = {
    onDragOver: handleDragOver,
    onDragLeave: () => setIsOver(false),
    onDrop: handleDrop,
  };

  if (isCurrent) {
    return (
      <BreadcrumbPage>
        <span className={className} aria-label={ariaLabel} {...dropHandlers}>
          {children}
        </span>
      </BreadcrumbPage>
    );
  }
  return (
    <BreadcrumbLink onClick={onClick}>
      <span
        className={cn(className, 'cursor-pointer')}
        aria-label={ariaLabel}
        {...dropHandlers}
      >
        {children}
      </span>
    </BreadcrumbLink>
  );
};

const FolderBreadcrumb: React.FC<FolderBreadcrumbProps> = ({
  path,
  onNavigate,
  onDropToTarget,
}) => {
  const { t } = useLanguage();
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbDropSpan
            targetFolderId={null}
            ariaLabel={String(t('folders.home'))}
            isCurrent={path.length === 0}
            onClick={() => onNavigate(null)}
            onDropToTarget={onDropToTarget}
          >
            <span className="inline-flex items-center gap-1">
              <Home className="h-3.5 w-3.5" />
              {t('folders.home')}
            </span>
          </BreadcrumbDropSpan>
        </BreadcrumbItem>
        {path.map((node, idx) => {
          const isLast = idx === path.length - 1;
          return (
            <React.Fragment key={node.id}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbDropSpan
                  targetFolderId={node.id}
                  ariaLabel={node.name}
                  isCurrent={isLast}
                  onClick={() => onNavigate(node.id)}
                  onDropToTarget={onDropToTarget}
                >
                  {node.name}
                </BreadcrumbDropSpan>
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

export default FolderBreadcrumb;
