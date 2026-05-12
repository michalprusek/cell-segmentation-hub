/**
 * Right-click context menu that appears on a polygon/polyline body
 * (as opposed to the existing VertexContextMenu on a single vertex).
 *
 * For microtubule projects, the menu's headline action is
 * "Show kymograph" — for any other project type, only the destructive
 * delete action is shown.
 */

import { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useLanguage } from '@/contexts/useLanguage';
import type { ProjectType } from '@/types';

interface PolygonContextMenuProps {
  children: ReactNode;
  projectType?: ProjectType;
  polygonId: string;
  onShowKymograph?: (polygonId: string) => void;
  onDelete?: (polygonId: string) => void;
}

export function PolygonContextMenu({
  children,
  projectType,
  polygonId,
  onShowKymograph,
  onDelete,
}: PolygonContextMenuProps) {
  const { t } = useLanguage();
  const isMicrotubule = projectType === 'microtubules';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {isMicrotubule && onShowKymograph && (
          <>
            <ContextMenuItem onSelect={() => onShowKymograph(polygonId)}>
              {t('editor.kymograph.showKymograph', {
                defaultValue: 'Show kymograph',
              })}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {onDelete && (
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onDelete(polygonId)}
          >
            {t('editor.contextMenu.deletePolyline', {
              defaultValue: 'Delete polyline',
            })}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
