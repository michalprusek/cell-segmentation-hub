import React, { useMemo } from 'react';
import { Spline } from 'lucide-react';
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
}

const MicrotubuleInstancePanel: React.FC<MicrotubuleInstancePanelProps> = ({
  polygons,
  selectedPolygonId,
  onSelectPolygon,
}) => {
  const { t } = useLanguage();

  const microtubules = useMemo(
    () =>
      polygons.filter(
        p =>
          p.geometry === 'polyline' &&
          !p.partClass &&
          isMicrotubuleInstance(p.instanceId)
      ),
    [polygons]
  );

  const sorted = useMemo(
    () =>
      [...microtubules].sort((a, b) =>
        (a.instanceId ?? '').localeCompare(b.instanceId ?? '')
      ),
    [microtubules]
  );

  if (sorted.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 dark:bg-gray-900">
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Spline className="h-4 w-4" />
          {t('microtubule.instancePanel')}{' '}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ({sorted.length})
          </span>
        </h4>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {sorted.map((mt, idx) => {
          const id = mt.instanceId as string;
          const color = colorFromInstanceId(id);
          const isSelected = selectedPolygonId === mt.id;
          return (
            <button
              key={mt.id}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                isSelected
                  ? 'bg-violet-50 dark:bg-violet-900/20'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
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
          );
        })}
      </div>
    </div>
  );
};

export default MicrotubuleInstancePanel;
