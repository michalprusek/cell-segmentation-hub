import React from 'react';
import { Polygon } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/useLanguage';
import { EditMode } from '../types';
import { Shapes, MapPin, CheckCircle, Eye, EyeOff, Target } from 'lucide-react';

interface StatusBarProps {
  polygons: Polygon[];
  editMode?: EditMode;
  selectedPolygonId?: string | null;
  visiblePolygonsCount?: number;
  hiddenPolygonsCount?: number;
}

const StatusBar = ({
  polygons,
  editMode: _editMode,
  selectedPolygonId,
  visiblePolygonsCount,
  hiddenPolygonsCount,
}: StatusBarProps) => {
  const { t } = useLanguage();

  if (!polygons) return null;

  // Vypočítáme celkový počet bodů napříč všemi polygony
  const totalVertices = polygons.reduce(
    (sum, polygon) => sum + polygon.points.length,
    0
  );

  // Spočítáme viditelné a skryté polygony
  const totalPolygons = polygons.length;
  const visibleCount = visiblePolygonsCount ?? totalPolygons;
  const hiddenCount = hiddenPolygonsCount ?? 0;

  return (
    <div className="h-12 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 text-xs">
      {/* Left side - Polygon Statistics */}
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
          <Shapes className="h-3 w-3 text-blue-500" />
          <span className="font-medium">{totalPolygons}</span>
          <span className="text-gray-600 dark:text-gray-400">
            {t('segmentation.status.polygons')}
          </span>
        </div>

        <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
          <MapPin className="h-3 w-3 text-orange-500" />
          <span className="font-medium">{totalVertices}</span>
          <span className="text-gray-600 dark:text-gray-400">
            {t('segmentation.status.vertices')}
          </span>
        </div>

        {/* Visibility stats */}
        {hiddenCount > 0 && (
          <>
            <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
              <Eye className="h-3 w-3 text-green-500" />
              <span className="font-medium">{visibleCount}</span>
              <span className="text-gray-600 dark:text-gray-400">
                {t('segmentation.status.visible')}
              </span>
            </div>

            <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
              <EyeOff className="h-3 w-3 text-gray-500" />
              <span className="font-medium">{hiddenCount}</span>
              <span className="text-gray-600 dark:text-gray-400">
                {t('segmentation.status.hidden')}
              </span>
            </div>
          </>
        )}

        {/* Selected polygon indicator */}
        {selectedPolygonId && (
          <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
            <Target className="h-3 w-3 text-blue-500" />
            <span className="text-gray-600 dark:text-gray-400">
              {t('segmentation.status.selected')}:
            </span>
            <span className="font-mono text-xs">
              {selectedPolygonId.substring(0, 8)}
            </span>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <CheckCircle className="h-3 w-3 text-green-500" />
          <span className="text-xs text-green-500">
            {t('segmentation.status.saved')}
          </span>
        </div>
      </div>

      {/* Right side - Polygon count */}
      <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
        <Shapes className="h-3 w-3" />
        <span className="text-xs">
          {totalPolygons} {t('segmentation.status.polygons')}
        </span>
      </div>
    </div>
  );
};

export default StatusBar;
