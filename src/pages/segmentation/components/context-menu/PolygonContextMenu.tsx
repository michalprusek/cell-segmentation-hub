import React from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  Trash,
  Scissors,
  Edit,
  Link,
  BarChart3,
  ChevronsRight,
} from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import type { ProjectType } from '@/types';
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
  /** Drives which polyline-specific items render. ``'sperm'`` shows the
   *  head/midpiece/tail re-classify + "Assign to instance N" submenu;
   *  ``'microtubules'`` shows "Show kymograph"; other types fall back
   *  to edit + delete only. */
  projectType?: ProjectType;
  onChangePartClass?: (partClass: 'head' | 'midpiece' | 'tail') => void;
  onChangeInstanceId?: (instanceId: string) => void;
  currentInstanceId?: string;
  availableInstanceIds?: string[];
  /** Propagate this microtubule into all following frames (MT only). */
  onPropagate?: () => void;
  /** Cross-frame track id — when set on a microtubule, delete removes the whole
   *  track (all frames) rather than just this polyline. Matches the source
   *  `polygon.trackId` (string | undefined). */
  trackId?: string;
  /** Total frames in the video, shown in the "delete whole track" dialog. */
  videoFrameCount?: number;
  /** Propagate ALL Shift-selected microtubules to the following frames. */
  onPropagateSelected?: () => void;
  /** Size of the Shift+click multi-selection (gates the bulk-propagate item). */
  multiSelectCount?: number;
}

const PolygonContextMenu = ({
  children,
  onDelete,
  onSlice,
  onEdit,
  polygonId,
  isPolyline = false,
  projectType,
  onChangePartClass,
  onChangeInstanceId,
  currentInstanceId,
  availableInstanceIds,
  onPropagate,
  trackId,
  videoFrameCount,
  onPropagateSelected,
  multiSelectCount = 0,
}: PolygonContextMenuProps) => {
  const isSperm = projectType === 'sperm';
  const isMicrotubules = projectType === 'microtubules';
  // A microtubule with a cross-frame trackId: deleting it removes the whole
  // track, and it can be propagated forward.
  const hasTrack = isMicrotubules && !!trackId;

  // Fire the global "open kymograph" event that VideoModeOverlay
  // already listens for — no new prop plumbing needed. The overlay
  // mounts the KymographModal for the selected polylineId.
  const handleShowKymograph = React.useCallback(() => {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(
      new CustomEvent('segmentation:open-kymograph', {
        detail: { polylineId: polygonId },
      })
    );
  }, [polygonId]);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [showPropagateDialog, setShowPropagateDialog] = React.useState(false);
  const [showPropagateSelectedDialog, setShowPropagateSelectedDialog] =
    React.useState(false);
  // Bulk-propagate the Shift+click multi-selection — only meaningful with ≥2.
  const canPropagateSelected =
    isMicrotubules && !!onPropagateSelected && multiSelectCount >= 2;
  const { t } = useLanguage();

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuItem onClick={onEdit} className="cursor-pointer">
            <Edit className="mr-2 h-4 w-4" />
            <span>
              {isPolyline
                ? t('contextMenu.editPolyline')
                : t('contextMenu.editPolygon')}
            </span>
          </ContextMenuItem>
          {!isPolyline && (
            <ContextMenuItem onClick={onSlice} className="cursor-pointer">
              <Scissors className="mr-2 h-4 w-4" />
              <span>{t('contextMenu.splitPolygon')}</span>
            </ContextMenuItem>
          )}
          {isPolyline && isMicrotubules && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={handleShowKymograph}
                className="cursor-pointer"
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                <span>
                  {t('editor.kymograph.showKymograph', {
                    defaultValue: 'Show kymograph',
                  })}
                </span>
              </ContextMenuItem>
              {onPropagate && (
                <ContextMenuItem
                  onClick={() => setShowPropagateDialog(true)}
                  className="cursor-pointer"
                >
                  <ChevronsRight className="mr-2 h-4 w-4" />
                  <span>{t('contextMenu.propagateTrack')}</span>
                </ContextMenuItem>
              )}
              {canPropagateSelected && (
                <ContextMenuItem
                  onClick={() => setShowPropagateSelectedDialog(true)}
                  className="cursor-pointer"
                >
                  <ChevronsRight className="mr-2 h-4 w-4" />
                  <span>
                    {t('contextMenu.propagateSelectedTracks', {
                      count: multiSelectCount,
                    })}
                  </span>
                </ContextMenuItem>
              )}
            </>
          )}
          {isPolyline && isSperm && onChangePartClass && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => onChangePartClass('head')}
                className="cursor-pointer"
              >
                <span
                  className="mr-2 h-4 w-4 inline-block rounded-full bg-green-500"
                  style={{ width: 12, height: 12 }}
                />
                <span>{t('sperm.setAsHead')}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onChangePartClass('midpiece')}
                className="cursor-pointer"
              >
                <span
                  className="mr-2 h-4 w-4 inline-block rounded-full bg-orange-500"
                  style={{ width: 12, height: 12 }}
                />
                <span>{t('sperm.setAsMidpiece')}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onChangePartClass('tail')}
                className="cursor-pointer"
              >
                <span
                  className="mr-2 h-4 w-4 inline-block rounded-full bg-cyan-500"
                  style={{ width: 12, height: 12 }}
                />
                <span>{t('sperm.setAsTail')}</span>
              </ContextMenuItem>
            </>
          )}
          {isPolyline &&
            isSperm &&
            onChangeInstanceId &&
            availableInstanceIds &&
            availableInstanceIds.length > 0 && (
              <>
                <ContextMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-gray-500">
                  <Link className="inline h-3 w-3 mr-1" />
                  {t('sperm.assignTo')}
                </div>
                {availableInstanceIds.map(instanceId => {
                  const label =
                    instanceId.match(/^sperm_(\d+)$/)?.[1] || instanceId;
                  const isCurrent = currentInstanceId === instanceId;
                  return (
                    <ContextMenuItem
                      key={instanceId}
                      onClick={() => onChangeInstanceId(instanceId)}
                      className={`cursor-pointer ${isCurrent ? 'bg-violet-50 dark:bg-violet-900/20 font-medium' : ''}`}
                    >
                      <span
                        className={`mr-2 inline-block rounded-full ${isCurrent ? 'bg-violet-500' : 'bg-gray-400'}`}
                        style={{ width: 8, height: 8 }}
                      />
                      <span>
                        {t('sperm.instance')} {label}
                      </span>
                      {isCurrent && (
                        <span className="ml-auto text-violet-500 text-xs">
                          ✓
                        </span>
                      )}
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
            <span>
              {hasTrack
                ? t('contextMenu.deleteTrack')
                : isPolyline
                  ? t('contextMenu.deletePolyline')
                  : t('contextMenu.deletePolygon')}
            </span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasTrack
                ? t('contextMenu.confirmDeleteTrack')
                : t('contextMenu.confirmDeletePolygon')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasTrack
                ? t('contextMenu.deleteTrackDescription', {
                    count: videoFrameCount ?? 0,
                  })
                : t('contextMenu.deletePolygonDescription')}
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

      <AlertDialog
        open={showPropagateDialog}
        onOpenChange={setShowPropagateDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('contextMenu.confirmPropagateTrack')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('contextMenu.propagateTrackDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onPropagate?.();
                setShowPropagateDialog(false);
              }}
            >
              {t('contextMenu.propagateTrack')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showPropagateSelectedDialog}
        onOpenChange={setShowPropagateSelectedDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('contextMenu.confirmPropagateSelected', {
                count: multiSelectCount,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('contextMenu.propagateSelectedDescription', {
                count: multiSelectCount,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onPropagateSelected?.();
                setShowPropagateSelectedDialog(false);
              }}
            >
              {t('contextMenu.propagateSelectedTracks', {
                count: multiSelectCount,
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PolygonContextMenu;
