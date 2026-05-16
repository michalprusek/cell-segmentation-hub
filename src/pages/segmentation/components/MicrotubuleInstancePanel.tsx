import React, { useDeferredValue, useMemo } from 'react';
import { Spline, Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
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
}

const MicrotubuleInstancePanel: React.FC<MicrotubuleInstancePanelProps> = ({
  polygons,
  selectedPolygonId,
  onSelectPolygon,
  hiddenPolygonIds,
  onToggleVisibility,
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

  return (
    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 dark:bg-gray-900">
      <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Spline className="h-4 w-4" />
          {t('microtubule.instancePanel')}{' '}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ({sorted.length})
          </span>
        </h4>
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
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MicrotubuleInstancePanel;
