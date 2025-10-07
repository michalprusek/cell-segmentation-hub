import React, { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Edit3, Trash2, MoreVertical, List } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Polygon } from '@/lib/segmentation';
import { motion } from 'framer-motion';
import { ensureValidPolygonId } from '@/lib/polygonIdUtils';
import { useIsMobile } from '@/hooks/use-mobile';

interface PolygonListPanelProps {
  loading: boolean;
  polygons: Polygon[];
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
  hiddenPolygonIds?: Set<string>;
  onTogglePolygonVisibility?: (id: string) => void;
  onRenamePolygon?: (id: string, name: string) => void;
  onDeletePolygon?: (id: string) => void;
}

/**
 * Shared polygon list content component used in both mobile and desktop layouts
 */
const PolygonListContent: React.FC<{
  loading: boolean;
  polygons: Polygon[];
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
  hiddenPolygonIds: Set<string>;
  onTogglePolygonVisibility?: (id: string) => void;
  onRenamePolygon?: (id: string, name: string) => void;
  onDeletePolygon?: (id: string) => void;
  editingPolygonId: string | null;
  setEditingPolygonId: (id: string | null) => void;
  editingName: string;
  setEditingName: (name: string) => void;
  handleStartRename: (polygon: Polygon) => void;
  handleSaveRename: () => void;
  handleCancelRename: () => void;
}> = ({
  loading,
  polygons,
  selectedPolygonId,
  onSelectPolygon,
  hiddenPolygonIds,
  onTogglePolygonVisibility,
  onDeletePolygon,
  editingPolygonId,
  editingName,
  setEditingName,
  handleStartRename,
  handleSaveRename,
  handleCancelRename,
}) => {
  const { t } = useLanguage();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Determine if a polygon is internal based on parent_id or type
  const isInternalPolygon = (polygon: any) => {
    return polygon.parent_id || polygon.type === 'internal';
  };

  const getPolygonColor = (polygon: any) => {
    return isInternalPolygon(polygon) ? 'bg-blue-500' : 'bg-red-500';
  };

  // Handle wheel events in the scroll area to prevent page scrolling
  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    const handleWheel = (e: WheelEvent) => {
      const element = scrollArea;
      const { scrollTop, scrollHeight, clientHeight } = element;

      // Check if we're at the top or bottom of the scroll area
      const atTop = scrollTop === 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight;

      // If scrolling up and at top, or scrolling down and at bottom,
      // let the event bubble up (which will be handled by zoom)
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
        return;
      }

      // Otherwise, stop the event from bubbling to prevent zoom/page scroll
      e.stopPropagation();
    };

    scrollArea.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      scrollArea.removeEventListener('wheel', handleWheel);
    };
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (!polygons || polygons.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('segmentation.status.polygons')}
          </h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <div className="text-sm">{t('segmentation.status.noPolygons')}</div>
            <div className="text-xs mt-1">
              {t('segmentation.status.startCreating')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('segmentation.status.polygonList')} ({polygons.length})
        </h3>
      </div>

      {/* Polygon List */}
      <div
        ref={scrollAreaRef}
        className="flex-1 overflow-y-auto min-h-0"
        data-scroll-area="true"
      >
        <div className="p-2 space-y-1">
          {polygons.map((polygon, index) => {
            const isSelected = selectedPolygonId === polygon.id;
            const isHidden = hiddenPolygonIds.has(polygon.id);
            const isEditing = editingPolygonId === polygon.id;
            const polygonName =
              polygon.name || `${t('common.polygon')} ${index + 1}`;

            return (
              <motion.div
                key={ensureValidPolygonId(polygon.id, `polygon-list-${index}`)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`
                  relative group rounded-lg border transition-all duration-200 cursor-pointer
                  ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                  ${isHidden ? 'opacity-50' : ''}
                `}
                onClick={() =>
                  !isEditing && onSelectPolygon(isSelected ? null : polygon.id)
                }
              >
                <div className="p-3">
                  <div className="flex items-center gap-3">
                    {/* Color indicator */}
                    <div
                      className={`w-3 h-3 rounded-full ${getPolygonColor(polygon)}`}
                    />

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <Input
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveRename();
                            if (e.key === 'Escape') handleCancelRename();
                          }}
                          onBlur={handleSaveRename}
                          className="h-6 text-xs"
                          autoFocus
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {polygonName}
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        <span>
                          {polygon.points?.length || 0}{' '}
                          {t('segmentation.status.vertices')}
                        </span>
                        <span>•</span>
                        <span>
                          {isInternalPolygon(polygon)
                            ? t('segmentation.status.internal')
                            : t('segmentation.status.external')}
                        </span>
                        {polygon.area && (
                          <>
                            <span>•</span>
                            <span>{Math.round(polygon.area)} px²</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {/* Visibility toggle */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-60 hover:opacity-100 transition-opacity"
                        onClick={e => {
                          e.stopPropagation();
                          onTogglePolygonVisibility?.(polygon.id);
                        }}
                      >
                        {isHidden ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </Button>

                      {/* More actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-60 hover:opacity-100 transition-opacity"
                            onClick={e => e.stopPropagation()}
                          >
                            <MoreVertical className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleStartRename(polygon)}
                          >
                            <Edit3 className="h-3 w-3 mr-2" />
                            {t('common.rename')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onDeletePolygon?.(polygon.id)}
                            className="text-red-600 dark:text-red-400"
                          >
                            <Trash2 className="h-3 w-3 mr-2" />
                            {t('common.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </>
  );
};

/**
 * Main PolygonListPanel component with responsive mobile/desktop layout
 */
const PolygonListPanel: React.FC<PolygonListPanelProps> = ({
  loading,
  polygons,
  selectedPolygonId,
  onSelectPolygon,
  hiddenPolygonIds = new Set(),
  onTogglePolygonVisibility,
  onRenamePolygon,
  onDeletePolygon,
}) => {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingPolygonId, setEditingPolygonId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const handleStartRename = (polygon: Polygon) => {
    setEditingPolygonId(polygon.id);
    setEditingName(
      polygon.name || `${t('common.polygon')} ${polygon.id.substring(0, 8)}`
    );
  };

  const handleSaveRename = () => {
    if (editingPolygonId && onRenamePolygon) {
      onRenamePolygon(editingPolygonId, editingName);
    }
    setEditingPolygonId(null);
    setEditingName('');
  };

  const handleCancelRename = () => {
    setEditingPolygonId(null);
    setEditingName('');
  };

  const contentProps = {
    loading,
    polygons,
    selectedPolygonId,
    onSelectPolygon,
    hiddenPolygonIds,
    onTogglePolygonVisibility,
    onRenamePolygon,
    onDeletePolygon,
    editingPolygonId,
    setEditingPolygonId,
    editingName,
    setEditingName,
    handleStartRename,
    handleSaveRename,
    handleCancelRename,
  };

  // Mobile layout: bottom sheet drawer
  if (isMobile) {
    return (
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTrigger asChild>
          <Button
            variant="default"
            size="sm"
            className="fixed bottom-4 right-4 z-40 rounded-full w-12 h-12 p-0 shadow-lg"
          >
            <List className="h-5 w-5" />
            {polygons.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {polygons.length}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="h-[70vh] p-0 dark:bg-gray-800"
        >
          <div className="h-full flex flex-col bg-white dark:bg-gray-800">
            <SheetHeader className="p-4 border-b border-gray-200 dark:border-gray-700">
              <SheetTitle className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t('segmentation.status.polygonList')} ({polygons.length})
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden">
              <PolygonListContent {...contentProps} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop layout: fixed side panel
  return (
    <div className="w-72 h-full bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col">
      <PolygonListContent {...contentProps} />
    </div>
  );
};

export default PolygonListPanel;
