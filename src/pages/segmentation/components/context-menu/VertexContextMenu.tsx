import React from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Trash } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';

interface VertexContextMenuProps {
  children: React.ReactNode;
  onDelete: () => void;
  vertexIndex: number;
  polygonId: string;
}

const VertexContextMenu = ({
  children,
  onDelete,
  vertexIndex,
  polygonId,
}: VertexContextMenuProps) => {
  const { t } = useLanguage();

  const handleDelete = React.useCallback((e: React.MouseEvent) => {
    // Stop propagation to prevent polygon deselection
    e.stopPropagation();
    onDelete();
  }, [onDelete]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-64"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <ContextMenuItem
          onClick={handleDelete}
          className="cursor-pointer text-red-600"
        >
          <Trash className="mr-2 h-4 w-4" />
          <span>{t('contextMenu.deleteVertex')}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default VertexContextMenu;
