import React, { useDeferredValue, useMemo } from 'react';
import { Spline, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { Checkbox } from '@/components/ui/checkbox';
import { Polygon } from '@/lib/segmentation';
import { calculatePolylineLength } from '../utils/metricCalculations';
import {
  colorFromInstanceId,
  isMicrotubuleInstance,
} from '../utils/instanceColors';

interface MicrotubuleInstancePanelProps {
  polygons: Polygon[];
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
  // Visibility controls — wired through to the same hidden-id set that
  // the PolygonListPanel + canvas use, so toggling here also hides the
  // polyline on the canvas (not just the list row).
  hiddenPolygonIds?: Set<string>;
  onToggleVisibility?: (polygonId: string) => void;
  /**
   * Multi-selection (per-row checkbox), synced with the canvas selection: a row
   * is checked when it is the single selection OR a member of the
   * Shift+left-click multi-select set. Omit to hide the checkboxes.
   */
  selectedPolygonIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
  onSelectAll?: (ids: string[]) => void;
  onClearSelection?: () => void;
  /** Delete a single microtubule polyline (the generic Polygon List is hidden
   *  for MT projects, so delete lives here). Omit to hide the delete button. */
  onDeletePolygon?: (id: string) => void;
}

const MicrotubuleInstancePanel: React.FC<MicrotubuleInstancePanelProps> = ({
  polygons,
  selectedPolygonId,
  onSelectPolygon,
  hiddenPolygonIds,
  onToggleVisibility,
  selectedPolygonIds = new Set<string>(),
  onToggleSelected,
  onSelectAll,
  onClearSelection,
  onDeletePolygon,
}) => {
  const { t } = useLanguage();

  // Defer the (filter + sort) re-derivation when polygons update
  // rapidly (e.g. during playback ticking at 10 FPS). The canvas
  // uses the live `polygons` reference; this panel can lag a frame
  // or two without the user noticing, but unblocks the main thread
  // for the canvas to commit on time.
  const deferredPolygons = useDeferredValue(polygons);

  // A polyline belongs in the MT panel when:
  //   (a) the ML model stamped class='microtubule' on it, OR
  //   (b) it has no partClass (i.e. not sperm) AND an mt_ instanceId
  //       (covers legacy data from before `class` was added).
  const microtubules = useMemo(
    () =>
      deferredPolygons.filter(
        p =>
          p.geometry === 'polyline' &&
          !p.partClass &&
          (p.class === 'microtubule' || isMicrotubuleInstance(p.instanceId))
      ),
    [deferredPolygons]
  );

  // Stable identity for sort + color: prefer trackId (preserved across
  // frames by the Hungarian tracker), fall back to instanceId before
  // tracking has run on the container.
  const sorted = useMemo(
    () =>
      [...microtubules].sort((a, b) =>
        (a.trackId ?? a.instanceId ?? '').localeCompare(
          b.trackId ?? b.instanceId ?? ''
        )
      ),
    [microtubules]
  );

  if (sorted.length === 0) return null;

  const allHidden = sorted.every(mt => hiddenPolygonIds?.has(mt.id) ?? false);
  const handleToggleAll = () => {
    if (!onToggleVisibility) return;
    // Iterating onToggleVisibility per row is the only API we have; the
    // current set drives the direction so a single click reaches a
    // consistent end-state (no flicker between mixed states).
    for (const mt of sorted) {
      const isHidden = hiddenPolygonIds?.has(mt.id) ?? false;
      if (allHidden && isHidden) onToggleVisibility(mt.id);
      else if (!allHidden && !isHidden) onToggleVisibility(mt.id);
    }
  };

  // Multi-selection checkbox column (mirrors PolygonListPanel). Checked when a
  // row is the single selection OR in the Shift+click multi-select set.
  const multiSelectEnabled = !!onToggleSelected;
  const isRowSelected = (id: string) =>
    id === selectedPolygonId || selectedPolygonIds.has(id);
  const selectableIds = sorted.map(mt => mt.id);
  const selectedCount = selectableIds.filter(isRowSelected).length;
  const allSelected = sorted.length > 0 && selectedCount === sorted.length;
  const headerCheckboxState: boolean | 'indeterminate' = allSelected
    ? true
    : selectedCount > 0
      ? 'indeterminate'
      : false;
  const handleHeaderToggle = () => {
    if (allSelected) onClearSelection?.();
    else onSelectAll?.(selectableIds);
  };

  return (
    <div className="shrink-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 dark:bg-gray-900">
      <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Select-all: toggles every MT into the multi-select set (also
              driven by Shift+left-click on the canvas). */}
          {multiSelectEnabled && sorted.length > 0 && (
            <Checkbox
              checked={headerCheckboxState}
              onCheckedChange={handleHeaderToggle}
              aria-label={
                allSelected
                  ? t('segmentation.selection.deselectAll')
                  : t('segmentation.selection.selectAll')
              }
              title={
                allSelected
                  ? t('segmentation.selection.deselectAll')
                  : t('segmentation.selection.selectAll')
              }
            />
          )}
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Spline className="h-4 w-4" />
            {t('microtubule.instancePanel')}{' '}
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({sorted.length})
            </span>
          </h4>
        </div>
        {onToggleVisibility && (
          <button
            type="button"
            onClick={handleToggleAll}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            title={
              allHidden ? t('microtubule.showAll') : t('microtubule.hideAll')
            }
          >
            {allHidden ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            <span>
              {allHidden ? t('microtubule.showAll') : t('microtubule.hideAll')}
            </span>
          </button>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto">
        {sorted.map((mt, idx) => {
          // trackId is the cross-frame stable key. Same MT keeps the same
          // color when the user scrubs to the next frame.
          const colorKey = mt.trackId ?? mt.instanceId ?? '';
          const color = colorFromInstanceId(colorKey);
          const isSelected = selectedPolygonId === mt.id;
          const isChecked = isSelected || selectedPolygonIds.has(mt.id);
          const isHidden = hiddenPolygonIds?.has(mt.id) ?? false;
          return (
            <div
              key={mt.id}
              className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                isSelected
                  ? 'bg-violet-50 dark:bg-violet-900/20'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              {multiSelectEnabled && (
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => onToggleSelected?.(mt.id)}
                  aria-label={`${t('microtubule.instance')} ${idx + 1}`}
                  className="flex-shrink-0"
                />
              )}
              <button
                type="button"
                className={`flex flex-1 items-center gap-2 text-left ${isHidden ? 'opacity-50' : ''}`}
                onClick={() => onSelectPolygon(isSelected ? null : mt.id)}
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm border border-black/10 dark:border-white/10 flex-shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="flex-1 font-mono truncate">
                  {t('microtubule.instance')} {idx + 1}
                </span>
                <span className="text-gray-400 whitespace-nowrap">
                  {Math.round(calculatePolylineLength(mt.points))} px
                </span>
              </button>
              {onToggleVisibility && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onToggleVisibility(mt.id);
                  }}
                  className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex-shrink-0"
                  aria-label={
                    isHidden
                      ? t('microtubule.showInstance')
                      : t('microtubule.hideInstance')
                  }
                  title={
                    isHidden
                      ? t('microtubule.showInstance')
                      : t('microtubule.hideInstance')
                  }
                >
                  {isHidden ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {onDeletePolygon && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onDeletePolygon(mt.id);
                  }}
                  className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors flex-shrink-0"
                  aria-label={t('common.delete')}
                  title={t('common.delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MicrotubuleInstancePanel;
