
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/LanguageContext';
import { EditMode } from '../types';
import { 
  Shapes, 
  MapPin, 
  CheckCircle, 
  XCircle, 
  Edit3, 
  Scissors, 
  Plus, 
  Hash,
  MousePointer,
  PenTool,
  Trash2,
  Eye,
  EyeOff,
  Target
} from 'lucide-react';

interface StatusBarProps {
  segmentation: SegmentationResult | null;
  editMode?: EditMode;
  selectedPolygonId?: string | null;
  visiblePolygonsCount?: number;
  hiddenPolygonsCount?: number;
}

const StatusBar = ({ 
  segmentation, 
  editMode, 
  selectedPolygonId, 
  visiblePolygonsCount, 
  hiddenPolygonsCount 
}: StatusBarProps) => {
  const { t } = useLanguage();
  
  if (!segmentation) return null;
  
  // Vypočítáme celkový počet bodů napříč všemi polygony
  const totalVertices = segmentation.polygons.reduce(
    (sum, polygon) => sum + polygon.points.length, 
    0
  );

  const getModeIcon = () => {
    switch (editMode) {
      case EditMode.View:
        return <MousePointer className="h-3 w-3" />;
      case EditMode.EditVertices:
        return <Edit3 className="h-3 w-3" />;
      case EditMode.AddPoints:
        return <Plus className="h-3 w-3" />;
      case EditMode.CreatePolygon:
        return <PenTool className="h-3 w-3" />;
      case EditMode.Slice:
        return <Scissors className="h-3 w-3" />;
      case EditMode.DeletePolygon:
        return <Trash2 className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const getModeColor = () => {
    switch (editMode) {
      case EditMode.View:
        return "text-gray-400 bg-gray-500/20";
      case EditMode.EditVertices:
        return "text-purple-400 bg-purple-500/20";
      case EditMode.AddPoints:
        return "text-emerald-400 bg-emerald-500/20";
      case EditMode.CreatePolygon:
        return "text-blue-400 bg-blue-500/20";
      case EditMode.Slice:
        return "text-yellow-400 bg-yellow-500/20";
      case EditMode.DeletePolygon:
        return "text-red-400 bg-red-500/20";
      default:
        return "text-slate-400";
    }
  };

  const getModeLabel = () => {
    switch (editMode) {
      case EditMode.View:
        return t('segmentation.mode.view');
      case EditMode.EditVertices:
        return t('segmentation.mode.editVertices');
      case EditMode.AddPoints:
        return t('segmentation.mode.addPoints');
      case EditMode.CreatePolygon:
        return t('segmentation.mode.createPolygon');
      case EditMode.Slice:
        return t('segmentation.mode.slice');
      case EditMode.DeletePolygon:
        return t('segmentation.mode.deletePolygon');
      default:
        return "";
    }
  };
  
  // Spočítáme viditelné a skryté polygony
  const totalPolygons = segmentation.polygons.length;
  const visibleCount = visiblePolygonsCount ?? totalPolygons;
  const hiddenCount = hiddenPolygonsCount ?? 0;

  return (
    <div className="h-12 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 text-xs">
      {/* Left side - Polygon Statistics */}
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
          <Shapes className="h-3 w-3 text-blue-500" />
          <span className="font-medium">{totalPolygons}</span>
          <span className="text-gray-600 dark:text-gray-400">{t('segmentation.status.polygons')}</span>
        </div>
        
        <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
          <MapPin className="h-3 w-3 text-orange-500" />
          <span className="font-medium">{totalVertices}</span>
          <span className="text-gray-600 dark:text-gray-400">{t('segmentation.status.vertices')}</span>
        </div>

        {/* Visibility stats */}
        {hiddenCount > 0 && (
          <>
            <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
              <Eye className="h-3 w-3 text-green-500" />
              <span className="font-medium">{visibleCount}</span>
              <span className="text-gray-600 dark:text-gray-400">{t('segmentation.status.visible')}</span>
            </div>
            
            <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
              <EyeOff className="h-3 w-3 text-gray-500" />
              <span className="font-medium">{hiddenCount}</span>
              <span className="text-gray-600 dark:text-gray-400">{t('segmentation.status.hidden')}</span>
            </div>
          </>
        )}

        {/* Selected polygon indicator */}
        {selectedPolygonId && (
          <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-300">
            <Target className="h-3 w-3 text-blue-500" />
            <span className="text-gray-600 dark:text-gray-400">{t('segmentation.status.selected')}:</span>
            <span className="font-mono text-xs">{selectedPolygonId.substring(0, 8)}</span>
          </div>
        )}
        
        <div className="flex items-center space-x-2">
          {segmentation.id ? (
            <CheckCircle className="h-3 w-3 text-green-500" />
          ) : (
            <XCircle className="h-3 w-3 text-gray-400" />
          )}
          <span className={`text-xs ${segmentation.id ? 'text-green-500' : 'text-gray-400'}`}>
            {segmentation.id ? t('segmentation.status.saved') : t('segmentation.status.unsaved')}
          </span>
        </div>
      </div>

      {/* Center - Mode indicator */}
      {editMode && (
        <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border ${getModeColor()}`}>
          {getModeIcon()}
          <span className="text-xs font-medium">
            {getModeLabel()}
          </span>
        </div>
      )}

      {/* Right side - Segmentation ID */}
      {segmentation.id && (
        <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
          <Hash className="h-3 w-3" />
          <span className="text-xs font-mono">
            ID: {segmentation.id.substring(0, 8)}
          </span>
        </div>
      )}
    </div>
  );
};

export default StatusBar;
