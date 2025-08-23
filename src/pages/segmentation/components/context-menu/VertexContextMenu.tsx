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
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem
          onClick={onDelete}
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
