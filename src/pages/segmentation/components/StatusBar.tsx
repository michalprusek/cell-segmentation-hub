import React from 'react';
import { Polygon } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/useLanguage';
import { EditMode } from '../types';
import {
  Shapes,
  MapPin,
  CheckCircle,
  Eye,
  EyeOff,
  Target,
  Loader2,
  CircleDot,
} from 'lucide-react';

interface StatusBarProps {
  polygons: Polygon[];
  editMode?: EditMode;
  selectedPolygonId?: string | null;
  visiblePolygonsCount?: number;
  hiddenPolygonsCount?: number;
  /**
   * Save state. Before this existed the bar printed a green "Saved" at all
   * times — including with a dozen unsaved vertex drags in the buffer — which
   * flatly contradicted the toolbar's "Unsaved changes" badge two rows above.
   * A status bar that is wrong is worse than no status bar.
   */
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
}

const StatusBar = ({
  polygons,
  editMode: _editMode,
  selectedPolygonId,
  visiblePolygonsCount,
  hiddenPolygonsCount,
  hasUnsavedChanges = false,
  isSaving = false,
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
    <div className="flex h-12 flex-1 items-center gap-x-6 overflow-x-auto px-3 text-xs">
      <div className="flex shrink-0 items-center gap-2 text-gray-700 dark:text-gray-300">
        <Shapes className="h-3 w-3 text-blue-500" />
        <span className="font-medium tabular-nums">{totalPolygons}</span>
        <span className="text-gray-600 dark:text-gray-400">
          {t('segmentation.status.polygons')}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-gray-700 dark:text-gray-300">
        <MapPin className="h-3 w-3 text-orange-500" />
        <span className="font-medium tabular-nums">{totalVertices}</span>
        <span className="text-gray-600 dark:text-gray-400">
          {t('segmentation.status.vertices')}
        </span>
      </div>

      {/* Visibility stats */}
      {hiddenCount > 0 && (
        <>
          <div className="flex shrink-0 items-center gap-2 text-gray-700 dark:text-gray-300">
            <Eye className="h-3 w-3 text-green-500" />
            <span className="font-medium tabular-nums">{visibleCount}</span>
            <span className="text-gray-600 dark:text-gray-400">
              {t('segmentation.status.visible')}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2 text-gray-700 dark:text-gray-300">
            <EyeOff className="h-3 w-3 text-gray-500" />
            <span className="font-medium tabular-nums">{hiddenCount}</span>
            <span className="text-gray-600 dark:text-gray-400">
              {t('segmentation.status.hidden')}
            </span>
          </div>
        </>
      )}

      {/* Selected polygon indicator */}
      {selectedPolygonId && (
        <div className="flex shrink-0 items-center gap-2 text-gray-700 dark:text-gray-300">
          <Target className="h-3 w-3 text-blue-500" />
          <span className="text-gray-600 dark:text-gray-400">
            {t('segmentation.status.selected')}:
          </span>
          <span className="font-mono text-xs">
            {selectedPolygonId.substring(0, 8)}
          </span>
        </div>
      )}

      {/* Save state — mirrors the toolbar so the two can never disagree. */}
      {isSaving ? (
        <div className="flex shrink-0 items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          <span className="text-blue-600 dark:text-blue-400">
            {t('segmentation.toolbar.saving')}
          </span>
        </div>
      ) : hasUnsavedChanges ? (
        <div className="flex shrink-0 items-center gap-2">
          <CircleDot className="h-3 w-3 text-amber-500" />
          <span className="text-amber-600 dark:text-amber-400">
            {t('segmentation.toolbar.unsavedChanges')}
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <CheckCircle className="h-3 w-3 text-green-500" />
          <span className="text-green-500">
            {t('segmentation.status.saved')}
          </span>
        </div>
      )}
    </div>
  );
};

export default StatusBar;
