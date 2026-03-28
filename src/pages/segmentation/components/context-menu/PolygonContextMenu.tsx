import React from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Trash, Scissors, Edit, Link } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface PolygonContextMenuProps {
  children: React.ReactNode;
  onDelete: () => void;
  onSlice: () => void;
  onEdit: () => void;
  polygonId: string;
  isPolyline?: boolean;
  onChangePartClass?: (partClass: 'head' | 'midpiece' | 'tail') => void;
  onChangeInstanceId?: (instanceId: string) => void;
  currentInstanceId?: string;
  availableInstanceIds?: string[];
}

const PolygonContextMenu = ({
  children,
  onDelete,
  onSlice,
  onEdit,
  polygonId,
  isPolyline = false,
  onChangePartClass,
  onChangeInstanceId,
  currentInstanceId,
  availableInstanceIds,
}: PolygonContextMenuProps) => {
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const { t } = useLanguage();

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuItem onClick={onEdit} className="cursor-pointer">
            <Edit className="mr-2 h-4 w-4" />
            <span>{isPolyline ? t('contextMenu.editPolyline') : t('contextMenu.editPolygon')}</span>
          </ContextMenuItem>
          {!isPolyline && (
            <ContextMenuItem onClick={onSlice} className="cursor-pointer">
              <Scissors className="mr-2 h-4 w-4" />
              <span>{t('contextMenu.splitPolygon')}</span>
            </ContextMenuItem>
          )}
          {isPolyline && onChangePartClass && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => onChangePartClass('head')}
                className="cursor-pointer"
              >
                <span className="mr-2 h-4 w-4 inline-block rounded-full bg-green-500" style={{ width: 12, height: 12 }} />
                <span>{t('sperm.setAsHead')}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onChangePartClass('midpiece')}
                className="cursor-pointer"
              >
                <span className="mr-2 h-4 w-4 inline-block rounded-full bg-orange-500" style={{ width: 12, height: 12 }} />
                <span>{t('sperm.setAsMidpiece')}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onChangePartClass('tail')}
                className="cursor-pointer"
              >
                <span className="mr-2 h-4 w-4 inline-block rounded-full bg-cyan-500" style={{ width: 12, height: 12 }} />
                <span>{t('sperm.setAsTail')}</span>
              </ContextMenuItem>
            </>
          )}
          {isPolyline && onChangeInstanceId && availableInstanceIds && availableInstanceIds.length > 0 && (
            <>
              <ContextMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-medium text-gray-500">
                <Link className="inline h-3 w-3 mr-1" />
                {t('sperm.assignTo')}
              </div>
              {availableInstanceIds.map(instanceId => {
                const label = instanceId.match(/^sperm_(\d+)$/)?.[1] || instanceId;
                const isCurrent = currentInstanceId === instanceId;
                return (
                  <ContextMenuItem
                    key={instanceId}
                    onClick={() => onChangeInstanceId(instanceId)}
                    className={`cursor-pointer ${isCurrent ? 'bg-violet-50 dark:bg-violet-900/20 font-medium' : ''}`}
                  >
                    <span className={`mr-2 inline-block rounded-full ${isCurrent ? 'bg-violet-500' : 'bg-gray-400'}`} style={{ width: 8, height: 8 }} />
                    <span>{t('sperm.instance')} {label}</span>
                    {isCurrent && <span className="ml-auto text-violet-500 text-xs">✓</span>}
                  </ContextMenuItem>
                );
              })}
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => setShowDeleteDialog(true)}
            className="cursor-pointer text-red-600"
          >
            <Trash className="mr-2 h-4 w-4" />
            <span>{isPolyline ? t('contextMenu.deletePolyline') : t('contextMenu.deletePolygon')}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('contextMenu.confirmDeletePolygon')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('contextMenu.deletePolygonDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete();
                setShowDeleteDialog(false);
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PolygonContextMenu;
