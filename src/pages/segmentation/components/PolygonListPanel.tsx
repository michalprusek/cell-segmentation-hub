import React, { useState, useRef, useEffect, useDeferredValue } from 'react';
import {
  Eye,
  EyeOff,
  Edit3,
  Trash2,
  MoreVertical,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Polygon } from '@/lib/segmentation';
import { motion } from 'framer-motion';
import { ensureValidPolygonId } from '@/lib/polygonIdUtils';

interface PolygonListPanelProps {
  loading: boolean;
  polygons: Polygon[];
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
  hiddenPolygonIds?: Set<string>;
  onTogglePolygonVisibility?: (id: string) => void;
  onRenamePolygon?: (id: string, name: string) => void;
  onDeletePolygon?: (id: string) => void;
  /**
   * Multi-selection (per-row checkbox column). This mirrors the canvas
   * selection set: a row is checked when it is the single selection
   * (`selectedPolygonId`) OR a member of the Shift+left-click multi-select set
   * (`selectedPolygonIds`). Toggling a checkbox drives the same bulk set that
   * Shift+left-click on the canvas drives. Omit these props to hide the column.
   */
  selectedPolygonIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
  onSelectAll?: (ids: string[]) => void;
  onClearSelection?: () => void;
}

/**
 * Zjednodušený panel se seznamem polygonů
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
  selectedPolygonIds = new Set<string>(),
  onToggleSelected,
  onSelectAll,
  onClearSelection,
}) => {
  const { t } = useLanguage();
  const [editingPolygonId, setEditingPolygonId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Defer the heavy row mapping when polygons change rapidly (playback
  // ticks at 10 FPS, undo/redo bursts). The counter + nav handlers below
  // still use the live `polygons` ref so the "(N)" header and Prev/Next
  // buttons stay snappy. Only the list body lags one render — invisible
  // during fast updates.
  const deferredPolygons = useDeferredValue(polygons);

  // Bulk visibility toggle. When every polygon/polyline in the list is
  // already hidden, the control flips to "show all"; otherwise it hides the
  // whole set. Iterating the per-item toggle is the only API we have — the
  // current all-hidden state drives the direction so a single click reaches
  // a consistent end-state without flicker between mixed states.
  const allHidden =
    polygons.length > 0 && polygons.every(p => hiddenPolygonIds.has(p.id));
  const handleToggleAllVisibility = () => {
    if (!onTogglePolygonVisibility) return;
    for (const p of polygons) {
      const isHidden = hiddenPolygonIds.has(p.id);
      if (allHidden && isHidden) onTogglePolygonVisibility(p.id);
      else if (!allHidden && !isHidden) onTogglePolygonVisibility(p.id);
    }
  };

  // Multi-selection checkbox column. A row is "checked" when it is the single
  // selection OR a member of the Shift+click multi-select set, so a plain
  // left-click on the canvas also lights up its checkbox. The column is only
  // shown when the parent wires the toggle handler.
  const multiSelectEnabled = !!onToggleSelected;
  const isRowSelected = (id: string) =>
    id === selectedPolygonId || selectedPolygonIds.has(id);
  const selectableIds = polygons.map(p => p.id);
  const selectedCount = selectableIds.filter(isRowSelected).length;
  const allSelected = polygons.length > 0 && selectedCount === polygons.length;
  const headerCheckboxState: boolean | 'indeterminate' = allSelected
    ? true
    : selectedCount > 0
      ? 'indeterminate'
      : false;
  const handleHeaderToggle = () => {
    if (allSelected) onClearSelection?.();
    else onSelectAll?.(selectableIds);
  };

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

  // Determine if a polygon is internal based on parent_id or type
  const isInternalPolygon = (polygon: any) => {
    return polygon.parent_id || polygon.type === 'internal';
  };

  // Get display label for sperm instance IDs (e.g., "sperm_1" → "Sperm 1")
  const getInstanceLabel = (instanceId: string) => {
    const match = instanceId.match(/^sperm_(\d+)$/);
    if (match) return `Sperm ${match[1]}`;
    return instanceId;
  };

  const getPolygonColor = (polygon: any) => {
    if (polygon.geometry === 'polyline') {
      switch (polygon.partClass) {
        case 'head':
          return 'bg-green-500';
        case 'midpiece':
          return 'bg-orange-500';
        case 'tail':
          return 'bg-cyan-500';
        default:
          return 'bg-violet-500';
      }
    }
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
      <div className="w-full flex-1 min-h-[8rem] bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex items-center justify-center dark:bg-gray-900">
        <div className="text-gray-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (!polygons || polygons.length === 0) {
    return (
      <div className="w-full flex-1 min-h-[8rem] bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col dark:bg-gray-900">
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
    <div className="w-full flex-1 min-h-[8rem] bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col dark:bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2 lg:mb-0">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('segmentation.status.polygonList')} ({polygons.length})
          </h3>

          <div className="flex items-center gap-2">
            {/* Bulk hide/show — mirrors the microtubule instance panel so
                every list (polygons or polylines) has a one-click toggle. */}
            {onTogglePolygonVisibility && polygons.length > 0 && (
              <button
                type="button"
                onClick={handleToggleAllVisibility}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                title={
                  allHidden
                    ? t('microtubule.showAll')
                    : t('microtubule.hideAll')
                }
              >
                {allHidden ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                <span>
                  {allHidden
                    ? t('microtubule.showAll')
                    : t('microtubule.hideAll')}
                </span>
              </button>
            )}

            {/* Mobile polygon navigation - only visible on mobile */}
            {polygons.length > 0 && (
              <div className="flex items-center gap-1 lg:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const currentIndex = polygons.findIndex(
                      p => p.id === selectedPolygonId
                    );
                    if (currentIndex > 0) {
                      onSelectPolygon(polygons[currentIndex - 1].id);
                    }
                  }}
                  disabled={
                    !selectedPolygonId ||
                    polygons.findIndex(p => p.id === selectedPolygonId) === 0
                  }
                  className="h-8 w-8 p-0"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>

                <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[3rem] text-center">
                  {selectedPolygonId
                    ? `${polygons.findIndex(p => p.id === selectedPolygonId) + 1}/${polygons.length}`
                    : `0/${polygons.length}`}
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const currentIndex = polygons.findIndex(
                      p => p.id === selectedPolygonId
                    );
                    if (currentIndex < polygons.length - 1) {
                      onSelectPolygon(polygons[currentIndex + 1].id);
                    }
                  }}
                  disabled={
                    !selectedPolygonId ||
                    polygons.findIndex(p => p.id === selectedPolygonId) ===
                      polygons.length - 1
                  }
                  className="h-8 w-8 p-0"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Select-all row — toggles the whole visible list into the multi-select
            set that Shift+left-click on the canvas also drives. */}
        {multiSelectEnabled && polygons.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <Checkbox
              id="polygon-list-select-all"
              checked={headerCheckboxState}
              onCheckedChange={handleHeaderToggle}
            />
            <label
              htmlFor="polygon-list-select-all"
              className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none"
            >
              {selectedCount > 0
                ? t('segmentation.selection.selected', { count: selectedCount })
                : t('segmentation.selection.selectAll')}
            </label>
          </div>
        )}
      </div>

      {/* Polygon List */}
      <div
        ref={scrollAreaRef}
        className="flex-1 overflow-y-auto min-h-0"
        data-scroll-area="true"
      >
        <div className="p-2 space-y-1">
          {deferredPolygons.map((polygon, index) => {
            const isSelected = selectedPolygonId === polygon.id;
            const isChecked = isSelected || selectedPolygonIds.has(polygon.id);
            const isHidden = hiddenPolygonIds.has(polygon.id);
            const isEditing = editingPolygonId === polygon.id;
            const isPolyline = polygon.geometry === 'polyline';
            const polygonName = isPolyline
              ? `${polygon.partClass ? t(`sperm.part.${polygon.partClass}`) : t('segmentation.status.polyline')}${polygon.instanceId ? ` (${getInstanceLabel(polygon.instanceId)})` : ''}`
              : polygon.name || `${t('common.polygon')} ${index + 1}`;

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
                      ? isPolyline
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
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
                    {/* Multi-select checkbox — stops propagation so it doesn't
                        also trigger the row's single-select onClick. */}
                    {multiSelectEnabled && (
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => onToggleSelected?.(polygon.id)}
                        onClick={e => e.stopPropagation()}
                        aria-label={polygonName}
                        className="flex-shrink-0"
                      />
                    )}

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
                          {polygon.geometry === 'polyline'
                            ? polygon.partClass
                              ? t(`sperm.part.${polygon.partClass}`)
                              : t('segmentation.status.polyline')
                            : isInternalPolygon(polygon)
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
    </div>
  );
};

export default PolygonListPanel;
